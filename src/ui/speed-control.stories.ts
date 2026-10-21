import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect, waitFor } from 'storybook/test';

import { renderPlayerBar } from '../../.storybook/player-stage';

import { t } from './messages';
import { queryPlayerUi } from './root';
import { createSpeedControl } from './speed-control';

interface Args {
  rate: number;
  disabled: boolean;
  open: boolean;
}

const meta: Meta<Args> = {
  title: 'Player/Speed control',
  argTypes: { rate: { control: { type: 'range', min: 0.25, max: 4, step: 0.25 } }, disabled: { control: 'boolean' }, open: { control: 'boolean' } },
  args: { rate: 1.5, disabled: false, open: false },
  render: ({ rate, disabled, open }) => renderPlayerBar(scope => {
    const control = createSpeedControl({
      video: { playbackRate: rate },
      scope,
      label: t('playbackSpeed'),
      updateCaptionDock: () => {},
      blurMouseToggle: () => {}
    });
    control.button.disabled = disabled;
    control.slider.disabled = disabled;
    scope.raf(() => { if (open && !disabled) control.button.focus(); });
    return [control.container];
  })
};
export default meta;

type Story = StoryObj<Args>;

const button = () => queryPlayerUi<HTMLButtonElement>('.speed-btn')!;
const slider = () => queryPlayerUi<HTMLInputElement>('.theater-speed-slider')!;
const panel = () => queryPlayerUi<HTMLElement>('.theater-speed-panel')!;

export const Closed: Story = {
  play: async ({ args }) => {
    await expect(button().textContent).toBe(`${args.rate.toFixed(2).replace(/\.00$|\.0$/, '')}x`);
    await expect(button().getAttribute('aria-label')).toBe(t('playbackSpeed'));
    await expect(slider().getAttribute('aria-label')).toBe(t('playbackSpeed'));
    await expect(button().disabled).toBe(args.disabled);
    await expect(slider().disabled).toBe(args.disabled);
    await waitFor(() => expect(panel().inert).toBe(args.disabled || !args.open));
  }
};
export const Open: Story = { ...Closed, args: { open: true } };
