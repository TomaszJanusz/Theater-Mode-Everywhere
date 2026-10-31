import { afterEach, describe, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

import { DisposableScope } from '../../core/disposable-scope';
import { APPEARANCE_MODES, blockingViolations } from '../../test-utils/axe';
import { getPlayerUiRoot, mountPlayerUi } from '../../ui/root';

import type { EndScreenItem, SuggestionSource } from './end-screen-model';
import { mountEndScreenSettings, renderEndScreen } from './end-screen-view';
import { createYouTubeSettings } from './settings';

let scope: DisposableScope;
afterEach(() => scope?.dispose());

const title = 'A long title about watching the seasons change across the mountains and valleys of a distant landscape';
const item: EndScreenItem = { id: 'one', href: '/watch', kind: 'video', title,
  channel: 'A channel', meta: '125K views • 2 weeks ago', durationText: '18:06' };

function mount(count: number, thumbnail = false) {
  scope = new DisposableScope();
  let mediaId = 'first';
  const activations: string[] = [];
  const source: SuggestionSource = {
    read: () => ({ mediaId, items: Array.from({ length: count }, (_, i) => ({ ...item, id: String(i),
      thumbnailUrl: thumbnail ? 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' : undefined })) }),
    activate: id => { activations.push(id); return true; }
  };
  const curtain = document.createElement('div');
  curtain.className = 'theater-ended-curtain';
  const replay = document.createElement('button');
  replay.textContent = 'Replay';
  replay.className = 'theater-home-pill';
  curtain.append(replay);
  mountPlayerUi(curtain);
  const grid = renderEndScreen(source, 'Suggested videos', scope);
  if (grid) curtain.append(grid);
  scope.add(() => curtain.remove());
  const tiles = [...curtain.querySelectorAll<HTMLButtonElement>('.theater-end-screen-tile')];
  return { curtain, replay, grid, tiles, activations, source, stale: () => { mediaId = 'second'; } };
}

describe('YouTube provider tiles in the shared curtain', () => {
  for (const count of [1, 2, 3]) {
    test(`${count} tiles: wrapping, missing thumbnails, accessible names and keyboard/pointer parity`, async () => {
      const { tiles, activations, replay, stale } = mount(count);
      expect(tiles).toHaveLength(count);
      const tile = tiles[0]!;
      expect(tile.querySelector('img')).toBeNull();
      const heading = tile.querySelector<HTMLElement>('.theater-end-screen-title')!;
      expect(heading.getBoundingClientRect().height).toBeGreaterThan(30);
      // A native name starts with the visible title; the decorative duration badge cannot prefix it.
      await expect.element(tile).toHaveAccessibleName(`${title} A channel 125K views • 2 weeks ago 18:06`);
      await userEvent.click(tile);
      expect(getPlayerUiRoot().activeElement).not.toBe(tile);
      replay.focus();
      await userEvent.tab();
      expect(getPlayerUiRoot().activeElement).toBe(tile);
      await userEvent.keyboard('{Enter}');
      await userEvent.keyboard(' ');
      expect(activations).toEqual(['0', '0', '0']);
      stale();
      tile.click();
      expect(activations).toHaveLength(3);
      expect(await blockingViolations(getPlayerUiRoot().host as HTMLElement)).toEqual([]);
      scope.dispose();
      tile.click();
      expect(activations).toHaveLength(3);
    });
  }

  test('empty extraction leaves the plain curtain and supplied images are decorative', () => {
    expect(mount(0).grid).toBeNull();
    scope.dispose();
    const { grid } = mount(1, true);
    expect(grid!.querySelector('img')!.alt).toBe('');
    expect(grid!.querySelector('img')!.referrerPolicy).toBe('no-referrer');
  });

  for (const mode of APPEARANCE_MODES) {
    test(`tiles pass axe with ${mode.name}`, async () => {
      const host = getPlayerUiRoot().host as HTMLElement;
      mode.apply(host);
      await expect.poll(() => mode.applied(host)).toBe(true);
      mount(3, true);
      expect(await blockingViolations(host)).toEqual([]);
    });
  }
});


describe('YouTube recommendation switch', () => {
  for (const mode of APPEARANCE_MODES) {
    test(`stays reversible, labelled and keyboard operable with ${mode.name}`, async () => {
      const host = getPlayerUiRoot().host as HTMLElement;
      mode.apply(host);
      await expect.poll(() => mode.applied(host)).toBe(true);
      const { curtain, grid, source, replay } = mount(3);
      grid?.remove();
      const settings = createYouTubeSettings();
      scope.add(() => settings.dispose());
      await settings.ready;
      mountEndScreenSettings(curtain, source, { label: 'Suggested videos', scope, settings });
      const input = curtain.querySelector<HTMLInputElement>('[role=switch]')!;
      await expect.element(input).toHaveAccessibleName('Show recommendations');
      await userEvent.click(input);
      await expect.poll(() => curtain.querySelector('.theater-end-screen')).toBeNull();
      expect(curtain.contains(replay)).toBe(true);
      expect(getPlayerUiRoot().activeElement).not.toBe(input);
      expect(input.isConnected).toBe(true);
      input.focus();
      await userEvent.keyboard(' ');
      await expect.poll(() => curtain.querySelectorAll('.theater-end-screen-tile').length).toBe(3);
      expect(getPlayerUiRoot().activeElement).toBe(input);
      // External updates use the same store and do not rebuild or lose switch focus.
      await settings.set('youtube', 'showRecommendations', false);
      expect(input.checked).toBe(false);
      expect(getPlayerUiRoot().activeElement).toBe(input);
      expect(await blockingViolations(host)).toEqual([]);
      scope.dispose(); scope.dispose();
      expect(curtain.isConnected).toBe(false);
    });
  }
});
