import { expect, test } from 'vitest';

import { t } from '../../src/ui/messages';
import { runNoticeCase, type NoticeCase } from '../fixture-test';
import { digit, notice } from '../notice-story';

// The countdown the player shows before entering theater on its own. `progress` holds the ring, digit
// roll and zoom-out at a fixed fraction so each frame is the same on every run.

type Story = NoticeCase;

const Counting: Story = {
  play: async () => {
    await expect(digit()).toBe('4');
    await expect(notice()?.getAttribute('role')).toBe('status');
    await expect(notice()?.querySelector('.theater-auto-notice-count')?.getAttribute('aria-hidden')).toBe('true');
  }
};
test('Counting', () => runNoticeCase(Counting));

const LastSecondsDigit: Story = {
  args: { remainingMs: 1800 },
  play: async () => { await expect(digit()).toBe('1'); }
};
test('LastSecondsDigit', () => runNoticeCase(LastSecondsDigit));

/** At 0 the ring is leaving: it zooms out over the last half second while the digit stays. */
const RingLeaving: Story = {
  args: { remainingMs: 900, frames: [0, 0.25, 0.5] },
  play: async () => { await expect(digit()).toBe('0'); }
};
test('RingLeaving', () => runNoticeCase(RingLeaving));

const PerDigitRing: Story = {
  args: { ringTurn: 'per-digit', remainingMs: 2400 },
  play: async () => { await expect(digit()).toBe('2'); }
};
test('PerDigitRing', () => runNoticeCase(PerDigitRing));

const LongLabelGerman: Story = {
  globals: { locale: 'de' },
  play: async () => {
    await expect(notice()?.querySelector('.volume-hud-text')?.textContent).toBe(t('autoEnterNoticeTitle'));
    await expect(notice()?.getAttribute('aria-label')).toContain('Kinomodus wird aktiviert');
  }
};
test('LongLabelGerman', () => runNoticeCase(LongLabelGerman));

const RtlArabic: Story = {
  globals: { locale: 'ar' },
  play: async () => { await expect(notice()?.getAttribute('dir')).toBe('rtl'); }
};
test('RtlArabic', () => runNoticeCase(RtlArabic));

const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
  play: async () => {
    await expect(notice()?.querySelector('.caption-hud-spinner')?.getAnimations().length).toBe(0);
  }
};
test('ReducedMotion', () => runNoticeCase(ReducedMotion));
