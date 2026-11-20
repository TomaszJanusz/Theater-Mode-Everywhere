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
import { mountAuthorByline } from './author-byline-view';
import { createYouTubeSettings } from './youtube/settings';

const HOSTS = providerAuthorHosts([{ domain: 'youtube.com', includeSubdomains: true }], ['yt3.ggpht.com']);
const AVATAR = 'https://yt3.ggpht.com/avatar=s88';
const author = (name: string, overrides: Partial<ContentAuthor> = {}): ContentAuthor => ({
  id: name, name, url: `https://www.youtube.com/@${name.replace(/\W/g, '')}`, avatarUrl: null, verified: false, stat: null, ...overrides
});

let scope: DisposableScope | undefined;
afterEach(() => { scope?.dispose(); scope = undefined; });

async function mount(authors: readonly ContentAuthor[] | null, options: { showAuthor?: boolean; dir?: 'rtl' } = {}) {
  const stage = mountHudStage();
  const hud = createHud(stage.host, () => {}, stage.clock);
  scope = new DisposableScope();
  stage.onDispose(() => hud.syncContentTitle(null));
  const settings = createYouTubeSettings();
  await settings.ready;
  if (options.showAuthor === false) await settings.set('youtube', 'showAuthor', false);
  const byline = mountAuthorByline({ scope, bindMenu: bindMenuPopover }, { provider: 'youtube', hosts: HOSTS, settings });
  const publish = (next: readonly ContentAuthor[] | null, title = 'Building a cedar-strip canoe') =>
    hud.syncContentTitle({ title, subtitle: null, authors: next }, byline);
  publish(authors);
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

  test('the open popup has no blocking accessibility violations', async () => {
    const view = await mount([author('Harbour Films', { avatarUrl: AVATAR, verified: true, stat: '1.26M subscribers' }), author('Two')]);
    await userEvent.click(view.panel()!);
    expect(await blockingViolations(view.plate())).toEqual([]);
  });
});
