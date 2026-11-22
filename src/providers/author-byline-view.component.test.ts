import { afterEach, describe, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

import { mountHudStage } from '../../.storybook/hud-stage';
import { DisposableScope } from '../core/disposable-scope';
import type { ContentAuthor } from '../media-features/content-title';
import { blockingViolations } from '../test-utils/axe';
import { createHud, TITLE_HUD_CLASS } from '../ui/hud';
import { bindMenuPopover } from '../ui/menu-popover';
import { getPlayerUiRoot, queryPlayerUi } from '../ui/root';

import { providerAuthorHosts } from './author-byline';
import { mountAuthorByline, readAvatarAccent } from './author-byline-view';
import { createYouTubeSettings } from './youtube/settings';

const HOSTS = providerAuthorHosts([{ domain: 'youtube.com', includeSubdomains: true }], ['yt3.ggpht.com']);
const AVATAR = 'https://yt3.ggpht.com/avatar=s88';
const author = (name: string, overrides: Partial<ContentAuthor> = {}): ContentAuthor => ({
  id: name, name, url: `https://www.youtube.com/@${name.replace(/\W/g, '')}`, avatarUrl: null, verified: false, stat: null, ...overrides
});

let scope: DisposableScope | undefined;
afterEach(() => { scope?.dispose(); scope = undefined; });

const LONG_TITLE = 'Building a cedar-strip canoe, part 3: fibreglass, epoxy, the first coat of varnish and every mistake left in on purpose';
/** The tooltip a browser shows over `node`: the nearest `title` from it outwards, where an empty one means none. */
function tooltip(node: Element | null): string | null {
  for (let current = node; current; current = current.parentElement) if (current.hasAttribute('title')) return current.getAttribute('title');
  return null;
}

type ReadAccent = (avatarUrl: string) => Promise<string | null>;
/** Tests stay off the network: without a reader of their own, no avatar has a color. */
const noAccent: ReadAccent = () => Promise.resolve(null);

async function mount(
  authors: readonly ContentAuthor[] | null,
  options: { showAuthor?: boolean; dir?: 'rtl'; readAccent?: ReadAccent } = {},
  firstTitle = 'Building a cedar-strip canoe',
  beforePublish?: () => void
) {
  const stage = mountHudStage();
  beforePublish?.();
  const hud = createHud(stage.host, () => {}, stage.clock);
  scope = new DisposableScope();
  stage.onDispose(() => hud.syncContentTitle(null));
  const settings = createYouTubeSettings();
  await settings.ready;
  if (options.showAuthor === false) await settings.set('youtube', 'showAuthor', false);
  const byline = mountAuthorByline({ scope, bindMenu: bindMenuPopover }, { provider: 'youtube', hosts: HOSTS, settings, readAccent: options.readAccent ?? noAccent });
  const publish = (next: readonly ContentAuthor[] | null, title = 'Building a cedar-strip canoe') =>
    hud.syncContentTitle({ title, subtitle: null, authors: next }, byline);
  publish(authors, firstTitle);
  const plate = () => queryPlayerUi<HTMLElement>(`.${TITLE_HUD_CLASS}`)!;
  if (options.dir) plate().dir = options.dir;
  const panel = () => plate()?.querySelector<HTMLButtonElement>('.theater-byline-panel') ?? null;
  const popup = () => plate()?.querySelector<HTMLElement>('.theater-byline-popup') ?? null;
  const list = () => popup()!.querySelector<HTMLUListElement>('.theater-byline-list')!;
  const rows = () => [...list().children].map(item => item.firstElementChild as HTMLElement);
  const names = () => panel()?.querySelector('.theater-byline-names')?.textContent;
  const links = () => [...plate().querySelectorAll<HTMLAnchorElement>('a.theater-byline-row')];
  const shown = () => getComputedStyle(popup()!).visibility === 'visible';
  return { hud, publish, plate, panel, names, popup, list, rows, links, shown, settings, stage };
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
    // The visible name is the accessible name.
    expect(view.panel()!.hasAttribute('aria-label')).toBe(false);
    expect(view.panel()!.querySelector<HTMLImageElement>('img.theater-byline-avatar')!.referrerPolicy).toBe('no-referrer');
    expect(view.panel()!.querySelector('.theater-byline-verified')!.getAttribute('aria-label')).toBe('Verified');
  });

  test('labels two authors "A & B" and three "A +2", naming everyone for assistive technology', async () => {
    const view = await mount([author('QuietHarbor'), author('Bottlewright')]);
    expect(view.names()).toBe('QuietHarbor&Bottlewright');
    view.publish([author('A'), author('B'), author('C')]);
    expect(view.names()).toBe('A+2');
    expect(view.panel()!.getAttribute('aria-label')).toBe('A, B, and C');
    expect(view.rows()).toHaveLength(3);
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
    await userEvent.click(view.panel()!);
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
    const followed: string[] = [];
    // Stop the navigation: the test only needs the activation.
    view.popup()!.addEventListener('click', event => {
      event.preventDefault();
      followed.push((event.target as Element).closest('a')!.href);
    });
    await userEvent.click(view.panel()!);
    await userEvent.click(view.links()[1].querySelector('.theater-byline-row-title')!);
    view.links()[0].focus();
    await userEvent.keyboard('{Enter}');
    expect(followed).toEqual(['https://www.youtube.com/@Two', 'https://www.youtube.com/@One']);
  });

  test('one block frames the rows: it alone has the border, corners and shadow, and clips the rows to its corners', async () => {
    const view = await mount([author('One'), author('Two'), author('Three')]);
    await userEvent.click(view.panel()!);
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
    // One author: a block of a single row with all four corners.
    view.publish([author('Solo')], 'A solo video');
    await userEvent.click(view.panel()!);
    expect(view.rows()).toHaveLength(1);
    expect(corners(view.rows()[0])).toEqual(['11px', '11px', '11px', '11px']);
  });

  test('alternates the rows\' tone from the second author; a pointer lifts the row and marks its start; focus draws a ring inside it', async () => {
    const view = await mount([author('One'), author('Two'), author('Three')]);
    await userEvent.click(view.panel()!);
    const [first, second, third] = view.links();
    const fill = (row: HTMLElement) => getComputedStyle(row).backgroundColor;
    const edge = (row: HTMLElement) => getComputedStyle(row, '::before');
    expect(fill(second)).not.toBe(fill(first));
    expect(fill(third)).toBe(fill(first));
    const restFill = fill(third);
    expect(edge(third).content).toBe('none');
    await userEvent.hover(third);
    await expect.poll(() => fill(third)).not.toBe(restFill);
    expect(fill(third)).not.toBe(fill(second));
    expect(edge(third).width).toBe('3px');
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

  test('Enter and ↓ open the popup at once with focus on the first link; ↑/↓ move, Escape returns to the panel', async () => {
    const view = await mount([author('One'), author('Two')]);
    view.panel()!.focus();
    await userEvent.keyboard('{Enter}');
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
  });

  test('a click pins the popup at once; a press outside closes it', async () => {
    const view = await mount([author('One')]);
    await userEvent.click(view.panel()!);
    expect(view.shown()).toBe(true);
    await userEvent.click(document.body, { position: { x: 600, y: 600 } });
    expect(view.panel()!.getAttribute('aria-expanded')).toBe('false');
    expect(view.shown()).toBe(false);
  });

  test('hover opens after the intent delay and leaving keeps the popup for the bridge; a pinned or closed menu does not wait', async () => {
    const view = await mount([author('One')]);
    const waitBefore = () => getComputedStyle(view.popup()!).transitionDelay;
    expect(waitBefore()).toBe('0.3s');
    await userEvent.hover(view.panel()!);
    expect(view.panel()!.getAttribute('aria-expanded')).toBe('true');
    expect(waitBefore()).toBe('0.25s');
    await userEvent.click(view.panel()!);
    expect(view.shown()).toBe(true);
    expect(getComputedStyle(view.popup()!).transitionProperty).toBe('none');
  });

  test('follows the provider setting live and keeps the panel out while it is off', async () => {
    const view = await mount([author('One')], { showAuthor: false });
    expect(view.panel()).toBeNull();
    await view.settings.set('youtube', 'showAuthor', true);
    expect(view.names()).toBe('One');
    await view.settings.set('youtube', 'showAuthor', false);
    expect(view.panel()).toBeNull();
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
    view.publish([author('One', { stat: '1.26M subscribers' })]);
    await userEvent.click(view.panel()!);
    const row = view.links()[0];
    await userEvent.hover(row);
    expect(getComputedStyle(row, '::before').right).toBe('0px');
    const [name, stat] = ['.theater-byline-row-title', '.theater-byline-row-stat'].map(selector => {
      const text = document.createRange();
      text.selectNodeContents(row.querySelector(selector)!);
      return text.getBoundingClientRect();
    });
    expect(stat.right).toBeCloseTo(name.right, 0);
    view.plate().dir = 'ltr';
    expect(getComputedStyle(fill).clipPath.startsWith('polygon(0px 0px')).toBe(true);
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
    await userEvent.click(view.panel()!);
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

  test('the open popup has no blocking accessibility violations', async () => {
    const view = await mount([author('Harbour Films', { avatarUrl: AVATAR, verified: true, stat: '1.26M subscribers' }), author('Two')]);
    await userEvent.click(view.panel()!);
    expect(await blockingViolations(view.plate())).toEqual([]);
  });
  test('colors the panel with the first author\'s avatar and leaves the popup with the user\'s accent', async () => {
    const reads: string[] = [];
    const readAccent: ReadAccent = url => { reads.push(url); return Promise.resolve(url === AVATAR ? '#3792c7' : '#b14c7d'); };
    const view = await mount([author('Harbour', { avatarUrl: AVATAR }), author('Two', { avatarUrl: 'https://yt3.ggpht.com/two=s88' })], { readAccent });
    const edge = (node: Element) => getComputedStyle(node).getPropertyValue('--edge');
    await expect.poll(() => getComputedStyle(view.panel()!).getPropertyValue('--accent-color')).toBe('#3792c7');
    // Only the first author's avatar is read.
    expect(reads).toEqual([AVATAR]);
    const rim = view.panel()!.querySelector('.theater-byline-rim')!;
    expect(edge(rim)).toContain('#3792c7');
    expect(getComputedStyle(view.panel()!).getPropertyValue('--contrast-accent')).toMatch(/^#[0-9a-f]{6}$/);
    await userEvent.click(view.panel()!);
    expect(edge(view.rows()[0])).not.toContain('#3792c7');
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
    await new Promise(resolve => requestIdleCallback(resolve, { timeout: 2000 }));
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
});
