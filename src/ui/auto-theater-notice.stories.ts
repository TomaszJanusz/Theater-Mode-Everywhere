import type { Meta } from '@storybook/html-vite';
import { expect } from 'storybook/test';

import { digit, notice, renderNotice, type NoticeArgs, type NoticeStoryObj } from '../../.storybook/notice-story';

import { t } from './messages';

// The countdown the player shows before entering theater on its own. `progress` holds the ring, digit
// roll and zoom-out at a fixed fraction so each frame is the same on every run.
const meta: Meta<NoticeArgs> = {
  title: 'Player/Auto-theater notice',
  globals: { reduceMotion: 'off' },
  tags: ['frames'],
  args: { remainingMs: 4500, ringTurn: 'uniform', progress: 0.5 },
  render: renderNotice
};
export default meta;

type Story = NoticeStoryObj;

export const Counting: Story = {
  play: async () => {
    await expect(digit()).toBe('4');
    await expect(notice()?.getAttribute('role')).toBe('status');
    await expect(notice()?.querySelector('.theater-auto-notice-count')?.getAttribute('aria-hidden')).toBe('true');
  }
};

export const LastSecondsDigit: Story = {
  args: { remainingMs: 1800 },
  play: async () => { await expect(digit()).toBe('1'); }
};

/** At 0 the ring is leaving: it zooms out over the last half second while the digit stays. */
export const RingLeaving: Story = {
  args: { remainingMs: 900, frames: [0, 0.25, 0.5] },
  play: async () => { await expect(digit()).toBe('0'); }
};

export const PerDigitRing: Story = {
  args: { ringTurn: 'per-digit', remainingMs: 2400 },
  play: async () => { await expect(digit()).toBe('2'); }
};

export const LongLabelGerman: Story = {
  globals: { locale: 'de' },
  play: async () => {
    await expect(notice()?.querySelector('.volume-hud-text')?.textContent).toBe(t('autoEnterNoticeTitle'));
    await expect(notice()?.getAttribute('aria-label')).toContain('Kinomodus wird aktiviert');
  }
};

export const RtlArabic: Story = {
  globals: { locale: 'ar' },
  play: async () => { await expect(notice()?.getAttribute('dir')).toBe('rtl'); }
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
  play: async () => {
    await expect(notice()?.querySelector('.caption-hud-spinner')?.getAnimations().length).toBe(0);
  }
};
