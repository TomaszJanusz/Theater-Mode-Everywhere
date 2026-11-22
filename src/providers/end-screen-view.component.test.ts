import { afterEach, describe, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

import { DisposableScope } from '../core/disposable-scope';
import { blockingViolations } from '../test-utils/axe';
import { getPlayerUiRoot, mountPlayerUi } from '../ui/root';

import { mountEndScreenSettings, renderEndScreen, type EndScreenItem } from './end-screen-view';
import { createYouTubeSettings } from './youtube/settings';

let scope: DisposableScope;
afterEach(() => scope?.dispose());

const watch = (id: string) => new URL(`/watch?v=${id}`, location.href).href;
const item = (id: string, href?: string): EndScreenItem => ({ id, href, kind: 'video', title: `Video ${id}`, channel: 'A channel' });

/** Renders the shared tiles; every click, auxclick and context menu that reaches the grid is recorded, then cancelled. */
function mount(items: EndScreenItem[]) {
  scope = new DisposableScope();
  let mediaId = 'first';
  const activations: string[] = [];
  const events: Array<{ type: string; prevented: boolean }> = [];
  const curtain = document.createElement('div');
  curtain.className = 'theater-ended-curtain';
  const replay = document.createElement('button');
  replay.textContent = 'Replay';
  curtain.append(replay);
  mountPlayerUi(curtain);
  const grid = renderEndScreen({ read: () => ({ mediaId, items }), activate: id => { activations.push(id); return true; } },
    'Suggested videos', scope)!;
  curtain.append(grid);
  for (const type of ['click', 'auxclick', 'contextmenu']) grid.addEventListener(type, event => {
    events.push({ type, prevented: event.defaultPrevented });
    // The test page itself must never navigate or open a menu.
    event.preventDefault();
  });
  scope.add(() => curtain.remove());
  const tiles = [...grid.querySelectorAll<HTMLElement>('.theater-end-screen-tile')];
  return { tiles, replay, activations, events, stale: () => { mediaId = 'second'; } };
}

const click = (tile: HTMLElement, init: MouseEventInit, type = 'click') =>
  tile.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, ...init }));

