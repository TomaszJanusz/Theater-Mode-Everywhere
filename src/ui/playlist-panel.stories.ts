import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect, userEvent, waitFor } from 'storybook/test';

import { renderPlayerBar } from '../../.storybook/player-stage';
import { fakePlaylistSource, samplePlaylist } from '../test-utils/playlist-panel-fixture';

import { t } from './messages';
import { mountPlaylistPanel } from './playlist-panel';
import { queryPlayerUi, queryPlayerUiAll } from './root';

interface Args {
  /** Items the host has loaded; YouTube lists a window of long lists. */
  count: number;
  /** 1-based position of the playing item. */
  current: number;
  /** An endless mix: no count, so no "3 of 12". */
  mix: boolean;
  /** The host no longer lists the playlist. */
  unavailable: boolean;
  open: boolean;
}

let stage: { source: ReturnType<typeof fakePlaylistSource> } | undefined;

/**
 * The bar's playlist toggle and panel: the production shell with the shared provider view over synthetic data shaped
 * like YouTube's panel model (offline colour thumbnails). The panel opens from the bar's end, as in the player.
 */
const meta: Meta<Args> = {
  title: 'Components/Playlist panel',
  argTypes: {
    count: { control: { type: 'number', min: 1, max: 200 } },
    current: { control: { type: 'number', min: 1, max: 200 } },
    mix: { control: 'boolean' },
    unavailable: { control: 'boolean' },
    open: { control: 'boolean' }
  },
  args: { count: 12, current: 3, mix: false, unavailable: false, open: true },
  render: ({ count, current, mix, unavailable, open }) => renderPlayerBar(scope => {
    const playlist = samplePlaylist({ count, current, total: mix ? null : count, title: mix ? 'Mix – Slow travel' : undefined });
    const source = fakePlaylistSource(playlist);
    stage = { source };
    const panel = mountPlaylistPanel({ source: source.source, scope, label: t('playlistPanelTitle'), bindTooltip: () => {} });
    panel.syncAvailability();
    if (unavailable) source.update(null);
    // A pinned opening, as a pointer click on the toggle makes (`detail` 1; a keyboard click would focus a row).
    if (open) scope.raf(() => panel.host.querySelector(':scope > button')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
    return [panel.host];
  }, { section: 'right' })
};
export default meta;

type Story = StoryObj<Args>;

const toggle = () => queryPlayerUi<HTMLButtonElement>('.theater-playlist-toggle')!;
const rows = () => queryPlayerUiAll<HTMLButtonElement>('.theater-playlist-row');

export const Open: Story = {
  play: async ({ args }) => {
    await waitFor(() => expect(toggle().getAttribute('aria-expanded')).toBe('true'));
    await expect(toggle().getAttribute('aria-label')).toBe(t('playlistPanelTitle'));
    await expect(rows()).toHaveLength(args.count);
    const playing = rows()[args.current - 1];
    await expect(playing.getAttribute('aria-current')).toBe('true');
    // The list opens centred on the playing item.
    const list = queryPlayerUi<HTMLElement>('.theater-playlist-list')!.getBoundingClientRect();
    const box = playing.getBoundingClientRect();
    await expect(box.top >= list.top && box.bottom <= list.bottom).toBe(true);
  }
};

/** Deep in a long list: the panel scrolls the playing item into the middle. */
export const LongList: Story = { ...Open, args: { count: 60, current: 41 } };

export const Mix: Story = {
  args: { mix: true },
  play: async () => {
    await waitFor(() => expect(toggle().getAttribute('aria-expanded')).toBe('true'));
    await expect(queryPlayerUi('.theater-playlist-meta')!.textContent).toBe('\u2068Harbour Films\u2069');
  }
};

export const Unavailable: Story = {
  args: { unavailable: true },
  play: async () => {
    await waitFor(() => expect(queryPlayerUi('.theater-playlist-list [role="status"]')).not.toBeNull());
  }
};

/** Opening subscribes to the host, closing releases it, and the keys move between rows without leaving the list. */
export const KeyboardAndLifecycle: Story = {
  args: { open: false },
  tags: ['no-shot'],
  play: async () => {
    const source = stage!.source;
    await expect(source.subscriptions()).toBe(0);
    toggle().focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(source.subscriptions()).toBe(1));
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect(source.activations).toEqual(['item-4']);
    await expect(toggle().getAttribute('aria-expanded')).toBe('false');
    await expect(source.subscriptions()).toBe(0);
  }
};
