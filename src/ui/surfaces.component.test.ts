import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { server, userEvent } from 'vitest/browser';

import { activeElementDeep } from '../accessibility';
import { mountSurface, type MountedSurface, type SurfacePolicy } from '../test-utils/component-surface';
import { surfaceRegistrations as registrations } from '../test-utils/surface-registry';

// Conformance suite for top-layer surfaces (TME-125 contract). Registrations live in
// test-utils/surface-registry.ts, shared with the accessibility matrix. Each registration runs the shared
// lifecycle cases of its policy: state and ARIA, Escape, outside press, focus containment, cleanup
// and owner disposal. Cases assert hooks, roles, ARIA and focus, never copy or pixels. Hostile host
// pages run once per policy, on its first registration.

interface Policy {
  /** Pointer opening moves focus inside too, not only keyboard opening. */
  pointerFocusesInside: boolean;
  /** Tab cycles inside the open surface instead of leaving it. */
  trapsFocus: boolean;
  /** After a press where the outside control is: does that control get it, or the surface's dismissal? */
  outsidePress: 'reaches-control' | 'dismisses-to-trigger';
  /** Policy-specific roles and ARIA for the current state. */
  expectAria(mounted: MountedSurface, open: boolean): void;
  /** The part of the open surface the user interacts with. */
  content(mounted: MountedSurface): HTMLElement;
}

const policies: Record<SurfacePolicy, Policy> = {
  modal: {
    pointerFocusesInside: true,
    trapsFocus: true,
    outsidePress: 'dismisses-to-trigger',
    expectAria(mounted, open) {
      const overlay = mounted.surface();
      if (!open) {
        expect(overlay?.isConnected ?? false).toBe(false);
        expect(mounted.trigger.closest('[inert]')).toBeNull();
        expect(document.body.style.overflow).toBe('');
        return;
      }
      const dialog = overlay!.querySelector('[role="dialog"]')!;
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      const label = mounted.root.getElementById(dialog.getAttribute('aria-labelledby') ?? '');
      expect(label?.textContent).toBeTruthy();
      expect(mounted.trigger.closest('[inert]'), 'content outside the modal is inert').not.toBeNull();
    },
    content: mounted => mounted.surface()!.querySelector<HTMLElement>('[role="dialog"]')!
  },
  'anchored-menu': {
    pointerFocusesInside: false,
    trapsFocus: false,
    outsidePress: 'reaches-control',
    expectAria(mounted, open) {
      const panel = mounted.surface()!.querySelector<HTMLElement>(':scope > .theater-menu-panel')!;
      expect(mounted.trigger.getAttribute('aria-expanded')).toBe(String(open));
      expect(panel.inert).toBe(!open);
      if (!open) return;
      // Placement is CSS today; the open panel must stay inside the player UI host box.
      const box = (mounted.root.host as HTMLElement).getBoundingClientRect();
      const rect = panel.getBoundingClientRect();
      expect(rect.width * rect.height).toBeGreaterThan(0);
      expect([rect.left >= box.left, rect.top >= box.top, rect.right <= box.right, rect.bottom <= box.bottom]).toEqual([true, true, true, true]);
    },
    content: mounted => mounted.surface()!.querySelector<HTMLElement>(':scope > .theater-menu-panel')!
  }
};

const state = (mounted: MountedSurface) => mounted.surface()?.dataset.teState ?? 'closed';
const focusInside = (mounted: MountedSurface) => {
  const active = activeElementDeep();
  return Boolean(active && mounted.surface()?.contains(active));
};

async function openWith(mounted: MountedSurface, input: 'keyboard' | 'pointer'): Promise<void> {
  if (input === 'pointer') await userEvent.click(mounted.trigger);
  else {
    mounted.trigger.focus();
    await userEvent.keyboard('{Enter}');
  }
  expect(state(mounted)).toBe('open');
}

function expectOpen(mounted: MountedSurface, family: string): void {
  const surface = mounted.surface()!;
  expect(surface.dataset.teState).toBe('open');
  expect(surface.dataset.teSurface).toBe(family);
  expect(surface.dataset.teOwner).toBeTruthy();
}

/** Host shortcuts listen on the document; a key a surface consumes must not reach them. */
function documentKeys(): { keys: string[]; stop(): void } {
  const keys: string[] = [];
  const listener = (event: KeyboardEvent) => keys.push(event.key);
  document.addEventListener('keydown', listener);
  return { keys, stop: () => document.removeEventListener('keydown', listener) };
}

const family: Record<SurfacePolicy, string> = { modal: 'modal', 'anchored-menu': 'menu' };

