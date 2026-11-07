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
