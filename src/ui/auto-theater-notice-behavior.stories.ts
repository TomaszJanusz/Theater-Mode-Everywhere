import type { Meta } from '@storybook/html-vite';
import { expect } from 'storybook/test';

import { activeAnimationCount, uiNodeCount } from '../../.storybook/hud-stage';
import { digit, notice, renderNotice, run, type NoticeArgs, type NoticeStoryObj } from '../../.storybook/notice-story';

import { SPINNER_DEADLINE_END_MS } from './spinner-exit';

// Lifecycle of the countdown on a clock and an intent the story advances by hand.
const meta: Meta<NoticeArgs> = {
  title: 'Player/Auto-theater notice behavior',
  globals: { reduceMotion: 'off' },
  tags: ['no-shot'],
  args: { remainingMs: 4500, ringTurn: 'uniform', progress: 0.5 },
  render: renderNotice
};
export default meta;

type Story = NoticeStoryObj;

/** One timer per displayed second, re-armed at each change and ending on 0. */
export const CountsDownBySeconds: Story = {
  play: async () => {
    await expect(digit()).toBe('4');
    run().elapse(499);
    await expect(digit()).toBe('4');
    run().elapse(1);
    await expect(digit()).toBe('3');
    run().elapse(1000);
    await expect(digit()).toBe('2');
    run().elapse(3000);
    await expect(digit()).toBe('0');
  }
};

/** The intent owns the deadline: a notice shown late joins at the right digit and never restarts it. */
export const JoinsWhereTheClockSays: Story = {
  args: { remainingMs: 2300 },
  play: async () => {
    await expect(digit()).toBe('2');
    run().elapse(300);
    await expect(digit()).toBe('1');
  }
};

export const ClickCancelsOnce: Story = {
  play: async () => {
    notice()!.click();
    await expect(run().cancel.calls).toBe(1);
  }
};

export const PressKeepsHostFocus: Story = {
  play: async () => {
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    notice()!.dispatchEvent(press);
    await expect(press.defaultPrevented).toBe(true);
  }
};

/** Intent finished or cancelled elsewhere: the notice leaves with its timers and animations, twice-safe. */
export const CleanupLeavesNothing: Story = {
  play: async () => {
    run().elapse(1200);
    run().stop();
    run().stop();
    await expect(notice()).toBeNull();
    await expect(uiNodeCount()).toBe(0);
    await expect(run().stage.clock.pending).toBe(0);
    await expect(activeAnimationCount()).toBe(0);
    // A tick scheduled before cleanup must not render into the removed notice.
    run().stage.clock.advance(10_000);
    await expect(notice()).toBeNull();
  }
};

/** A deadline already inside the final half second shows no ring exit at all: the notice just ends. */
export const FinalHalfSecondNoRing: Story = {
  args: { remainingMs: SPINNER_DEADLINE_END_MS - 100 },
  play: async () => {
    await expect(notice()?.querySelector('.caption-hud-spinner')).toBeNull();
  }
};

export const RingTurnSurvivesTicks: Story = {
  play: async () => {
    const turns = () => (notice()?.querySelector('.caption-hud-spinner')?.getAnimations() ?? [])
      .filter(animation => animation.effect instanceof KeyframeEffect
        && animation.effect.getKeyframes().some(frame => 'rotate' in frame));
    const first = turns();
    await expect(first.length).toBe(1);
    run().elapse(2000);
    await expect(turns()).toEqual(first);
  }
};
