import { expect, test } from 'vitest';

import { SPINNER_DEADLINE_END_MS } from '../../src/ui/spinner-exit';
import { runNoticeCase, type NoticeCase } from '../fixture-test';
import { activeAnimationCount, uiNodeCount } from '../hud-stage';
import { digit, notice, run } from '../notice-story';

// Lifecycle of the countdown on a clock and an intent the story advances by hand.

type Story = NoticeCase;

/** One timer per displayed second, re-armed at each change and ending on 0. */
const CountsDownBySeconds: Story = {
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
test('CountsDownBySeconds', () => runNoticeCase(CountsDownBySeconds));

/** The intent owns the deadline: a notice shown late joins at the right digit and never restarts it. */
const JoinsWhereTheClockSays: Story = {
  args: { remainingMs: 2300 },
  play: async () => {
    await expect(digit()).toBe('2');
    run().elapse(300);
    await expect(digit()).toBe('1');
  }
};
test('JoinsWhereTheClockSays', () => runNoticeCase(JoinsWhereTheClockSays));

const ClickCancelsOnce: Story = {
  play: async () => {
    notice()!.click();
    await expect(run().cancel.calls).toBe(1);
  }
};
test('ClickCallsCancel', () => runNoticeCase(ClickCancelsOnce));

const PressKeepsHostFocus: Story = {
  play: async () => {
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    notice()!.dispatchEvent(press);
    await expect(press.defaultPrevented).toBe(true);
  }
};
test('PressPreventsDefault', () => runNoticeCase(PressKeepsHostFocus));

/** Intent finished or cancelled elsewhere: the notice leaves with its timers and animations, twice-safe. */
const CleanupLeavesNothing: Story = {
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
test('CleanupLeavesNothing', () => runNoticeCase(CleanupLeavesNothing));

/** A deadline already inside the final half second shows no ring exit at all: the notice just ends. */
const FinalHalfSecondNoRing: Story = {
  args: { remainingMs: SPINNER_DEADLINE_END_MS - 100 },
  play: async () => {
    await expect(notice()?.querySelector('.caption-hud-spinner')).toBeNull();
  }
};
test('FinalHalfSecondNoRing', () => runNoticeCase(FinalHalfSecondNoRing));

const RingTurnSurvivesTicks: Story = {
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
test('RingTurnSurvivesTicks', () => runNoticeCase(RingTurnSurvivesTicks));
