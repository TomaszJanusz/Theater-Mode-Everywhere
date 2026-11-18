import { afterEach, describe, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

import { activeElementDeep } from '../accessibility';
import { DisposableScope } from '../core/disposable-scope';
import type { PlaylistPanelSnapshot } from '../core/playlist-panel';
import { blockingViolations } from '../test-utils/axe';
import { fakePlaylistSource, playlistBar, samplePlaylist } from '../test-utils/playlist-panel-fixture';
import { getPlayerUiRoot, mountPlayerUi } from '../ui/root';
import { setSvgIcon } from '../ui/svg-icon';

import { mountPlaylistPanel } from './playlist-panel-view';

let scope: DisposableScope;
afterEach(() => scope?.dispose());

const button = (className: string) => {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `theater-control-btn ${className}`;
  element.setAttribute('aria-label', className);
  setSvgIcon(element, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"><rect width="24" height="24"/></svg>');
  return element;
};

/**
 * The control bar as controls.ts builds it: play, Previous and Next in the left section with the playlist toggle right
 * after Next, the subtitle menu in the right section. Without a source the bar is the one a page without a list gets.
 */
function mount(snapshot: PlaylistPanelSnapshot | null = samplePlaylist(), bar: { panel?: boolean; dir?: 'ltr' | 'rtl'; pinned?: boolean } = {}) {
  scope = new DisposableScope();
  const fake = fakePlaylistSource(snapshot);
  const wrapper = document.createElement('div');
  wrapper.className = `theater-controls-wrapper visible${bar.pinned ? ' pinned' : ''}`;
  wrapper.dir = bar.dir ?? 'ltr';
  const row = document.createElement('div');
  row.className = 'theater-controls-row';
  const left = document.createElement('div');
  left.className = 'theater-controls-left';
  const next = button('playlist-next-btn');
  left.append(button('play-pause-btn'), button('playlist-prev-btn'), next);
  const right = document.createElement('div');
  right.className = 'theater-controls-right';
  const cc = document.createElement('div');
  cc.className = 'theater-cc-menu-host theater-menu-anchored';
  cc.append(button('cc-btn'));
  right.append(cc, button('player-settings-btn'));
  row.append(left, right);
  wrapper.append(row);
  mountPlayerUi(wrapper);
  scope.add(() => wrapper.remove());
  const panel = mountPlaylistPanel(fake.source, playlistBar(scope));
  if (bar.panel !== false) {
    next.after(panel.host);
    panel.syncAvailability();
  }
  const trigger = panel.host.querySelector<HTMLButtonElement>('.theater-playlist-toggle')!;
  const rows = () => [...panel.host.querySelectorAll<HTMLButtonElement>('.theater-playlist-row')];
  return { ...fake, panel, trigger, next, wrapper, rows, state: () => panel.host.dataset.teState };
}

const heightOf = (element: Element) => element.getBoundingClientRect().height;

describe('Playlist panel', () => {
  test('the toggle shows only while the provider has a list, and a list that goes away closes the panel', async () => {
    const { panel, trigger, setAvailable, state, subscriptions } = mount();
    expect(panel.host.hidden).toBe(false);
    await userEvent.click(trigger);
    expect(state()).toBe('open');
    setAvailable(false);
    panel.syncAvailability();
    expect(panel.host.hidden).toBe(true);
    expect(state()).toBe('closed');
    expect(subscriptions()).toBe(0);
  });

  test('reads and observes the host only while open', async () => {
    const { trigger, rows, subscriptions, reads, panel } = mount();
    expect([reads(), subscriptions(), rows().length]).toEqual([0, 0, 0]);
    await userEvent.click(trigger);
    expect(subscriptions()).toBe(1);
    expect(reads()).toBe(1);
    expect(rows()).toHaveLength(12);
    expect(rows().map(row => row.querySelector('.theater-playlist-index')!.textContent).slice(0, 4)).toEqual(['1', '2', '', '4']);
    const current = rows()[2];
    expect(current.getAttribute('aria-current')).toBe('true');
    expect(current.classList.contains('active')).toBe(true);
    expect(panel.host.querySelector('.theater-playlist-meta')!.textContent).toBe('\u2068Harbour Films\u2069 · Video 3 of 12');
    panel.close();
    expect(subscriptions()).toBe(0);
    expect(rows()).toHaveLength(0);
  });

  test('keyboard opening lands on the playing item; arrows, Home and End move and stay out of host shortcuts', async () => {
    const { trigger, rows } = mount();
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(activeElementDeep()).toBe(rows()[2]);
    const keys: string[] = [];
    const record = (event: KeyboardEvent) => keys.push(event.key);
    document.addEventListener('keydown', record);
    try {
      await userEvent.keyboard('{ArrowDown}');
      expect(activeElementDeep()).toBe(rows()[3]);
      await userEvent.keyboard('{ArrowUp}{ArrowUp}');
      expect(activeElementDeep()).toBe(rows()[1]);
      await userEvent.keyboard('{End}');
      expect(activeElementDeep()).toBe(rows()[11]);
      await userEvent.keyboard('{ArrowDown}');
      expect(activeElementDeep()).toBe(rows()[11]);
      await userEvent.keyboard('{Home}');
      expect(activeElementDeep()).toBe(rows()[0]);
    } finally {
      document.removeEventListener('keydown', record);
    }
    expect(keys).toEqual([]);
  });

  test('pointer and keyboard activation share one path; an item that cannot play or is playing does not navigate', async () => {
    const { trigger, rows, activations, state } = mount();
    await userEvent.click(trigger);
    // Playwright refuses to click an aria-disabled control; a dispatched click still reaches the list.
    expect(rows()[7].getAttribute('aria-disabled')).toBe('true');
    rows()[7].click();
    expect([activations, state()]).toEqual([[], 'open']);
    await userEvent.click(rows()[2]);
    expect([activations, state()]).toEqual([[], 'closed']);
    await userEvent.click(trigger);
    await userEvent.click(rows()[5]);
    expect([activations, state()]).toEqual([['item-6'], 'closed']);
    trigger.focus();
    await userEvent.keyboard('{Enter}{ArrowDown}{Enter}');
    expect(activations).toEqual(['item-6', 'item-4']);
    expect(state()).toBe('closed');
    // A keyboard activation hands focus back to the toggle.
    expect(activeElementDeep()).toBe(trigger);
  });

  test('a host change repaints the open list and keeps focus on the same item; an equal list leaves the rows alone', async () => {
    const { trigger, rows, update } = mount();
    trigger.focus();
    await userEvent.keyboard('{Enter}{ArrowDown}');
    const focused = rows()[3];
    update(samplePlaylist());
    expect(rows()[3]).toBe(focused);
    update(samplePlaylist({ current: 4 }));
    expect(rows()[3]).not.toBe(focused);
    expect(rows()[3].getAttribute('aria-current')).toBe('true');
    expect(activeElementDeep()).toBe(rows()[3]);
  });

  test('a list the host no longer has shows a status row; a mix has no position', async () => {
    const { trigger, update, panel } = mount();
    await userEvent.click(trigger);
    update(null);
    const status = panel.host.querySelector('[role="status"]');
    expect(status?.textContent).toBe('This playlist is not available right now.');
    update(samplePlaylist({ total: null }));
    expect(panel.host.querySelector('.theater-playlist-meta')!.textContent).toBe('\u2068Harbour Films\u2069');
  });

  test('the shortcut toggles the panel as the keyboard does on the toggle, and only while the toggle is shown', async () => {
    const { panel, trigger, rows, state, subscriptions, setAvailable } = mount();
    panel.toggle();
    expect(state()).toBe('open');
    expect(activeElementDeep()).toBe(rows()[2]);
    expect(subscriptions()).toBe(1);
    panel.toggle();
    expect(state()).toBe('closed');
    expect(activeElementDeep()).toBe(trigger);
    expect(subscriptions()).toBe(0);
    setAvailable(false);
    panel.syncAvailability();
    panel.toggle();
    expect(state()).toBe('closed');
  });

  test('theater exit while open ends the opening', async () => {
    const { trigger, subscriptions } = mount();
    await userEvent.click(trigger);
    expect(subscriptions()).toBe(1);
    scope.dispose();
    expect(subscriptions()).toBe(0);
  });

  test('the open panel has no blocking accessibility violations', async () => {
    const { trigger } = mount();
    await userEvent.click(trigger);
    expect(await blockingViolations(getPlayerUiRoot().host as HTMLElement)).toEqual([]);
  });
});

describe('Playlist toggle in the control bar', () => {
  for (const dir of ['ltr', 'rtl'] as const) {
    for (const pinned of [false, true]) {
      test(`leaves the bar's height unchanged, closed and open (${dir}${pinned ? ', pinned' : ''})`, async () => {
        const without = heightOf(mount(samplePlaylist(), { panel: false, dir, pinned }).wrapper);
        scope.dispose();
        const { wrapper, trigger, state } = mount(samplePlaylist(), { dir, pinned });
        expect(heightOf(wrapper)).toBe(without);
        await userEvent.click(trigger);
        expect(state()).toBe('open');
        expect(heightOf(wrapper)).toBe(without);
        await userEvent.keyboard('{Escape}');
        trigger.focus();
        await userEvent.keyboard('{Enter}');
        expect(state()).toBe('open');
        expect(heightOf(wrapper)).toBe(without);
      });
    }
  }

  test('sits with the step controls, boxed and centred like Next, and its icon stays put while open', async () => {
    const { trigger, next, state } = mount();
    expect(trigger.closest('.theater-menu-anchored')!.previousElementSibling).toBe(next);
    const box = trigger.getBoundingClientRect();
    const reference = next.getBoundingClientRect();
    expect([box.top, box.height, box.width]).toEqual([reference.top, reference.height, reference.width]);
    const icon = trigger.querySelector('svg')!.getBoundingClientRect();
    expect([icon.width, icon.height]).toEqual([18, 18]);
    expect(icon.top - box.top).toBe(next.querySelector('svg')!.getBoundingClientRect().top - reference.top);
    await userEvent.click(trigger);
    expect(state()).toBe('open');
    const openIcon = trigger.querySelector('svg')!.getBoundingClientRect();
    expect([openIcon.left, openIcon.top]).toEqual([icon.left, icon.top]);
  });

  for (const dir of ['ltr', 'rtl'] as const) {
    test(`opens from the left section towards the bar's end, inside the viewport (${dir})`, async () => {
      const { trigger, panel } = mount(samplePlaylist(), { dir });
      await userEvent.click(trigger);
      const menu = panel.host.querySelector('.theater-playlist-menu')!.getBoundingClientRect();
      const toggle = trigger.getBoundingClientRect();
      expect(menu.left).toBeGreaterThanOrEqual(0);
      expect(menu.right).toBeLessThanOrEqual(window.innerWidth);
      // The notch sits over the open toggle (as wide as the notch) at the panel's start corner, and the panel
      // reaches towards the bar's end.
      if (dir === 'ltr') {
        expect(menu.left).toBeCloseTo(toggle.left, 0);
        expect(menu.right).toBeGreaterThan(toggle.right);
      } else {
        expect(menu.right).toBeCloseTo(toggle.right, 0);
        expect(menu.left).toBeLessThan(toggle.left);
      }
    });

    test(`the open notch keeps the menu's outer edge and covers only its inner side, like the subtitle menu's (${dir})`, async () => {
      const { trigger, wrapper } = mount(samplePlaylist(), { dir });
      await userEvent.click(trigger);
      // The cover strip over the notch's side stroke, measured from the inline start of the open toggle's padding box.
      const cover = (button: HTMLElement) => parseFloat(getComputedStyle(button, '::before').insetInlineStart);
      // In the left section the notch is the panel's start corner: its start side is the outline, its end side lies in
      // the panel and is covered.
      expect(cover(trigger)).toBe(trigger.clientWidth - 1);
      // The subtitle menu on the bar's end is unchanged: its notch is the menu's end corner, so its start side is covered.
      const cc = wrapper.querySelector<HTMLElement>('.theater-cc-menu-host')!;
      cc.classList.add('theater-menu', 'is-open');
      expect(cover(cc.querySelector('button')!)).toBe(-1);
    });
  }
});
