import { afterEach, describe, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

import type { DisposableScope } from '../core/disposable-scope';
import { author, AVATAR, idle, mountByline, setGlobal, unlinked, type BylineView, type ReadAccent } from '../test-utils/author-byline-fixture';
import { getPlayerUiRoot } from '../ui/root';

// The author byline against the title plate's header row: the popup on the panel's lines, and the home button beside
// the plate taking the arrow's color.

let scope: DisposableScope | undefined;
afterEach(() => { scope?.dispose(); scope = undefined; });
async function mount(...args: Parameters<typeof mountByline>) {
  const view = await mountByline(...args);
  scope = view.scope;
  return view;
}

const LONG_TITLE = 'Building a cedar-strip canoe, part 3: fibreglass, epoxy, the first coat of varnish and every mistake left in on purpose';

describe('author byline popup geometry', () => {
  for (const [shape, authors, dir, title] of [
    ['two authors', [author('Harbour', { stat: '1K subscribers' }), author('Bottle')], 'ltr', 'A canoe'],
    ['three authors', [author('Harbour', { stat: '1K subscribers' }), author('Bottle'), author('Tide')], 'ltr', 'A canoe'],
    ['a button arrow', [unlinked('Harbour', { stat: '1K subscribers' }), author('Bottle')], 'ltr', 'A canoe'],
    ['two authors, right to left', [author('Harbour', { stat: '1K subscribers' }), author('Bottle')], 'rtl', 'A canoe'],
    ['three authors, right to left', [author('Harbour', { stat: '1K subscribers' }), author('Bottle'), author('Tide')], 'rtl', 'A canoe'],
    ['three authors and a scrolling title', [author('Harbour', { stat: '1K subscribers' }), author('Bottle'), author('Tide')], 'ltr', LONG_TITLE]
  ] as const) {
    test(`the popup hangs from the plate on its lines: ${shape}`, async () => {
      const view = await mount(authors, { dir: dir === 'rtl' ? 'rtl' : undefined }, title);
      if (title === LONG_TITLE) await expect.poll(() => view.plate().classList.contains('marquee')).toBe(true);
      // The first row is a link, or a plain row for an unlinked first author: open from the keyboard either way.
      view.panel()!.focus();
      await userEvent.keyboard(view.panel()!.tagName === 'BUTTON' ? '{Enter}' : '{ArrowDown}');
      expect(view.shown()).toBe(true);
      // Measured from the start edge, whichever side that is.
      const start = (box: DOMRect) => (dir === 'rtl' ? -box.right : box.left);
      const text = (node: Element) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getBoundingClientRect();
      };
      // Within half a pixel.
      const near = (actual: number, expected: number) => expect(Math.abs(actual - expected), `${actual} against ${expected}`).toBeLessThanOrEqual(0.5);
      const plate = view.plate().getBoundingClientRect();
      const ring = getComputedStyle(view.plate());
      const outline = start(plate) - parseFloat(ring.outlineOffset) - parseFloat(ring.outlineWidth);
      const panelAvatar = view.panel()!.querySelector('.theater-byline-avatar')!.getBoundingClientRect();
      const panelName = text(view.panel()!.querySelector('.theater-byline-name')!);
      const row = view.rows()[0];
      // 1. The block's border runs on the plate's outline.
      near(start(view.list().getBoundingClientRect()), outline);
      // 2. Every row's avatar starts with the panel's first avatar.
      for (const each of view.rows()) near(start(each.querySelector('.theater-byline-row-avatar')!.getBoundingClientRect()), start(panelAvatar));
      // 3. The rows' names and secondary text start with the panel's first name.
      for (const each of view.rows()) near(start(text(each.querySelector('.theater-byline-row-title')!)), start(panelName));
      near(start(text(row.querySelector('.theater-byline-row-stat')!)), start(panelName));
      // The block sits the home button's gap under the plate, outline to border, and is at least 288px wide.
      near(view.list().getBoundingClientRect().top - plate.bottom - 2, 8);
      expect(view.list().getBoundingClientRect().width).toBeGreaterThanOrEqual(288);
    });
  }

});

