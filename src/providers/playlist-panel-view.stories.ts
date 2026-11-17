import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect, userEvent, waitFor } from 'storybook/test';

import { renderPlayerBar } from '../../.storybook/player-stage';
import { fakePlaylistSource, playlistBar, samplePlaylist } from '../test-utils/playlist-panel-fixture';
import { filledIcon, PLAYLIST_STEP_ICONS } from '../ui/hud';
import { t } from '../ui/messages';
import { queryPlayerUi, queryPlayerUiAll } from '../ui/root';
import { setSvgIcon } from '../ui/svg-icon';

import { mountPlaylistPanel } from './playlist-panel-view';

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
  /** The host offers Previous and Next. */
  steps: boolean;
  /** The provider has a list for this player, so the toggle shows. */
  list: boolean;
}

/** Play, Previous and Next as the bar draws them: the shared control class and icon (behaviour is the runtime's). */
function barButton(className: string, label: string, icon: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `theater-control-btn ${className}`;
  button.setAttribute('aria-label', label);
  setSvgIcon(button, icon);
  return button;
}

let stage: { source: ReturnType<typeof fakePlaylistSource> } | undefined;

/**
 * The bar's playlist toggle and panel: the production toggle and with the shared provider view over synthetic data shaped
 * like YouTube's panel model (offline colour thumbnails). The toggle sits right after Previous/Next in the bar's left
 * section, as controls.ts places it, and the panel opens from there towards the bar's end.
 */
const meta: Meta<Args> = {
  title: 'Components/Playlist panel',
  argTypes: {
    count: { control: { type: 'number', min: 1, max: 200 } },
    current: { control: { type: 'number', min: 1, max: 200 } },
    mix: { control: 'boolean' },
    unavailable: { control: 'boolean' },
    open: { control: 'boolean' },
    steps: { control: 'boolean' },
    list: { control: 'boolean' }
  },
  args: { count: 12, current: 3, mix: false, unavailable: false, open: true, steps: true, list: true },
  render: ({ count, current, mix, unavailable, open, steps, list }) => renderPlayerBar(scope => {
    const playlist = samplePlaylist({ count, current, total: mix ? null : count, title: mix ? 'Mix – Slow travel' : undefined });
    const source = fakePlaylistSource(playlist);
    stage = { source };
    const panel = mountPlaylistPanel(source.source, playlistBar(scope));
    source.setAvailable(list);
    panel.syncAvailability();
    if (unavailable) source.update(null);
    // A pinned opening, as a pointer click on the toggle makes (`detail` 1; a keyboard click would focus a row).
    if (open && list) scope.raf(() => panel.host.querySelector(':scope > button')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
    const play = barButton('play-pause-btn', t('play'), filledIcon('<polygon points="5 3 19 12 5 21 5 3"/>'));
    const previous = barButton('playlist-prev-btn', t('previousVideo'), PLAYLIST_STEP_ICONS.previous);
    const next = barButton('playlist-next-btn', t('nextVideo'), PLAYLIST_STEP_ICONS.next);
    return [play, ...steps ? [previous, next] : [], panel.host];
  })
};
export default meta;

type Story = StoryObj<Args>;

const toggle = () => queryPlayerUi<HTMLButtonElement>('.theater-playlist-toggle')!;
const rows = () => queryPlayerUiAll<HTMLButtonElement>('.theater-playlist-row');
/** The bar's left section in order; hidden controls take no room. */
const barLayout = () => queryPlayerUiAll<HTMLElement>('.theater-controls-left > *')
  .filter(element => element.getClientRects().length > 0)
  .map(element => element.matches('.theater-menu-anchored') ? 'playlist' : element.className.replace('theater-control-btn ', ''));

export const Open: Story = {
  play: async ({ args }) => {
    await waitFor(() => expect(toggle().getAttribute('aria-expanded')).toBe('true'));
    await expect(barLayout()).toEqual(['play-pause-btn', 'playlist-prev-btn', 'playlist-next-btn', 'playlist']);
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

/** The host offers Previous and Next but no list: the bar is as it was before the panel. */
export const StepsOnly: Story = {
  args: { list: false, open: false },
  play: async () => {
    await expect(barLayout()).toEqual(['play-pause-btn', 'playlist-prev-btn', 'playlist-next-btn']);
  }
};

/** A list without host steps: the toggle takes the steps' place beside play. */
export const ListOnly: Story = {
  args: { steps: false, open: false },
  play: async () => {
    await expect(barLayout()).toEqual(['play-pause-btn', 'playlist']);
  }
};

/** Neither steps nor a list. */
export const Neither: Story = {
  args: { steps: false, list: false, open: false },
  tags: ['no-shot'],
  play: async () => {
    await expect(barLayout()).toEqual(['play-pause-btn']);
  }
};
