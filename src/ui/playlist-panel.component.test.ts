import { afterEach, describe, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

import { activeElementDeep } from '../accessibility';
import { DisposableScope } from '../core/disposable-scope';
import type { PlaylistPanelSnapshot } from '../core/playlist-panel';
import { blockingViolations } from '../test-utils/axe';
import { fakePlaylistSource, samplePlaylist } from '../test-utils/playlist-panel-fixture';

import { mountPlaylistPanel } from './playlist-panel';
import { getPlayerUiRoot, mountPlayerUi } from './root';

let scope: DisposableScope;
afterEach(() => scope?.dispose());

/** The bar's right section with the playlist toggle, as controls.ts mounts it. */
function mount(snapshot: PlaylistPanelSnapshot | null = samplePlaylist()) {
  scope = new DisposableScope();
  const fake = fakePlaylistSource(snapshot);
  const wrapper = document.createElement('div');
  wrapper.className = 'theater-controls-wrapper visible';
  const right = document.createElement('div');
  right.className = 'theater-controls-right';
  wrapper.append(right);
  mountPlayerUi(wrapper);
  scope.add(() => wrapper.remove());
  const panel = mountPlaylistPanel({ source: fake.source, scope, label: 'Playlist', bindTooltip: () => {} });
  right.append(panel.host);
  panel.syncAvailability();
  const trigger = panel.host.querySelector<HTMLButtonElement>('.theater-playlist-toggle')!;
  const rows = () => [...panel.host.querySelectorAll<HTMLButtonElement>('.theater-playlist-row')];
  return { ...fake, panel, trigger, rows, state: () => panel.host.dataset.teState };
}

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
    expect(panel.host.querySelector('.theater-playlist-meta')!.textContent).toBe('\u2068Harbour Films\u2069 · 3 of 12');
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
