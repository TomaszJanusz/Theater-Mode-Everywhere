import type { Meta } from '@storybook/html-vite';
import { expect } from 'storybook/test';

import { digit, notice, renderNotice, type NoticeArgs, type NoticeStoryObj } from '../../.storybook/notice-story';

import { t } from './messages';

// The countdown the player shows before entering theater on its own. `progress` holds the ring, digit
// roll and zoom-out at a fixed fraction so each frame is the same on every run.
const meta: Meta<NoticeArgs> = {
  title: 'Components/Auto-theater notice',
  parameters: { timeline: true },
  tags: ['frames'],
  argTypes: { remainingMs: { control: { type: 'number', min: 0, max: 10000, step: 100 } }, ringTurn: { control: 'select', options: ['uniform', 'per-digit'] }, progress: { control: false }, phase: { control: false }, live: { control: false }, frames: { control: false } },
  args: { remainingMs: 4500, ringTurn: 'uniform', progress: 0.5 },
  render: renderNotice
};
export default meta;

type Story = NoticeStoryObj;

export const Counting: Story = {
  play: async ({ args, globals }) => {
    const heldRemaining = globals.timeline === 'leave' ? Math.min(args.remainingMs, 900) : args.remainingMs;
    await expect(digit()).toBe(String(Math.floor(heldRemaining / 1000)));
    await expect(notice()?.getAttribute('role')).toBe('status');
    await expect(notice()?.querySelector('.theater-auto-notice-count')?.getAttribute('aria-hidden')).toBe('true');
    await expect(notice()?.getAttribute('dir')).toBe(t('@@bidi_dir'));
  }
};
export const RingExit: Story = { ...Counting, args: { remainingMs: 900, frames: [0, 0.25, 0.5] } };
export const NoRing: Story = {
  ...Counting, args: { remainingMs: 100 },
  play: async context => {
    await Counting.play?.(context);
    if (context.args.remainingMs <= 100) await expect(notice()?.querySelector('.caption-hud-spinner')).toBeNull();
  }
};
