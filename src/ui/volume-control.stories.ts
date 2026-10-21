import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect, waitFor } from 'storybook/test';

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
  title: 'Components/Volume control',
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

export const Closed: Story = {
  play: async ({ args }) => {
    const level = args.muted ? 0 : (args.logicalVolume ?? args.volume);
    await expect(slider().getAttribute('aria-valuetext')).toBe(`${Math.round(level <= 1 ? level * 100 : 100 + (level - 1) * 400)}%`);
    await expect(slider().classList.contains('boosted')).toBe(level > 1);
    await expect(button().classList.contains('boosted')).toBe(level > 1 && args.boost);
    await expect(button().getAttribute('aria-label')).toBe(t('toggleMute'));
    await expect(button().disabled).toBe(args.disabled);
    await expect(slider().disabled).toBe(args.disabled);
    await waitFor(() => expect(panel().inert).toBe(args.disabled || !args.open));
    const host = document.getElementById('theater-everywhere-ui')!;
    await expect(host.matches(':popover-open')).toBe(true);
    await expect(host.shadowRoot).not.toBeNull();
  }
};
export const Open: Story = { ...Closed, args: { open: true } };
export const Muted: Story = { ...Closed, args: { muted: true } };
export const Boosted: Story = { ...Closed, args: { boost: true, volume: 1, logicalVolume: 1.3, open: true } };
