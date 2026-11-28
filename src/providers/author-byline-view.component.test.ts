import { afterEach, describe, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import type { DisposableScope } from '../core/disposable-scope';
import { author, AVATAR, idle, mountByline, setGlobal, unlinked, type ReadAccent } from '../test-utils/author-byline-fixture';
import { APPEARANCE_MODES, blockingViolations } from '../test-utils/axe';
import { getPlayerUiRoot } from '../ui/root';

import { readAvatarAccent } from './author-byline-view';

let scope: DisposableScope | undefined;
afterEach(() => { scope?.dispose(); scope = undefined; });
async function mount(...args: Parameters<typeof mountByline>) {
  const view = await mountByline(...args);
  scope = view.scope;
  return view;
}

const LONG_TITLE = 'Building a cedar-strip canoe, part 3: fibreglass, epoxy, the first coat of varnish and every mistake left in on purpose';
/** The tooltip a browser shows over `node`: the nearest `title` from it outwards, where an empty one means none. */
function tooltip(node: Element | null): string | null {
  for (let current = node; current; current = current.parentElement) if (current.hasAttribute('title')) return current.getAttribute('title');
  return null;
}

describe('author byline in the title plate', () => {
  test('sits at the start of the plate and leaves its height unchanged', async () => {
    const plain = await mount(null);
    const height = plain.plate().getBoundingClientRect().height;
    expect(plain.panel()).toBeNull();
    scope!.dispose();
    const view = await mount([author('Harbour Films', { avatarUrl: AVATAR, verified: true })]);
    expect(view.plate().firstElementChild?.classList.contains('theater-byline')).toBe(true);
    expect(view.plate().getBoundingClientRect().height).toBe(height);
    // The panel fills the plate to its filled edge, not to the inside of its border.
    const plate = view.plate().getBoundingClientRect();
    const panel = view.panel()!.getBoundingClientRect();
    for (const edge of ['top', 'bottom', 'left'] as const) expect(panel[edge]).toBeCloseTo(plate[edge], 2);
    // Name and title share the plate's centre line.
    const middle = (box: DOMRect) => (box.top + box.bottom) / 2;
    const name = view.panel()!.querySelector('.theater-byline-name')!.getBoundingClientRect();
    const title = view.plate().querySelector('.theater-title-hud-text')!.getBoundingClientRect();
    expect(middle(name)).toBeCloseTo(middle(plate), 1);
    expect(middle(title)).toBeCloseTo(middle(plate), 1);
    expect(view.names()).toBe('Harbour Films');
    // The visible name starts the accessible name, and the new tab ends it.
    expect(view.panel()!.hasAttribute('aria-label')).toBe(false);
    await expect.element(view.panel()!).toHaveAccessibleName('Harbour Films Verified Opens the channel in a new tab');
    expect(view.panel()!.querySelector<HTMLImageElement>('img.theater-byline-avatar')!.referrerPolicy).toBe('no-referrer');
    expect(view.panel()!.querySelector('.theater-byline-verified')!.getAttribute('aria-label')).toBe('Verified');
  });

  test('labels two authors "A & B" and three "A +2", naming everyone for assistive technology', async () => {
    const view = await mount([author('QuietHarbor'), author('Bottlewright')]);
    expect(view.names()).toBe('QuietHarbor&Bottlewright');
    await expect.element(view.panel()!).toHaveAccessibleName('QuietHarbor & Bottlewright Opens the channel in a new tab');
    view.publish([author('A'), author('B'), author('C')]);
    expect(view.names()).toBe('A+2');
    expect(view.panel()!.getAttribute('aria-label')).toBe('A, B, and C Opens the channel in a new tab');
    expect(view.rows()).toHaveLength(3);
    // A first author without a link leaves a button, whose name is the names alone.
    view.publish([unlinked('A'), author('B'), author('C')]);
    expect(view.panel()!.getAttribute('aria-label')).toBe('A, B, and C');
  });

  test('lists the authors as rows of one block, each its channel link, only to the provider\'s hosts and in a new tab', async () => {
    const view = await mount([
      author('Harbour', { avatarUrl: AVATAR, verified: true, stat: '1.26M subscribers' }),
      author('Elsewhere', { url: 'https://evil.example/', avatarUrl: 'https://evil.example/a.png' })
    ]);
    // One list in the popup, an item per author.
    expect([...view.popup()!.children]).toEqual([view.list()]);
    expect(view.list().getAttribute('role')).toBe('list');
    expect([...view.list().children].map(item => item.tagName)).toEqual(['LI', 'LI']);
    const [row, plain] = view.rows();
    expect(view.links()).toEqual([row]);
    const link = row as HTMLAnchorElement;
    expect(link.href).toBe('https://www.youtube.com/@Harbour');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    // No separate button: the row's own words start its accessible name, and the new tab ends it.
    expect(row.querySelector('a, button')).toBeNull();
    expect(row.querySelector('.theater-byline-row-avatar')!.getAttribute('aria-hidden')).toBe('true');
    expect(row.querySelector('.theater-byline-verified')!.getAttribute('aria-label')).toBe('Verified');
    await view.openList();
    await expect.element(row).toHaveAccessibleName('Harbour Verified 1.26M subscribers Opens the channel in a new tab');
    // A host outside the allow-list leaves a plain row: no link, no pointer, nothing to focus.
    expect(plain.tagName).toBe('DIV');
    expect(plain.querySelector('a')).toBeNull();
    expect(plain.textContent).toBe('ELElsewhere');
    const avatars = view.panel()!.querySelectorAll('.theater-byline-avatar');
    expect(avatars[1].classList.contains('theater-byline-monogram')).toBe(true);
    expect(avatars[1].textContent).toBe('EL');
  });

  test('a click, or Enter on the focused row, follows the row\'s link', async () => {
    const view = await mount([author('One'), author('Two')]);
    await view.openList();
    await userEvent.click(view.links()[1].querySelector('.theater-byline-row-title')!);
    view.links()[0].focus();
    await userEvent.keyboard('{Enter}');
    expect(view.followed).toEqual(['https://www.youtube.com/@Two', 'https://www.youtube.com/@One']);
  });

  test('one block frames the rows: it alone has the border, corners and shadow, and clips the rows to its corners', async () => {
    const view = await mount([author('One'), author('Two'), author('Three')]);
    await view.openList();
    const block = getComputedStyle(view.list());
    expect(block.borderTopWidth).toBe('1px');
    expect(block.borderTopLeftRadius).toBe('12px');
    expect(block.boxShadow).not.toBe('none');
    expect(block.overflow).toBe('clip');
    const [first, second, third] = view.rows();
    for (const row of [first, second, third]) {
      const style = getComputedStyle(row);
      expect([style.borderTopWidth, style.boxShadow]).toEqual(['0px', 'none']);
    }
    // Rows touch: one surface, no gaps between them.
    expect(second.getBoundingClientRect().top).toBeCloseTo(first.getBoundingClientRect().bottom, 1);
    // The outer rows take the block's inner corners, so a focus ring follows them; the middle row is square.
    const corners = (row: HTMLElement) => {
      const style = getComputedStyle(row);
      return [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius];
    };
    expect(corners(first)).toEqual(['11px', '11px', '0px', '0px']);
    expect(corners(second)).toEqual(['0px', '0px', '0px', '0px']);
    expect(corners(third)).toEqual(['0px', '0px', '11px', '11px']);
    // Two authors: the first row takes the top corners, the last the bottom ones.
    view.publish([author('One'), author('Two')], 'A duet');
    await view.openList();
    expect(corners(view.rows()[0])).toEqual(['11px', '11px', '0px', '0px']);
    expect(corners(view.rows()[1])).toEqual(['0px', '0px', '11px', '11px']);
  });

  test('alternates the rows\' tone from the second author; every row has its lit edge, which a pointer widens as it lifts the row; focus draws a ring inside it', async () => {
    const view = await mount([author('One'), author('Two'), author('Three')]);
    await view.openList();
    const [first, second, third] = view.links();
    const fill = (row: HTMLElement) => getComputedStyle(row).backgroundColor;
    const edge = (row: HTMLElement) => getComputedStyle(row, '::before');
    expect(fill(second)).not.toBe(fill(first));
    expect(fill(third)).toBe(fill(first));
    const restFill = fill(third);
    // Every row shows its lit edge; the pointer widens and brightens it.
    expect([edge(third).width, edge(third).opacity]).toEqual(['2px', '0.6']);
    await userEvent.hover(third);
    await expect.poll(() => fill(third)).not.toBe(restFill);
    expect(fill(third)).not.toBe(fill(second));
    expect([edge(third).width, edge(third).opacity]).toEqual(['3px', '1']);
    // The edge sits at the row's start.
    expect(edge(third).left).toBe('0px');
    third.focus();
    await userEvent.keyboard('{ArrowUp}');
    const ring = getComputedStyle(second);
    expect(ring.outlineStyle).toBe('solid');
    expect(ring.outlineWidth).toBe('2px');
    // Inside the row, so the block's clip never cuts it.
    expect(ring.outlineOffset).toBe('-2px');
  });

  test('↓ opens the popup at once with focus on the first link; ↑/↓ move, Escape returns to the panel', async () => {
    const view = await mount([author('One'), author('Two')]);
    view.panel()!.focus();
    // Focus alone does not open it.
    expect(view.panel()!.getAttribute('aria-expanded')).toBe('false');
    await userEvent.keyboard('{ArrowDown}');
    expect(view.shown()).toBe(true);
    expect(getPlayerUiRoot().activeElement).toBe(view.links()[0]);
    await userEvent.keyboard('{ArrowDown}');
    expect(getPlayerUiRoot().activeElement).toBe(view.links()[1]);
    await userEvent.keyboard('{ArrowUp}');
    expect(getPlayerUiRoot().activeElement).toBe(view.links()[0]);
    await userEvent.keyboard('{Escape}');
    expect(view.shown()).toBe(false);
    expect(view.panel()!.getAttribute('aria-expanded')).toBe('false');
    expect(getPlayerUiRoot().activeElement).toBe(view.panel());
    await userEvent.keyboard('{ArrowDown}');
    expect(view.panel()!.getAttribute('aria-expanded')).toBe('true');
    expect(getPlayerUiRoot().activeElement).toBe(view.links()[0]);
    // Focus moving on closes it.
    const outside = document.body.appendChild(document.createElement('button'));
    outside.focus();
    outside.remove();
    expect(view.panel()!.getAttribute('aria-expanded')).toBe('false');
    expect(view.shown()).toBe(false);
  });

  test('with a first author without a link the arrow is the popup\'s button: a click or Enter opens it', async () => {
    const view = await mount([unlinked('One'), author('Two')]);
    expect(view.panel()!.tagName).toBe('BUTTON');
    view.panel()!.focus();
    await userEvent.keyboard('{Enter}');
    expect(view.shown()).toBe(true);
    // The first row is not a link; focus goes to the first one there is.
    expect(getPlayerUiRoot().activeElement).toBe(view.links()[0]);
    expect(view.links()[0].href).toBe('https://www.youtube.com/@Two');
    await userEvent.keyboard('{Escape}');
    expect(getPlayerUiRoot().activeElement).toBe(view.panel());
    expect(view.followed).toEqual([]);
  });

  test('a click on a button panel pins the popup at once; a press outside closes it', async () => {
    const view = await mount([unlinked('One'), author('Two')]);
    await userEvent.click(view.panel()!);
    expect(view.shown()).toBe(true);
    await userEvent.click(document.body, { position: { x: 600, y: 600 } });
    expect(view.panel()!.getAttribute('aria-expanded')).toBe('false');
    expect(view.shown()).toBe(false);
  });

  test('hover opens after the intent delay and leaving keeps the popup for the bridge; a pinned or closed menu does not wait', async () => {
    const view = await mount([unlinked('One'), author('Two')]);
    const waitBefore = () => getComputedStyle(view.popup()!).transitionDelay;
    expect(waitBefore()).toBe('0.3s');
    await userEvent.hover(view.panel()!);
    expect(view.panel()!.getAttribute('aria-expanded')).toBe('true');
    expect(waitBefore()).toBe('0.25s');
    await userEvent.click(view.panel()!);
    expect(view.shown()).toBe(true);
    expect(getComputedStyle(view.popup()!).transitionProperty).toBe('none');
  });

  test('a link arrow: hover lists every author, the first too; a click follows the first author\'s link and closes the popup unpinned', async () => {
    const view = await mount([author('One'), author('Two'), author('Three')]);
    const arrow = view.panel() as HTMLAnchorElement;
    expect(arrow.tagName).toBe('A');
    expect([arrow.href, arrow.target, arrow.rel]).toEqual(['https://www.youtube.com/@One', '_blank', 'noopener noreferrer']);
    // The popup is stated as the link's expandable part; the list is not a menu.
    expect(arrow.getAttribute('aria-expanded')).toBe('false');
    expect(arrow.hasAttribute('aria-haspopup')).toBe(false);
    await userEvent.hover(arrow);
    await expect.poll(view.shown).toBe(true);
    expect(arrow.getAttribute('aria-expanded')).toBe('true');
    expect(view.links().map(link => link.href)).toEqual(['https://www.youtube.com/@One', 'https://www.youtube.com/@Two', 'https://www.youtube.com/@Three']);
    await userEvent.click(arrow);
    expect(view.followed).toEqual(['https://www.youtube.com/@One']);
    // Closed at once and not pinned: the pointer still on the arrow does not bring it back.
    expect(view.shown()).toBe(false);
    expect(arrow.getAttribute('aria-expanded')).toBe('false');
    expect(view.popup()!.classList.contains('visible')).toBe(false);
    // Leaving and coming back (as after the new tab) shows it on hover again, and leaving hides it.
    await userEvent.unhover(arrow);
    await userEvent.hover(arrow);
    await expect.poll(view.shown).toBe(true);
    await userEvent.unhover(arrow);
    await userEvent.hover(view.plate().querySelector('.theater-title-hud-viewport')!);
    await expect.poll(view.shown).toBe(false);
    // Enter on the focused arrow follows the link too and opens nothing.
    arrow.focus();
    await userEvent.keyboard('{Enter}');
    expect(view.followed).toEqual(['https://www.youtube.com/@One', 'https://www.youtube.com/@One']);
    expect(arrow.getAttribute('aria-expanded')).toBe('false');
  });

  test('one author with a link: the whole panel is that link, with no popup or menu shell', async () => {
    const view = await mount([author('Harbour', { verified: true, stat: '1.26M subscribers' })]);
    const panel = view.panel() as HTMLAnchorElement;
    expect(panel.tagName).toBe('A');
    expect([panel.href, panel.target, panel.rel]).toEqual(['https://www.youtube.com/@Harbour', '_blank', 'noopener noreferrer']);
    for (const name of ['aria-haspopup', 'aria-expanded']) expect(panel.hasAttribute(name)).toBe(false);
    expect(view.popup()).toBeNull();
    const root = view.plate().querySelector<HTMLElement>('.theater-byline')!;
    expect(root.classList.contains('theater-menu')).toBe(false);
    expect(root.dataset.teSurface).toBeUndefined();
    expect(getComputedStyle(panel).cursor).toBe('pointer');
    await userEvent.click(panel.querySelector('.theater-byline-name')!);
    panel.focus();
    await userEvent.keyboard('{Enter}');
    expect(view.followed).toEqual(['https://www.youtube.com/@Harbour', 'https://www.youtube.com/@Harbour']);
    // ↓ on it is not the byline's: nothing opens.
    await userEvent.keyboard('{ArrowDown}');
    expect(view.popup()).toBeNull();
  });

  test('one author without a link: a plain panel that takes no focus and never lifts', async () => {
    const view = await mount([unlinked('Harbour')]);
    const panel = view.panel()!;
    expect(panel.tagName).toBe('DIV');
    expect(view.popup()).toBeNull();
    for (const name of ['aria-haspopup', 'aria-expanded', 'tabindex', 'role']) expect(panel.hasAttribute(name)).toBe(false);
    panel.focus();
    expect(getPlayerUiRoot().activeElement).not.toBe(panel);
    expect(getComputedStyle(panel).cursor).toBe('default');
    await userEvent.hover(panel);
    expect(getComputedStyle(panel.querySelector('.theater-byline-fill')!, '::after').opacity).toBe('0');
    expect(getComputedStyle(panel.querySelector('.theater-byline-rim')!).transform).toBe('none');
    await userEvent.click(panel);
    expect(view.followed).toEqual([]);
  });

  test('changing shape (one to several authors and back, a link arriving) replaces the panel cleanly and keeps focus on it', async () => {
    const view = await mount([unlinked('One')]);
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const pointer = (spy: typeof added | typeof removed) => spy.mock.calls.filter(([type]) => type === 'pointerdown').length;
    try {
      // A link arriving later makes the panel a link.
      view.publish([author('One')]);
      expect(view.panel()!.tagName).toBe('A');
      expect(view.popup()).toBeNull();
      view.panel()!.focus();
      // A second author arriving brings the popup, and focus stays on the arrow.
      view.publish([author('One'), author('Two')]);
      expect(view.popup()).not.toBeNull();
      expect(getPlayerUiRoot().activeElement).toBe(view.panel());
      expect(view.plate().querySelectorAll('.theater-byline')).toHaveLength(1);
      await userEvent.keyboard('{ArrowDown}');
      expect(getPlayerUiRoot().activeElement).toBe(view.links()[0]);
      // Back to one while the list is open: no popup, listener or open state is left, and focus is on the link.
      view.publish([author('One')]);
      expect(view.popup()).toBeNull();
      expect(view.plate().querySelector('.theater-menu, .is-open, .is-suppressed, .visible')).toBeNull();
      expect(getPlayerUiRoot().activeElement).toBe(view.panel());
      expect(pointer(removed)).toBe(pointer(added));
      // And to several again: a fresh popup, closed, that hover and the keyboard open as before.
      view.publish([author('One'), author('Two')]);
      expect(view.panel()!.getAttribute('aria-expanded')).toBe('false');
      await userEvent.keyboard('{ArrowDown}');
      expect(view.shown()).toBe(true);
      await userEvent.keyboard('{Escape}');
      expect(getPlayerUiRoot().activeElement).toBe(view.panel());
      // The same shape with other authors keeps the panel and moves its link.
      const panel = view.panel();
      view.publish([author('Three'), author('Four')], 'Another video');
      expect(view.panel()).toBe(panel);
      expect((view.panel() as HTMLAnchorElement).href).toBe('https://www.youtube.com/@Three');
      scope!.dispose();
      expect(pointer(removed)).toBe(pointer(added));
    } finally {
      added.mockRestore();
      removed.mockRestore();
    }
  });

  test('follows the provider setting live and keeps the panel out while it is off', async () => {
    const view = await mount([author('One')], { showAuthor: false });
    expect(view.panel()).toBeNull();
    await view.settings.set('youtube', 'showAuthor', true);
    expect(view.names()).toBe('One');
    await view.settings.set('youtube', 'showAuthor', false);
    expect(view.panel()).toBeNull();
  });

  test('the global switch off wins over the provider setting, builds nothing and reads no avatar; on restores it live', async () => {
    const reads: string[] = [];
    const readAccent: ReadAccent = url => { reads.push(url); return Promise.resolve('#3792c7'); };
    const plain = await mount(null, { global: false });
    const bare = plain.plate().innerHTML;
    scope!.dispose();
    const view = await mount([author('Harbour', { avatarUrl: AVATAR }), author('Two', { avatarUrl: AVATAR })], { global: false, readAccent });
    // Off: the title row is the one a title without authors gets, with no panel, popup or avatar image anywhere.
    expect(view.plate().innerHTML).toBe(bare);
    expect(getPlayerUiRoot().querySelector('.theater-byline, img')).toBeNull();
    await idle();
    expect(reads).toEqual([]);
    // On again, without a new title: the panel returns with its accent.
    await setGlobal(true);
    expect(view.names()).toBe('Harbour&Two');
    await expect.poll(() => view.panel()!.style.getPropertyValue('--accent-color')).toBe('#3792c7');
    // On defers to the provider: its own switch off still hides the panel.
    await view.settings.set('youtube', 'showAuthor', false);
    expect(view.panel()).toBeNull();
    await view.settings.set('youtube', 'showAuthor', true);
    expect(view.names()).toBe('Harbour&Two');
    // Off while showing takes the panel and its accent out; a later title stays bare.
    await setGlobal(false);
    expect(view.panel()).toBeNull();
    view.publish([author('Three', { avatarUrl: 'https://yt3.ggpht.com/three=s88' })], 'Another video');
    expect(view.plate().querySelector('.theater-byline')).toBeNull();
    await idle();
    expect(reads).toEqual([AVATAR]);
  });

  test('turning the byline off or leaving theater stops an avatar read before it draws', async () => {
    const signals: AbortSignal[] = [];
    const readAccent: ReadAccent = (_url, signal) => { signals.push(signal); return new Promise(() => {}); };
    await mount([author('Harbour', { avatarUrl: AVATAR })], { readAccent });
    await expect.poll(() => signals.length).toBe(1);
    await setGlobal(false);
    expect(signals[0].aborted).toBe(true);
    await setGlobal(true);
    await expect.poll(() => signals.length).toBe(2);
    expect(signals[1].aborted).toBe(false);
    scope!.dispose();
    expect(signals[1].aborted).toBe(true);
  });

  test('a cleared title forgets its authors, so turning the byline on before the next title brings back nothing', async () => {
    const reads: string[] = [];
    const view = await mount([author('Harbour', { avatarUrl: AVATAR })], { global: false, readAccent: url => { reads.push(url); return Promise.resolve(null); } });
    const previous = view.plate();
    view.clear();
    expect(previous.isConnected).toBe(false);
    await setGlobal(true);
    expect(previous.querySelector('.theater-byline')).toBeNull();
    expect(getPlayerUiRoot().querySelector('.theater-byline')).toBeNull();
    await idle();
    expect(reads).toEqual([]);
    view.publish([author('Two')], 'The next video');
    expect(view.names()).toBe('Two');
  });

  test('while it cannot show, the byline binds nothing to the window; it binds and unbinds with the switch', async () => {
    const view = await mount([author('One'), author('Two')], { global: false });
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const pointer = (spy: typeof added | typeof removed) => spy.mock.calls.filter(([type]) => type === 'pointerdown').length;
    try {
      view.publish([author('Two'), author('Three')], 'Another video');
      expect(pointer(added)).toBe(0);
      await setGlobal(true);
      expect(view.names()).toBe('Two&Three');
      const bound = pointer(added);
      expect(bound).toBeGreaterThan(0);
      await setGlobal(false);
      expect(view.panel()).toBeNull();
      expect(pointer(removed)).toBe(bound);
    } finally {
      added.mockRestore();
      removed.mockRestore();
    }
  });

  test('a title without authors takes the panel out; an equal publication leaves its nodes alone', async () => {
    const view = await mount([author('One')]);
    const panel = view.panel();
    view.publish([author('One')]);
    expect(view.panel()).toBe(panel);
    view.publish(null, 'Another video');
    expect(view.panel()).toBeNull();
    view.publish([author('Two')], 'A third video');
    expect(view.names()).toBe('Two');
    scope!.dispose();
    expect(view.panel()).toBeNull();
  });

  test('the chevron points into the title and the panel fills from the plate\'s start edge in right-to-left interfaces too', async () => {
    const view = await mount([author('One')], { dir: 'rtl' });
    const fill = view.panel()!.querySelector('.theater-byline-fill')!;
    expect(getComputedStyle(fill).clipPath.startsWith('polygon(22px 0px')).toBe(true);
    expect(view.panel()!.getBoundingClientRect().right).toBeCloseTo(view.plate().getBoundingClientRect().right, 2);
    // A left-to-right stat lines up under the name at the row's right-to-left start, and the hover edge marks that start.
    view.publish([author('One', { stat: '1.26M subscribers' }), author('Two')]);
    await view.openList();
    const row = view.links()[0];
    await userEvent.hover(row);
    expect(getComputedStyle(row, '::before').right).toBe('0px');
    const [name, stat] = ['.theater-byline-row-title', '.theater-byline-row-stat'].map(selector => {
      const text = document.createRange();
      text.selectNodeContents(row.querySelector(selector)!);
      return text.getBoundingClientRect();
    });
    expect(stat.right).toBeCloseTo(name.right, 0);
    // The row's accent ramp starts from its right-to-left start too.
    expect(getComputedStyle(row).backgroundImage).toMatch(/^linear-gradient\(to left,/);
    view.plate().dir = 'ltr';
    expect(getComputedStyle(view.panel()!.querySelector('.theater-byline-fill')!).clipPath.startsWith('polygon(0px 0px')).toBe(true);
  });

  test('shows the accent at rest; hover, focus and open lift the panel and step the arrowhead forward', async () => {
    const view = await mount([author('One')]);
    const fill = view.panel()!.querySelector('.theater-byline-fill')!;
    const rim = view.panel()!.querySelector<HTMLElement>('.theater-byline-rim')!;
    const glow = view.panel()!.querySelector<HTMLElement>('.theater-byline-glow')!;
    const ramp = getComputedStyle(fill, '::before');
    const lift = () => getComputedStyle(fill, '::after').opacity;
    // The resting layer is the accent ramp, always shown.
    expect(ramp.opacity).toBe('1');
    expect(ramp.backgroundImage).toContain('linear-gradient');
    expect(ramp.backgroundImage).not.toMatch(/rgba\(0, 0, 0/);
    expect(lift()).toBe('0');
    expect(getComputedStyle(rim).transform).toBe('none');
    const rest = getComputedStyle(glow).opacity;
    await userEvent.hover(view.panel()!);
    await expect.poll(lift).toBe('1');
    expect(getComputedStyle(fill, '::before').opacity).toBe('1');
    await expect.poll(() => getComputedStyle(rim).transform).toBe('matrix(1, 0, 0, 1, 2, 0)');
    await expect.poll(() => getComputedStyle(glow).opacity).not.toBe(rest);
    // The keyboard gets the same lift, and the ink ring.
    await userEvent.unhover(view.panel()!);
    await userEvent.click(document.body, { position: { x: 600, y: 600 } });
    await expect.poll(lift).toBe('0');
    view.panel()!.focus();
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}{Tab}');
    expect(view.panel()!.matches(':focus-visible')).toBe(true);
    await expect.poll(lift).toBe('1');
    expect(getComputedStyle(view.panel()!.querySelector('.theater-byline-fill')!).boxShadow).toContain('inset');
    // Right to left, it steps towards the title on the left; Reduce motion keeps it in place.
    view.plate().dir = 'rtl';
    await expect.poll(() => getComputedStyle(rim).transform).toBe('matrix(1, 0, 0, 1, -2, 0)');
    (view.plate().getRootNode() as ShadowRoot).host.setAttribute('data-motion', 'reduced');
    await expect.poll(() => getComputedStyle(rim).transform).toBe('none');
    expect(lift()).toBe('1');
  });

  test('over the panel or its popup the scrolling title keeps running and shows no tooltip; over the title it pauses', async () => {
    const view = await mount([author('One'), author('Two')], {}, LONG_TITLE);
    await expect.poll(() => view.plate().classList.contains('marquee')).toBe(true);
    const track = view.plate().querySelector('.theater-title-hud-track')!;
    const viewport = view.plate().querySelector('.theater-title-hud-viewport')!;
    const state = () => getComputedStyle(track).animationPlayState;
    expect(state()).toBe('running');
    expect(view.plate().title).toBe(LONG_TITLE);
    await userEvent.hover(view.panel()!);
    expect(view.panel()!.matches(':hover')).toBe(true);
    expect(state()).toBe('running');
    expect(tooltip(view.panel()!.querySelector('.theater-byline-name'))).toBe('');
    // The popup's rows are the panel's too.
    await expect.poll(view.shown).toBe(true);
    await userEvent.hover(view.rows()[1]);
    expect(state()).toBe('running');
    expect(tooltip(view.rows()[1].querySelector('.theater-byline-row-title'))).toBe('');
    // The arrowhead stays the panel's where the title's start fade reaches under it.
    const panel = view.panel()!.getBoundingClientRect();
    const tip = getPlayerUiRoot().elementFromPoint(panel.right - 4, (panel.top + panel.bottom) / 2);
    expect(view.panel()!.contains(tip)).toBe(true);
    // The title itself: paused, with the full title as its tooltip.
    await userEvent.hover(viewport);
    await expect.poll(state).toBe('paused');
    expect(tooltip(view.plate().querySelector('.theater-title-hud-text'))).toBe(LONG_TITLE);
    await userEvent.hover(view.panel()!);
    await expect.poll(state).toBe('running');
  });

  test('with Reduce motion, hovering the panel leaves the shortened title as it is; hovering the title reveals it', async () => {
    document.documentElement.dataset.motion = 'reduced';
    try {
      const view = await mount([author('One')], {}, LONG_TITLE, () => getPlayerUiRoot().host.setAttribute('data-motion', 'reduced'));
      await expect.poll(() => view.plate().classList.contains('marquee')).toBe(true);
      const smart = () => getComputedStyle(view.plate().querySelector('.theater-title-hud-smart')!).display;
      expect(smart()).toBe('flex');
      expect(view.plate().hasAttribute('title')).toBe(false);
      await userEvent.hover(view.panel()!);
      expect(smart()).toBe('flex');
      await userEvent.hover(view.plate().querySelector('.theater-title-hud-viewport')!);
      await expect.poll(smart).toBe('none');
    } finally {
      delete document.documentElement.dataset.motion;
    }
  });

  for (const mode of APPEARANCE_MODES) {
    test(`every shape has no blocking accessibility violations, the popup open or closed: ${mode.name}`, async () => {
      const view = await mount([author('Harbour Films', { avatarUrl: AVATAR, verified: true, stat: '1.26M subscribers' }), author('Two')]);
      const host = getPlayerUiRoot().host as HTMLElement;
      mode.apply(host);
      await expect.poll(() => mode.applied(host)).toBe(true);
      expect(await blockingViolations(view.plate()), 'link arrow, closed').toEqual([]);
      await view.openList();
      expect(await blockingViolations(view.plate()), 'link arrow, open').toEqual([]);
      await userEvent.keyboard('{Escape}');
      view.publish([unlinked('Harbour Films'), author('Two')]);
      await userEvent.click(view.panel()!);
      expect(await blockingViolations(view.plate()), 'button arrow, open').toEqual([]);
      for (const shown of [[author('Harbour Films', { verified: true })], [unlinked('Harbour Films')]]) {
        view.publish(shown);
        expect(await blockingViolations(view.plate()), `one author, ${shown[0].url ? 'linked' : 'plain'}`).toEqual([]);
      }
    });
  }
  test('colors the panel with the first author\'s avatar, and each row with its own once the popup has opened', async () => {
    const reads: string[] = [];
    const TWO = 'https://yt3.ggpht.com/two=s88', GRAY = 'https://yt3.ggpht.com/gray=s88';
    const colors: Record<string, string | null> = { [AVATAR]: '#3792c7', [TWO]: '#b14c7d', [GRAY]: null };
    const readAccent: ReadAccent = url => { reads.push(url); return Promise.resolve(colors[url] ?? null); };
    const view = await mount([author('Harbour', { avatarUrl: AVATAR }), author('Two', { avatarUrl: TWO }), author('Gray', { avatarUrl: GRAY }), author('Plain')], { readAccent });
    const edge = (node: Element) => getComputedStyle(node).getPropertyValue('--edge');
    const accent = (node: Element) => getComputedStyle(node).getPropertyValue('--accent-color');
    await expect.poll(() => accent(view.panel()!)).toBe('#3792c7');
    const userAccent = accent(view.plate());
    // Only the first author's avatar is read while the popup has never opened.
    await idle();
    expect(reads).toEqual([AVATAR]);
    const rim = view.panel()!.querySelector('.theater-byline-rim')!;
    expect(edge(rim)).toContain('#3792c7');
    expect(getComputedStyle(view.panel()!).getPropertyValue('--contrast-accent')).toMatch(/^#[0-9a-f]{6}$/);
    const box = view.list().getBoundingClientRect();
    await view.openList();
    // Each row takes its own avatar's color for its ramp, lit edge and monogram; without a color, the user's accent.
    await expect.poll(() => view.rows().map(accent)).toEqual(['#3792c7', '#b14c7d', userAccent, userAccent]);
    expect(reads.slice(1).sort()).toEqual([AVATAR, GRAY, TWO].sort());
    expect(edge(view.rows()[1])).toContain('#b14c7d');
    // The monogram of an avatar that cannot load (offline here) takes its row's color, as the ramp does.
    const mixed = (color: string) => {
      const probe = view.plate().appendChild(document.createElement('span'));
      probe.style.background = `color-mix(in srgb, ${color} 72%, #000000)`;
      const value = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return value;
    };
    await expect.poll(() => view.rows()[1].querySelector('.theater-byline-monogram')).not.toBeNull();
    expect(getComputedStyle(view.rows()[1].querySelector('.theater-byline-monogram')!).backgroundColor).toBe(mixed('#b14c7d'));
    expect(getComputedStyle(view.rows()[1]).backgroundImage).toContain('linear-gradient');
    // The colors arrive without moving anything.
    expect(view.list().getBoundingClientRect().toJSON()).toEqual(box.toJSON());
    await userEvent.keyboard('{Escape}');
    // Another first author brings its own color; a title without authors takes it away with the panel.
    view.publish([author('Two', { avatarUrl: 'https://yt3.ggpht.com/two=s88' })], 'Another video');
    await expect.poll(() => getComputedStyle(view.panel()!).getPropertyValue('--accent-color')).toBe('#b14c7d');
    view.publish(null, 'A third video');
    view.publish([author('Three')], 'A fourth video');
    expect(view.panel()!.style.getPropertyValue('--accent-color')).toBe('');
  });

  test('keeps the user\'s accent without an avatar or a color, and drops a color read for an author who left', async () => {
    const pending = new Map<string, (accent: string | null) => void>();
    const readAccent: ReadAccent = url => new Promise(resolve => pending.set(url, resolve));
    const view = await mount([author('Plain')], { readAccent });
    const accent = () => view.panel()!.style.getPropertyValue('--accent-color');
    await new Promise(resolve => requestIdleCallback(resolve));
    expect(pending.size).toBe(0);
    view.publish([author('Gray', { avatarUrl: 'https://yt3.ggpht.com/gray=s88' })]);
    await expect.poll(() => pending.size).toBe(1);
    pending.get('https://yt3.ggpht.com/gray=s88')!(null);
    view.publish([author('First', { avatarUrl: AVATAR })]);
    await expect.poll(() => pending.has(AVATAR)).toBe(true);
    // The first author is replaced before the read returns: the late color is not applied.
    view.publish([author('Second', { avatarUrl: 'https://yt3.ggpht.com/second=s88' })], 'Another video');
    pending.get(AVATAR)!('#3792c7');
    await expect.poll(() => pending.has('https://yt3.ggpht.com/second=s88')).toBe(true);
    expect(accent()).toBe('');
    pending.get('https://yt3.ggpht.com/second=s88')!('#07803f');
    await expect.poll(accent).toBe('#07803f');
  });

  test('a row read that returns after its list was replaced paints nothing; the next list reads its own avatars', async () => {
    const pending = new Map<string, Array<{ resolve: (accent: string | null) => void; signal: AbortSignal }>>();
    const readAccent: ReadAccent = (url, signal) => new Promise(resolve => pending.set(url, [...pending.get(url) ?? [], { resolve, signal }]));
    const TWO = 'https://yt3.ggpht.com/two=s88', THREE = 'https://yt3.ggpht.com/three=s88';
    const view = await mount([author('One'), author('Two', { avatarUrl: TWO })], { readAccent });
    await view.openList();
    await expect.poll(() => pending.has(TWO)).toBe(true);
    // Other authors arrive while the read is under way: it is given up, and the new rows read their own avatars.
    view.publish([author('One'), author('Three', { avatarUrl: THREE })], 'Another video');
    expect(pending.get(TWO)![0].signal.aborted).toBe(true);
    await expect.poll(() => pending.has(THREE)).toBe(true);
    pending.get(TWO)![0].resolve('#b14c7d');
    await idle();
    const accent = () => view.rows()[1].style.getPropertyValue('--accent-color');
    expect(accent()).toBe('');
    pending.get(THREE)![0].resolve('#07803f');
    await expect.poll(accent).toBe('#07803f');
    // Ending the byline gives up a read still under way.
    view.publish([author('One'), author('Two', { avatarUrl: TWO })], 'A third video');
    await expect.poll(() => pending.get(TWO)!.length).toBe(2);
    scope!.dispose();
    expect(pending.get(TWO)![1].signal.aborted).toBe(true);
  });

  test('the same channel with another size of its avatar keeps its color until that one is read; another channel resets it', async () => {
    const pending = new Map<string, (accent: string | null) => void>();
    const readAccent: ReadAccent = url => new Promise(resolve => pending.set(url, resolve));
    const small = 'https://yt3.ggpht.com/same=s48', large = 'https://yt3.ggpht.com/same=s88';
    const view = await mount([author('Harbour', { avatarUrl: small })], { readAccent });
    const accent = () => view.panel()!.style.getPropertyValue('--accent-color');
    await expect.poll(() => pending.has(small)).toBe(true);
    pending.get(small)!('#3792c7');
    await expect.poll(accent).toBe('#3792c7');
    view.publish([author('Harbour', { avatarUrl: large })]);
    expect(accent()).toBe('#3792c7');
    await expect.poll(() => pending.has(large)).toBe(true);
    pending.get(large)!('#3b94c8');
    await expect.poll(accent).toBe('#3b94c8');
    view.publish([author('Other', { avatarUrl: 'https://yt3.ggpht.com/other=s88' })], 'Another video');
    expect(accent()).toBe('');
  });

  test('a panel that ends before the page is idle reads nothing', async () => {
    const reads: string[] = [];
    await mount([author('Harbour', { avatarUrl: AVATAR })], { readAccent: url => { reads.push(url); return Promise.resolve(null); } });
    scope!.dispose();
    // Idle callbacks run in order, so this one runs after the panel's would have.
    await idle();
    expect(reads).toEqual([]);
  });
});

describe('readAvatarAccent', () => {
  /** A PNG data URL: a white square with a colored disc, the way many avatars look. */
  function avatarImage(color: string): string {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 88;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 88, 88);
    context.fillStyle = color;
    context.beginPath();
    context.arc(44, 44, 30, 0, Math.PI * 2);
    context.fill();
    return canvas.toDataURL('image/png');
  }

  test('reads the dominant color of a readable avatar once, and gives none for a gray or failing one', async () => {
    const blue = avatarImage('#3792c7');
    const accent = await readAvatarAccent(blue);
    // Downscaling blends the disc's edge with the white around it, a little differently in each engine.
    const channels = (hex: string) => hex.slice(1).match(/../g)!.map(channel => parseInt(channel, 16));
    channels(accent!).forEach((channel, index) => expect(Math.abs(channel - channels('#3792c7')[index])).toBeLessThan(12));
    expect(await readAvatarAccent(blue)).toBe(accent);
    expect(await readAvatarAccent(avatarImage('#9a9a9a'))).toBeNull();
    expect(await readAvatarAccent(`${location.origin}/missing-avatar.png`)).toBeNull();
  });

  test('a read every caller gave up draws nothing and leaves the avatar unread', async () => {
    const red = avatarImage('#c73737');
    const draw = vi.spyOn(CanvasRenderingContext2D.prototype, 'drawImage');
    try {
      const first = new AbortController(), second = new AbortController();
      const reads = [readAvatarAccent(red, first.signal), readAvatarAccent(red, second.signal)];
      first.abort();
      second.abort();
      expect(await Promise.all(reads)).toEqual([null, null]);
      expect(draw).not.toHaveBeenCalled();
      // Nothing was remembered for it, so the next caller reads it.
      expect(await readAvatarAccent(red)).toMatch(/^#[0-9a-f]{6}$/);
      expect(draw).toHaveBeenCalledTimes(1);
    } finally {
      draw.mockRestore();
    }
  });
});
