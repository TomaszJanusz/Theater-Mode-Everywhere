import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect } from 'storybook/test';

import { volumeHost, volumeSurface } from '../../.storybook/player-fakes';
import { renderPlayerBar } from '../../.storybook/player-stage';

import { t } from './messages';
import { queryPlayerUi } from './root';
import { createVolumeControl } from './volume-control';

interface Args {
  volume: number;
  muted: boolean;
  /** Slider position above 1; only meaningful with `boost`. */
  logicalVolume?: number;
  boost: boolean;
  disabled: boolean;
  open: boolean;
}

const meta: Meta<Args> = {
  title: 'Player/Volume control',
  argTypes: { volume: { control: { type: 'range', min: 0, max: 1, step: 0.05 } }, muted: { control: 'boolean' }, logicalVolume: { control: { type: 'range', min: 0, max: 1.5, step: 0.05 } }, boost: { control: 'boolean' }, disabled: { control: 'boolean' }, open: { control: 'boolean' } },
  args: { volume: 0.6, muted: false, boost: false, disabled: false, open: false },
  render: ({ volume, muted, logicalVolume, boost, disabled, open }) => renderPlayerBar(scope => {
    const surface = volumeSurface({ volume, muted, logicalVolume, boost });
    const control = createVolumeControl({
      ...volumeHost(surface, boost, { toggleMute: t('toggleMute'), volume: t('volumeLabel') }),
      scope
    });
    control.button.disabled = disabled;
    control.slider.disabled = disabled;
    scope.raf(() => { if (open && !disabled) control.button.focus(); });
    return [control.container];
  })
};
export default meta;

type Story = StoryObj<Args>;

const slider = () => queryPlayerUi<HTMLInputElement>('.theater-volume-slider')!;
const button = () => queryPlayerUi<HTMLButtonElement>('.volume-btn')!;
const panel = () => queryPlayerUi<HTMLElement>('.theater-volume-panel')!;

export const Default: Story = {
  play: async ({ args }) => {
    const level = args.muted ? 0 : (args.logicalVolume ?? args.volume);
    await expect(slider().getAttribute('aria-valuetext')).toBe(`${Math.round(level <= 1 ? level * 100 : 100 + (level - 1) * 400)}%`);
    await expect(button().getAttribute('aria-label')).toBe(t('toggleMute'));
  }
};

/** Focus is the keyboard path; hover reaches the same panel (see Open in the speed control). */
export const Open: Story = {
  play: async ({ args }) => {
    if (args.disabled) return;
    button().focus();
    await expect(panel().inert).toBe(false);
  }
};

export const Muted: Story = { args: { muted: true } };

export const Boosted: Story = {
  args: { boost: true, volume: 1, logicalVolume: 1.3 },
  play: async ({ args }) => {
    if (args.disabled) return;
    button().focus();
    await expect(slider().classList.contains('boosted')).toBe(!args.muted && (args.logicalVolume ?? args.volume) > 1);
  }
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ args }) => {
    await expect(button().disabled).toBe(args.disabled);
  }
};

/** German: the longest accessible names of the three player menus. */
export const LongLabelGerman: Story = {
  play: async () => {
    await expect(button().getAttribute('aria-label')).toBe(t('toggleMute'));
    await expect(slider().getAttribute('aria-label')).toBe(t('volumeLabel'));
  }
};

export const Arabic: Story = {
  play: async () => {
    await expect(queryPlayerUi('.theater-controls-wrapper')?.getAttribute('dir')).toBe(t('@@bidi_dir'));
  }
};

/** The host stays in the browser top layer so page dialogs cannot cover the bar. */
export const TopLayer: Story = {
  play: async () => {
    const host = document.getElementById('theater-everywhere-ui')!;
    await expect(host.matches(':popover-open')).toBe(true);
    await expect(host.shadowRoot).not.toBeNull();
  }
};