describe('author byline and the home button', () => {
    /** The header row's home button, as hud.ts builds it on a service page (the test page has no service home). */
    const homeButton = (view: BylineView) => {
      const header = view.plate().parentElement!;
      let home = header.querySelector<HTMLAnchorElement>(':scope > .theater-home-pill');
      if (!home) {
        home = document.createElement('a');
        home.className = 'theater-home-pill theater-hud-plate';
        home.href = 'https://www.youtube.com/';
        home.textContent = 'Home';
        header.prepend(home);
      }
      return home;
    };
    const style = (node: Element, name: string) => getComputedStyle(node).getPropertyValue(name).trim();
    /** The color a CSS color expression computes to, through a probe in the player UI. */
    const computed = (view: BylineView, color: string) => {
      const probe = view.plate().parentElement!.appendChild(document.createElement('span'));
      probe.style.color = color;
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    };

    test('takes the arrow\'s avatar color for its hover, focus and press while the byline shows it, and only it does', async () => {
      const view = await mount([author('Harbour', { avatarUrl: AVATAR }), author('Two')], { readAccent: () => Promise.resolve('#3792c7') });
      const home = homeButton(view);
      const userAccent = style(view.plate().parentElement!, '--accent-color');
      await expect.poll(() => style(home, '--accent-color')).toBe('#3792c7');
      await userEvent.hover(home);
      // The icon takes the arrow's lit-edge shade; the tint the color itself.
      await expect.poll(() => getComputedStyle(home).color).toBe(computed(view, 'color-mix(in srgb, #3792c7 55%, #ffffff)'));
      expect(getComputedStyle(home).backgroundImage).toContain('linear-gradient');
      // Nothing else takes it: the header, the plate and the popup keep the user's accent.
      for (const node of [view.plate().parentElement!, view.plate(), view.list()]) expect(style(node, '--accent-color')).toBe(userAccent);
      // High contrast takes the color's contrast-safe shade, as the arrow does.
      (getPlayerUiRoot().host as HTMLElement).setAttribute('data-contrast', 'high');
      try {
        await expect.poll(() => style(home, '--accent-color')).toBe(style(view.panel()!, '--contrast-accent'));
      } finally {
        (getPlayerUiRoot().host as HTMLElement).removeAttribute('data-contrast');
      }
    });

    test('stays as it is without a color: no byline, a gray or unread avatar, the byline off, a cleared title or theater left', async () => {
      // A read answers once; later reads of the same avatar get that answer at once, as the URL cache gives it.
      const pending = new Map<string, (accent: string | null) => void>();
      const answered = new Map<string, string | null>();
      const readAccent: ReadAccent = url => answered.has(url) ? Promise.resolve(answered.get(url)!)
        : new Promise(resolve => pending.set(url, accent => { answered.set(url, accent); resolve(accent); }));
      const view = await mount([author('Plain')], { readAccent });
      const home = homeButton(view);
      // Nothing of the byline's is left on it, so it inherits the user's accent from its header row.
      const untouched = () => {
        expect(['--accent-color', '--contrast-accent', '--home-ink'].map(name => home.style.getPropertyValue(name))).toEqual(['', '', '']);
        expect(style(home, '--accent-color')).toBe(style(home.parentElement!, '--accent-color'));
      };
      untouched();
      // Not read yet, then read without a color.
      view.publish([author('Gray', { avatarUrl: 'https://yt3.ggpht.com/gray=s88' })]);
      await expect.poll(() => pending.size).toBe(1);
      untouched();
      pending.get('https://yt3.ggpht.com/gray=s88')!(null);
      await idle();
      untouched();
      // A color applies; turning the byline off, clearing the title or leaving theater takes it back.
      view.publish([author('Blue', { avatarUrl: AVATAR })], 'Another video');
      await expect.poll(() => pending.has(AVATAR)).toBe(true);
      pending.get(AVATAR)!('#3792c7');
      await expect.poll(() => style(home, '--accent-color')).toBe('#3792c7');
      await setGlobal(false);
      untouched();
      await setGlobal(true);
      await expect.poll(() => style(home, '--accent-color')).toBe('#3792c7');
      view.clear();
      untouched();
      view.publish([author('Blue', { avatarUrl: AVATAR })], 'A third video');
      await expect.poll(() => style(home, '--accent-color')).toBe('#3792c7');
      scope!.dispose();
      scope!.dispose();
      untouched();
    });

    test('a color read for an author who left, or given up, never reaches it', async () => {
      const pending = new Map<string, { resolve: (accent: string | null) => void; signal: AbortSignal }>();
      const readAccent: ReadAccent = (url, signal) => new Promise(resolve => pending.set(url, { resolve, signal }));
      const view = await mount([author('First', { avatarUrl: AVATAR })], { readAccent });
      const home = homeButton(view);
      await expect.poll(() => pending.has(AVATAR)).toBe(true);
      // Another author, and another shape, before the read returns.
      view.publish([author('Second', { avatarUrl: 'https://yt3.ggpht.com/second=s88' }), author('Third')], 'Another video');
      expect(pending.get(AVATAR)!.signal.aborted).toBe(true);
      pending.get(AVATAR)!.resolve('#3792c7');
      await idle();
      expect(home.style.getPropertyValue('--accent-color')).toBe('');
      await expect.poll(() => pending.has('https://yt3.ggpht.com/second=s88')).toBe(true);
      pending.get('https://yt3.ggpht.com/second=s88')!.resolve('#07803f');
      await expect.poll(() => style(home, '--accent-color')).toBe('#07803f');
    });
});
