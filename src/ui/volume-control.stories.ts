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
}

const meta: Meta<Args> = {
  title: 'Player/Volume control',
  args: { volume: 0.6, muted: false, boost: false, disabled: false },
  render: ({ volume, muted, logicalVolume, boost, disabled }) => renderPlayerBar(scope => {
    const surface = volumeSurface({ volume, muted, logicalVolume, boost });
    const control = createVolumeControl({
      ...volumeHost(surface, boost, { toggleMute: t('toggleMute'), volume: t('volumeLabel') }),
      scope
    });
    control.button.disabled = disabled;
    control.slider.disabled = disabled;
    return [control.container];
  })
};
export default meta;

type Story = StoryObj<Args>;

const slider = () => queryPlayerUi<HTMLInputElement>('.theater-volume-slider')!;
const button = () => queryPlayerUi<HTMLButtonElement>('.volume-btn')!;
const panel = () => queryPlayerUi<HTMLElement>('.theater-volume-panel')!;

export const Default: Story = {
  play: async () => {
    await expect(panel().inert).toBe(true);
    await expect(slider().getAttribute('aria-valuetext')).toBe('60%');
    await expect(button().getAttribute('aria-label')).toBe(t('toggleMute'));
  }
};

/** Focus is the keyboard path; hover reaches the same panel (see Open in the speed control). */
export const Open: Story = {
  play: async () => {
    button().focus();
    await expect(panel().inert).toBe(false);
  }
};

export const Muted: Story = { args: { muted: true } };

export const Boosted: Story = {
  args: { boost: true, volume: 1, logicalVolume: 1.3 },
  play: async () => {
    button().focus();
    await expect(slider().classList.contains('boosted')).toBe(true);
    await expect(slider().getAttribute('aria-valuetext')).toBe('220%');
  }
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async () => {
    await expect(button().disabled).toBe(true);
  }
};

/** German: the longest accessible names of the three player menus. */
export const LongLabelGerman: Story = {
  globals: { locale: 'de' },
  play: async () => {
    await expect(button().getAttribute('aria-label')).toBe('Stummschaltung umschalten');
    await expect(slider().getAttribute('aria-label')).toBe('Lautstärke');
  }
};

export const Arabic: Story = {
  globals: { locale: 'ar' },
  play: async () => {
    await expect(queryPlayerUi('.theater-controls-wrapper')?.getAttribute('dir')).toBe('rtl');
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