describe('End-screen tiles as links', () => {
  test('only a same-origin http(s) URL makes a tile a link', () => {
    const { tiles } = mount([item('same', watch('one')), item('foreign', 'https://evil.test/watch?v=one'),
      item('script', 'javascript:alert(1)')]);
    expect(tiles.map(tile => tile.localName)).toEqual(['a', 'button', 'button']);
    expect((tiles[0] as HTMLAnchorElement).href).toBe(watch('one'));
    expect(tiles[0]!.getAttribute('rel')).toBe('noopener noreferrer');
    scope.dispose();
    const fallback = mount([item('data', 'data:text/html,<p>x</p>'), item('relative', '/watch?v=one'),
      item('ftp', `ftp://${location.host}/a`)]).tiles;
    expect(fallback.map(tile => tile.localName)).toEqual(['button', 'button', 'button']);
    expect(fallback.every(tile => !tile.hasAttribute('href'))).toBe(true);
  });

  test('a plain click activates in page; modified and middle clicks and the context menu stay the browser\'s', async () => {
    const { tiles, activations, events } = mount([item('one', watch('one'))]);
    const tile = tiles[0]!;
    await userEvent.click(tile);
    expect(activations).toEqual(['one']);
    expect(events).toEqual([{ type: 'click', prevented: true }]);
    expect(getPlayerUiRoot().activeElement).not.toBe(tile);
    events.length = 0;
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) click(tile, init);
    click(tile, { button: 1 }, 'auxclick');
    click(tile, { button: 2 }, 'contextmenu');
    expect(activations).toEqual(['one']);
    expect(events.every(event => !event.prevented)).toBe(true);
    expect(events.map(event => event.type)).toEqual(['click', 'click', 'click', 'click', 'click', 'auxclick', 'contextmenu']);
  });

  test('Enter is a plain click, each link is one named tab stop, and stale or disposed links never navigate', async () => {
    const { tiles, replay, activations, events, stale } = mount([item('one', watch('one')), item('two', watch('two'))]);
    replay.focus();
    await userEvent.tab();
    expect(getPlayerUiRoot().activeElement).toBe(tiles[0]);
    await expect.element(tiles[0]!).toHaveAccessibleName('Video one A channel');
    expect(tiles[0]!.querySelector('a, button, input, [tabindex]')).toBeNull();
    await userEvent.keyboard('{Enter}');
    expect(activations).toEqual(['one']);
    await userEvent.tab();
    expect(getPlayerUiRoot().activeElement).toBe(tiles[1]);
    expect(await blockingViolations(getPlayerUiRoot().host as HTMLElement)).toEqual([]);
    stale();
    click(tiles[1]!, {});
    scope.dispose();
    click(tiles[1]!, {});
    expect(activations).toEqual(['one']);
    expect(events).toEqual(Array.from({ length: 3 }, () => ({ type: 'click', prevented: true })));
  });

  for (const end of ['an older snapshot', 'a disposed mount'] as const) {
    test(`a link from ${end} opens nothing, in this tab or a new one`, () => {
      const { tiles, activations, events, stale } = mount([item('one', watch('one'))]);
      if (end === 'an older snapshot') stale(); else scope.dispose();
      const tile = tiles[0]!;
      click(tile, { ctrlKey: true });
      click(tile, { button: 1 }, 'auxclick');
      click(tile, { button: 2 }, 'contextmenu');
      click(tile, {});
      expect(events.map(event => event.prevented)).toEqual([true, true, true, true]);
      expect(tile.hasAttribute('href')).toBe(false);
      expect(activations).toEqual([]);
    });
  }

  test('a snapshot update keeps focus on the same recommendation while it remains', async () => {
    scope = new DisposableScope();
    const curtain = document.createElement('div');
    curtain.className = 'theater-ended-curtain';
    mountPlayerUi(curtain);
    scope.add(() => curtain.remove());
    const settings = createYouTubeSettings();
    scope.add(() => settings.dispose());
    await settings.ready;
    await settings.set('youtube', 'showRecommendations', true);
    let items = [item('a', watch('a')), item('b', watch('b')), item('c')];
    const refresh = mountEndScreenSettings(curtain, { read: () => ({ mediaId: 'first', items }), activate: () => true },
      { label: 'Suggested videos', scope, settings, provider: 'youtube' });
    const tile = (id: string) => [...curtain.querySelectorAll<HTMLElement>('.theater-end-screen-tile')]
      .find(tile => tile.textContent!.startsWith(`Video ${id}`));
    tile('b')!.focus();
    items = [item('x', watch('x')), item('c'), item('b', watch('b'))];
    refresh();
    expect(getPlayerUiRoot().activeElement).toBe(tile('b'));
    tile('c')!.focus();
    items = [item('y'), item('c')];
    refresh();
    expect(getPlayerUiRoot().activeElement).toBe(tile('c'));
    items = [item('z', watch('z'))];
    refresh();
    expect(getPlayerUiRoot().activeElement).toBe(tile('z'));
  });

  test('a tile without a link keeps the button: Space and Enter still activate it', async () => {
    const { tiles, activations } = mount([item('one')]);
    tiles[0]!.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(activations).toEqual(['one', 'one']);
  });
});

