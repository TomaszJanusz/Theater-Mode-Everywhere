import type { Meta } from '@storybook/html-vite';
import { expect } from 'storybook/test';

import { digit, notice, renderNotice, type NoticeArgs, type NoticeStoryObj } from '../../.storybook/notice-story';

import { t } from './messages';

// The countdown the player shows before entering theater on its own. `progress` holds the ring, digit
// roll and zoom-out at a fixed fraction so each frame is the same on every run.
const meta: Meta<NoticeArgs> = {
  title: 'Player/Auto-theater notice',
  tags: ['frames'],
  argTypes: { remainingMs: { control: { type: 'number', min: 0, max: 10000, step: 100 } }, ringTurn: { control: 'select', options: ['uniform', 'per-digit'] }, progress: { control: { type: 'range', min: 0, max: 1, step: 0.05 } }, frames: { control: false } },
  args: { remainingMs: 4500, ringTurn: 'uniform', progress: 0.5 },
  render: renderNotice
};
export default meta;

type Story = NoticeStoryObj;

export const Counting: Story = {
  play: async ({ args }) => {
    await expect(digit()).toBe(String(Math.floor(args.remainingMs / 1000)));
    await expect(notice()?.getAttribute('role')).toBe('status');
    await expect(notice()?.querySelector('.theater-auto-notice-count')?.getAttribute('aria-hidden')).toBe('true');
  }
};

export const LastSecondsDigit: Story = {
  args: { remainingMs: 1800 },
  play: async ({ args }) => { await expect(digit()).toBe(String(Math.floor(args.remainingMs / 1000))); }
};

/** At 0 the ring is leaving: it zooms out over the last half second while the digit stays. */
export const RingLeaving: Story = {
  args: { remainingMs: 900, frames: [0, 0.25, 0.5] },
  play: async ({ args }) => { await expect(digit()).toBe(String(Math.floor(args.remainingMs / 1000))); }
};

export const PerDigitRing: Story = {
  args: { ringTurn: 'per-digit', remainingMs: 2400 },
  play: async ({ args }) => { await expect(digit()).toBe(String(Math.floor(args.remainingMs / 1000))); }
};

export const LongLabelGerman: Story = {
  play: async () => {
    await expect(notice()?.querySelector('.volume-hud-text')?.textContent).toBe(t('autoEnterNoticeTitle'));
    await expect(notice()?.getAttribute('aria-label')).toContain(t('autoEnterNoticeTitle'));
  }
};

export const RtlArabic: Story = {
  play: async () => { await expect(notice()?.getAttribute('dir')).toBe(t('@@bidi_dir')); }
};

export const ReducedMotion: Story = {
  play: async () => {
    await expect(notice()?.getAttribute('role')).toBe('status');
  }
};
