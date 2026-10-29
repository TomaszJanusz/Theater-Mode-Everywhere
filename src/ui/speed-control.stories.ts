import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect, waitFor } from 'storybook/test';

import { renderPlayerBar } from '../../.storybook/player-stage';
import { expectSliderMarker } from '../../.storybook/slider-assertions';

import { t } from './messages';
import { queryPlayerUi } from './root';
import { createSpeedControl } from './speed-control';

interface Args {
  rate: number;
  disabled: boolean;
  open: boolean;
}

const meta: Meta<Args> = {
  title: 'Components/Speed control',
  argTypes: { rate: { control: { type: 'range', min: 0.25, max: 4, step: 0.25 } }, disabled: { control: 'boolean' }, open: { control: 'boolean' } },
  args: { rate: 1.5, disabled: false, open: false },
  render: ({ rate, disabled, open }) => renderPlayerBar(scope => {
    const control = createSpeedControl({
      video: { element: document.createElement('video'), playbackRate: rate },
      scope,
      label: t('playbackSpeed'),
      updateCaptionDock: () => {},
      blurMouseToggle: () => {}
    });
    control.button.disabled = disabled;
    control.slider.disabled = disabled;
    scope.raf(() => { if (open && !disabled) { control.button.focus(); control.slider.focus(); } });
    return [control.container];
  })
};
export default meta;

type Story = StoryObj<Args>;

const button = () => queryPlayerUi<HTMLButtonElement>('.speed-btn')!;
const slider = () => queryPlayerUi<HTMLInputElement>('.theater-speed-slider')!;
const panel = () => queryPlayerUi<HTMLElement>('.theater-speed-panel')!;
const marker = () => queryPlayerUi<HTMLElement>('.theater-speed-panel .theater-slider-marker')!;

export const Closed: Story = {
  play: async ({ args }) => {
    await expect(button().textContent).toBe(`${args.rate.toFixed(2).replace(/\.00$|\.0$/, '')}x`);
    await expect(button().getAttribute('aria-label')).toBe(t('playbackSpeed'));
    await expect(slider().getAttribute('aria-label')).toBe(t('playbackSpeed'));
    await expect(button().disabled).toBe(args.disabled);
    await expect(slider().disabled).toBe(args.disabled);
    // The 1x marker is 3 of 7 steps along the track, wherever the thumb is.
    await expect(marker().hidden).toBe(false);
    await expect(Number(marker().style.getPropertyValue('--slider-position'))).toBeCloseTo(3 / 7, 5);
    await waitFor(() => {
      // The deferred render focus can be lost in Firefox; drive the requested state here too.
      if (args.open && !args.disabled) { button().focus(); slider().focus(); }
      expect(panel().inert).toBe(args.disabled || !args.open);
    });
    if (args.open && !args.disabled) await expectSliderMarker(slider(), marker(), 3);
  }
};
export const Open: Story = { ...Closed, args: { open: true } };