for (const registration of registrations) {
  const policy = policies[registration.policy];

  describe(`${registration.name} (${registration.policy})`, () => {
    // Installed before mount, so any timer or frame the surface schedules is under the test's control.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    });

    for (const input of ['keyboard', 'pointer'] as const) {
      test(`opens by ${input} with state, hooks and ARIA; closing restores them`, async () => {
        const mounted = mountSurface(registration);
        policy.expectAria(mounted, false);
        await openWith(mounted, input);
        expectOpen(mounted, family[registration.policy]);
        policy.expectAria(mounted, true);
        expect(focusInside(mounted)).toBe(input === 'keyboard' || policy.pointerFocusesInside);
        mounted.close();
        expect(state(mounted)).toBe('closed');
        policy.expectAria(mounted, false);
      });
    }

    test('Escape closes it, stays out of host shortcuts and returns focus to the trigger', async () => {
      const mounted = mountSurface(registration);
      await openWith(mounted, 'keyboard');
      const host = documentKeys();
      await userEvent.keyboard('{Escape}');
      host.stop();
      expect(state(mounted)).toBe('closed');
      expect(host.keys).toEqual([]);
      expect(activeElementDeep()).toBe(mounted.trigger);
      policy.expectAria(mounted, false);
    });

    test('a press where an outside control is follows the policy', async () => {
      const mounted = mountSurface(registration);
      await openWith(mounted, 'keyboard');
      let reached = 0;
      mounted.outside.addEventListener('click', () => { reached += 1; });
      // Press the point, not the element: whatever is on top there receives the real pointer input.
      const box = mounted.outside.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const target = mounted.root.elementFromPoint(x, y)!;
      const at = target.getBoundingClientRect();
      await userEvent.click(target, { position: { x: x - at.left, y: y - at.top } });
      expect(state(mounted)).toBe('closed');
      if (policy.outsidePress === 'reaches-control') {
        expect(reached).toBe(1);
        expect(activeElementDeep()).toBe(mounted.outside);
      } else {
        expect(reached, 'the surface covers outside controls').toBe(0);
        expect(activeElementDeep()).toBe(mounted.trigger);
      }
    });

    test(policy.trapsFocus ? 'Tab keeps focus inside' : 'Tab past the last control leaves and closes it', async () => {
      const mounted = mountSurface(registration);
      await openWith(mounted, 'keyboard');
      const controls = mounted.surface()!.querySelectorAll('button').length;
      for (let press = 0; press <= controls && state(mounted) === 'open'; press += 1) {
        await userEvent.keyboard('{Tab}');
        if (policy.trapsFocus) expect(focusInside(mounted)).toBe(true);
      }
      if (policy.trapsFocus) expect(state(mounted)).toBe('open');
      else {
        expect(state(mounted)).toBe('closed');
        expect(activeElementDeep()).toBe(mounted.outside);
      }
    });

    test('owner disposal closes it, releases host state, leaves no late work and cannot reopen', async () => {
      const mounted = mountSurface(registration);
      await openWith(mounted, 'keyboard');
      const surface = mounted.surface()!;
      mounted.owner.dispose();
      expect(surface.isConnected).toBe(false);
      expect(mounted.root.querySelector('[inert]')).toBeNull();
      expect(document.body.style.overflow).toBe('');
      expect(document.body.classList.contains('te-dialog-open')).toBe(false);
      expect(activeElementDeep() ?? document.body, 'disposal never focuses into a retired surface').toBe(document.body);
      const settled = mounted.root.innerHTML;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mounted.root.innerHTML).toBe(settled);
      // Repeated close and dispose are safe; the retired trigger opens nothing.
      mounted.close();
      mounted.close();
      mounted.owner.dispose();
      mounted.trigger.click();
      expect(mounted.root.querySelector('[data-te-state="open"]')).toBeNull();
    });

    test('a retired mount cannot close, focus or mutate its replacement', async () => {
      const retired = mountSurface(registration);
      await openWith(retired, 'keyboard');
      retired.owner.dispose();
      const current = mountSurface(registration);
      await openWith(current, 'keyboard');
      expect(current.surface()!.dataset.teOwner).not.toBe(retired.surface()!.dataset.teOwner);
      const active = activeElementDeep();
      retired.close();
      retired.owner.dispose();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(state(current)).toBe('open');
      expect(activeElementDeep()).toBe(active);
      policy.expectAria(current, true);
    });
  });
}

/** Whether real pointer input at the element's centre reaches it, above everything the page shows. */
function onTop(mounted: MountedSurface, element: HTMLElement): boolean {
  const box = element.getBoundingClientRect();
  const [x, y] = [box.left + box.width / 2, box.top + box.height / 2];
  if (document.elementFromPoint(x, y) !== mounted.root.host) return false;
  const hit = mounted.root.elementFromPoint(x, y);
  return Boolean(hit && element.contains(hit));
}

function pageElement<K extends keyof HTMLElementTagNameMap>(tag: K, css: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.style.cssText = css;
  document.body.append(element);
  return element;
}

