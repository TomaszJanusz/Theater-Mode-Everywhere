import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect, waitFor } from 'storybook/test';

import { renderPlayerBar } from '../../.storybook/player-stage';
import { fakeQualitySource, qualityMenuHost, sampleQuality } from '../test-utils/video-quality-fixture';
import { strokeIcon } from '../ui/hud';
import { t } from '../ui/messages';
import { queryPlayerUi, queryPlayerUiAll } from '../ui/root';
import { setSvgIcon } from '../ui/svg-icon';

import { mountVideoQualityMenu } from './video-quality-view';

interface Args {
  /** The level the viewer fixed; empty while the host chooses (Auto). */
  fixed: string;
  /** What the host plays now, named beside Auto. */
  playing: string;
  /** Open the nested list rather than the settings rows. */
  list: boolean;
  /** The host offers levels for this player now. */
  available: boolean;
}

let stage: { source: ReturnType<typeof fakeQualitySource> } | undefined;

/** A pointer click (`detail` 1), so the opening is pinned and focus stays where a mouse leaves it. */
const press = (element: Element | null | undefined) => element?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

/**
 * The settings menu's Video quality row and its list: the production provider view inside the production settings
 * panel and choice list, over levels shaped like a logged-out YouTube 4K watch page. Only the host is synthetic.
 */
const meta: Meta<Args> = {
  title: 'Components/Video quality',
  argTypes: {
    fixed: { control: 'select', options: ['', 'hd2160', 'hd1080', 'hd720', 'large', 'tiny'] },
    playing: { control: 'select', options: ['hd2160', 'hd1080', 'hd720', 'large', 'tiny'] },
    list: { control: 'boolean' },
    available: { control: 'boolean' }
  },
  args: { fixed: '', playing: 'hd720', list: true, available: true },
  render: ({ fixed, playing, list, available }) => renderPlayerBar(scope => {
    const source = fakeQualitySource(available ? sampleQuality({ fixed: fixed || null, playing }) : null);
    stage = { source };
    const host = qualityMenuHost(scope);
    const { row } = mountVideoQualityMenu(source.source, host);
    scope.raf(() => {
      press(host.settings.button);
      if (list && !row.hidden) press(row);
    });
    // Close follows the gear at the bar's end in every player; the menu's notch is cut for that place.
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'theater-control-btn close-btn';
    close.setAttribute('aria-label', t('exitTheaterMode'));
    setSvgIcon(close, strokeIcon('<line x1="20" y1="4" x2="4" y2="20"/><line x1="4" y1="4" x2="20" y2="20"/>', 18));
    return [host.settings.container, close];
  }, { right: true })
};
export default meta;

type Story = StoryObj<Args>;

const row = () => queryPlayerUi<HTMLButtonElement>('.video-quality-btn')!;
const choices = () => queryPlayerUiAll<HTMLButtonElement>('#theater-video-quality-list button');

/** Auto, naming what plays, checked above the host's levels, highest first. */
export const List: Story = {
  play: async () => {
    await waitFor(() => expect(choices()).toHaveLength(9));
    await expect(choices().map(choice => choice.textContent)).toEqual(
      ['Auto (720p60)✓', '2160p60', '1440p60', '1080p60', '720p60', '480p', '360p', '240p', '144p']);
    await expect(choices()[0]!.getAttribute('aria-pressed')).toBe('true');
  }
};

/** A fixed level: the row names it, and the list checks it instead of Auto. */
export const Fixed: Story = {
  args: { fixed: 'hd1080', playing: 'hd1080', list: false },
  play: async () => {
    await waitFor(() => expect(row().getAttribute('aria-label')).toBe('Video quality: 1080p60'));
    await expect(row().hidden).toBe(false);
  }
};

/** No levels (an ad, another item, a host without the API): no row; levels arriving later bring it back. */
export const Unavailable: Story = {
  args: { available: false, list: false },
  tags: ['no-shot'],
  play: async () => {
    await waitFor(() => expect(queryPlayerUi('.theater-settings-menu.visible')).not.toBeNull());
    await expect(row().hidden).toBe(true);
    stage!.source.update(sampleQuality());
    await waitFor(() => expect(row().hidden).toBe(false));
    await expect(row().getAttribute('aria-label')).toBe('Video quality: Auto (720p60)');
  }
};