describe('End-screen channel links', () => {
  const channelPage = (handle: string) => new URL(`/@${handle}`, location.href).href;
  const linked = (id: string): EndScreenItem => ({ ...item(id, watch(id)), meta: '1M views', channelHref: channelPage(id) });

  test('a valid channel link sits beside the tile, above it, opens a new tab and never opens the video', async () => {
    const { tiles, replay, activations, events } = mount([linked('one'), { ...item('two', watch('two')), channelHref: 'https://evil.test/@two' }]);
    const card = tiles[0]!.parentElement!;
    const link = card.querySelector<HTMLAnchorElement>('a.theater-end-screen-channel')!;
    expect(link.href).toBe(channelPage('one'));
    expect([link.target, link.rel]).toEqual(['_blank', 'noopener noreferrer']);
    // Siblings, not nested: the tile holds no other interactive element.
    expect(tiles[0]!.contains(link)).toBe(false);
    expect(tiles[0]!.querySelector('a, button, input, [tabindex]')).toBeNull();
    await expect.element(link).toHaveAccessibleName('A channel');
    await expect.element(tiles[0]!).toHaveAccessibleName('Video one A channel 1M views');
    // A foreign channel URL keeps plain, hidden text; the tile's name still carries it.
    const plain = tiles[1]!.parentElement!.querySelector('.theater-end-screen-channel')!;
    expect([plain.localName, plain.getAttribute('aria-hidden')]).toEqual(['span', 'true']);
    // The channel link takes its own clicks; anywhere else on the card, the meta line included, opens the video.
    const at = (node: Element) => {
      const box = node.getBoundingClientRect();
      return getPlayerUiRoot().elementFromPoint(box.left + Math.min(box.width / 2, 8), box.top + box.height / 2);
    };
    expect(at(link)).toBe(link);
    expect(at(card.querySelector('.theater-end-screen-meta')!)).toBe(tiles[0]);
    expect(at(plain)).toBe(tiles[1]);
    await userEvent.click(link);
    expect(activations).toEqual([]);
    expect(events.map(event => [event.type, event.prevented])).toEqual([['click', false]]);
    // Keyboard order: the video, its channel, then the next video.
    replay.focus();
    for (const expected of [tiles[0], link, tiles[1]]) {
      await userEvent.tab();
      expect(getPlayerUiRoot().activeElement).toBe(expected);
    }
    expect(await blockingViolations(getPlayerUiRoot().host as HTMLElement)).toEqual([]);
  });

  test('pointing at or focusing a card raises its surface and thumbnail; reduced motion makes it instant', async () => {
    const host = getPlayerUiRoot().host as HTMLElement;
    host.dataset.motion = 'reduced';
    scope = new DisposableScope();
    scope.add(() => { delete host.dataset.motion; });
    const { tiles, replay } = mount([{ ...linked('one'), thumbnailUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }, linked('two')]);
    const card = tiles[0]!.parentElement!;
    const surface = () => getComputedStyle(card, '::before').opacity;
    const scaled = () => getComputedStyle(card.querySelector('img')!).transform !== 'none';
    expect([surface(), scaled()]).toEqual(['0', false]);
    expect(parseFloat(getComputedStyle(card, '::before').transitionDuration)).toBeLessThan(0.001);
    await userEvent.hover(card);
    expect([surface(), scaled()]).toEqual(['1', true]);
    await userEvent.hover(tiles[1]!);
    expect([surface(), scaled()]).toEqual(['0', false]);
    // The same states from the keyboard, with the focus ring on the whole card.
    replay.focus();
    await userEvent.tab();
    expect([surface(), scaled()]).toEqual(['1', true]);
    expect(getComputedStyle(tiles[0]!, '::after').outlineStyle).toBe('solid');
  });

  test('a snapshot update keeps focus on the same channel link while it remains', async () => {
    scope = new DisposableScope();
    const curtain = document.createElement('div');
    curtain.className = 'theater-ended-curtain';
    mountPlayerUi(curtain);
    scope.add(() => curtain.remove());
    const settings = createYouTubeSettings();
    scope.add(() => settings.dispose());
    await settings.ready;
    await settings.set('youtube', 'showRecommendations', true);
    let items = [linked('a'), linked('b')];
    const refresh = mountEndScreenSettings(curtain, { read: () => ({ mediaId: 'first', items }), activate: () => true },
      { label: 'Suggested videos', scope, settings, provider: 'youtube' });
    const channel = (handle: string) => curtain.querySelector<HTMLElement>(`a.theater-end-screen-channel[href="${channelPage(handle)}"]`);
    channel('b')!.focus();
    items = [linked('x'), linked('b')];
    refresh();
    expect(getPlayerUiRoot().activeElement).toBe(channel('b'));
    // Its link gone, focus falls back to the first tile.
    items = [linked('x'), item('b', watch('b'))];
    refresh();
    expect(getPlayerUiRoot().activeElement).toBe(curtain.querySelector('.theater-end-screen-tile'));
  });
});