const COVER = 'position:fixed;inset:0;width:auto;height:auto;max-width:none;max-height:none;margin:0;border:0;background:rgb(200, 0, 0);pointer-events:auto';

interface HostilePage {
  name: string;
  /** Builds the hostile page: before the player UI exists, or once the surface is open (`afterOpen`). */
  install(): void | Promise<void>;
  afterOpen?: boolean;
  fullscreen?: boolean;
  /**
   * Set when the page legitimately wins (a page modal dialog makes the rest of the document inert,
   * whichever entered the top layer first; docs/top-layer.md). Undoes it, so recovery is asserted.
   */
  release?(): void;
}

let pageDialog: HTMLDialogElement | undefined;
const modalDialog = () => {
  pageDialog = pageElement('dialog', COVER);
  pageDialog.append(Object.assign(document.createElement('button'), { textContent: 'Page dialog' }));
  pageDialog.showModal();
};
const pagePopover = () => {
  const popover = pageElement('div', COVER);
  popover.popover = 'manual';
  popover.showPopover();
};

const hostilePages: HostilePage[] = [
  { name: 'a z-index maximum overlay', install: () => { pageElement('div', `${COVER};z-index:2147483647`); } },
  {
    name: 'transformed, contained and filtered ancestors',
    install: () => {
      for (const element of [document.documentElement, document.body]) {
        element.style.cssText = 'transform:translateZ(0);filter:saturate(1);contain:layout paint;will-change:transform';
      }
      pageElement('div', `${COVER};z-index:2147483647`);
    }
  },
  {
    name: 'an aggressive global stylesheet',
    install: () => {
      pageElement('style', '').textContent = `* { all: revert !important; }
        button, div, [popover], [role="dialog"] { display: none !important; visibility: hidden !important; }
        html, body { overflow: hidden !important; pointer-events: none !important; }`;
    }
  },
  { name: 'a page popover shown before the player UI', install: pagePopover },
  { name: 'a page popover shown while the surface is open', install: pagePopover, afterOpen: true },
  { name: 'a page modal dialog shown before the player UI', install: modalDialog, release: () => pageDialog?.close() },
  { name: 'a page modal dialog shown while the surface is open', install: modalDialog, afterOpen: true, release: () => pageDialog?.close() },
  {
    // The document goes fullscreen, as in theater fullscreen. The Enter that opened the surface is the
    // user activation it needs. (A fullscreen page element outside the host's ancestors is not covered.)
    name: 'the page going fullscreen while the surface is open',
    install: async () => {
      const entered = new Promise(resolve => document.addEventListener('fullscreenchange', resolve, { once: true }));
      await document.documentElement.requestFullscreen();
      await entered;
      expect(document.fullscreenElement).not.toBeNull();
    },
    afterOpen: true,
    fullscreen: true
  }
];

const representatives = [...new Map(registrations.map(registration => [registration.policy, registration])).values()];

for (const registration of representatives) {
  const policy = policies[registration.policy];

  describe(`${registration.policy} on a hostile host page`, () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    });
    afterEach(async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
      pageDialog = undefined;
      document.documentElement.removeAttribute('style');
      document.body.removeAttribute('style');
    });

    for (const page of hostilePages) {
      test(page.name, async () => {
        if (!page.afterOpen) await page.install();
        const mounted = mountSurface(registration);
        if (page.release && !page.afterOpen) {
          expect(onTop(mounted, mounted.trigger), 'the page dialog wins while open').toBe(false);
          page.release();
        }
        expect(onTop(mounted, mounted.trigger)).toBe(true);
        await openWith(mounted, 'keyboard');
        if (page.afterOpen) {
          await page.install();
          // The host re-enters the top layer on the next frame after a page popover or fullscreen.
          await vi.advanceTimersByTimeAsync(50);
          if (page.release) {
            expect(onTop(mounted, policy.content(mounted)), 'the page dialog wins while open').toBe(false);
            page.release();
            // The dialog took focus; a surface that does not trap focus closed when it left.
            if (!policy.trapsFocus) {
              expect(state(mounted)).toBe('closed');
              await openWith(mounted, 'keyboard');
            }
          }
        }
        expect(state(mounted)).toBe('open');
        expect(onTop(mounted, policy.content(mounted))).toBe(true);
        policy.expectAria(mounted, true);
        policy.content(mounted).querySelector('button')!.focus();
        await userEvent.keyboard('{Escape}');
        if (page.fullscreen && server.browser === 'firefox') {
          // Firefox spends the first Escape on leaving fullscreen; the page never sees it.
          await expect.poll(() => document.fullscreenElement).toBeNull();
          expect(state(mounted)).toBe('open');
          await userEvent.keyboard('{Escape}');
        }
        expect(state(mounted)).toBe('closed');
        expect(activeElementDeep()).toBe(mounted.trigger);
        policy.expectAria(mounted, false);
      });
    }
  });
}
