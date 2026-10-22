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

/** A deadline already inside the ring's final 100 ms shows no ring exit at all: the notice just ends. */
const FinalHalfSecondNoRing: Story = {
  args: { remainingMs: SPINNER_DEADLINE_END_MS },
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


test('Digit cleanup belongs to the notice clock and cancellation clears it', () => runNoticeCase({
  play: async () => {
    const pending = run().stage.clock.pending;
    run().elapse(500);
    const slot = notice()?.querySelector('.theater-time-slot');
    await expect(slot?.classList.contains('is-rolling')).toBe(true);
    await expect(run().stage.clock.pending).toBe(pending + 1);
    run().stage.advance(399);
    await expect(slot?.classList.contains('is-rolling')).toBe(true);
    run().stage.advance(1);
    await expect(slot?.classList.contains('is-rolling')).toBe(false);
    // Start another roll, then stop before its cleanup deadline.
    run().elapse(1000);
    await expect(slot?.classList.contains('is-rolling')).toBe(true);
    run().stop();
    await expect(run().stage.clock.pending).toBe(0);
  }
}));

const ringTurns = () => (notice()?.querySelector('.caption-hud-spinner')?.getAnimations() ?? [])
  .filter(animation => animation.effect instanceof KeyframeEffect && animation.effect.getKeyframes().some(frame => 'rotate' in frame));

test('Countdown rolls to zero, holds, announces politely and cleans up', () => runNoticeCase({
  args: { remainingMs: 3000 },
  play: async () => {
    const count = () => notice()!.querySelector('.theater-auto-notice-count')!;
    await expect(digit()).toBe('2');
    await expect(count().getAttribute('aria-hidden')).toBe('true');
    await expect(count().querySelectorAll('.is-rolling').length).toBe(0);
    run().elapse(999);
    await expect(digit()).toBe('2');
    run().elapse(1);
    await expect(digit()).toBe('1');
    await expect(count().querySelectorAll('.is-rolling').length).toBe(1);
    const timing = ringTurns()[0]?.effect?.getTiming();
    await expect([ringTurns().length, timing?.iterations, timing?.easing]).toEqual([1, Infinity, 'linear']);
    run().elapse(999);
    await expect(digit()).toBe('1');
    run().elapse(1);
    await expect(digit()).toBe('0');
    run().elapse(5000);
    await expect(digit()).toBe('0');
    await expect(notice()?.getAttribute('aria-live')).toBe('polite');
    await expect(notice()?.getAttribute('aria-label')).toContain('Entering theater mode');
    run().stop();
    run().stop();
    run().stage.clock.advance(5000);
    await expect(notice()).toBeNull();
  }
}));

test('Reduced motion swaps the countdown without rolling or turning', () => runNoticeCase({
  globals: { reduceMotion: 'on' }, args: { remainingMs: 3000 },
  play: async () => {
    run().elapse(1000);
    await expect(digit()).toBe('1');
    await expect(notice()?.querySelectorAll('.is-rolling').length).toBe(0);
    await expect(ringTurns().length).toBe(0);
  }
}));

test('Per-digit ring replaces its eased turn on each digit change', () => runNoticeCase({
  args: { remainingMs: 3000, ringTurn: 'per-digit', progress: 0 },
  play: async () => {
    const first = ringTurns()[0]!;
    run().elapse(1000);
    await expect(digit()).toBe('1');
    const turns = ringTurns();
    await expect(turns.length).toBe(1);
    await expect(turns[0]).not.toBe(first);
    await expect(first.playState).toBe('idle');
    await expect(Number(turns[0]!.currentTime)).toBeLessThan(250);
    await expect(turns[0]!.effect?.getTiming().easing).not.toBe('linear');
  }
}));

// The stage pins running animations to a fixed frame, so growth is checked by its timing; the clock-exact
// frames live in spinner-exit.browser.test.ts.
const arcs = () => [...(notice()?.querySelectorAll<HTMLElement>('.theater-auto-notice-arc') ?? [])];
const arcTimings = () => arcs().flatMap(arc => arc.getAnimations().map(animation => {
  const { delay, duration } = animation.effect!.getTiming();
  return [Math.round(Number(delay)), Math.round(Number(duration))];
}));
const wait = () => notice()?.querySelector<HTMLElement>('.theater-auto-notice-wait');
const dotsOn = () => wait()?.querySelectorAll('.is-on').length;

const zoomOuts = () => (notice()?.querySelector('.caption-hud-spinner')?.getAnimations() ?? [])
  .filter(animation => animation.effect instanceof KeyframeEffect && animation.effect.getKeyframes().some(frame => 'scale' in frame));

test('The accent grows during the second before 0 and stays full until the ring zooms out', () => runNoticeCase({
  args: { remainingMs: 3000 },
  play: async () => {
    run().elapse(999);
    await expect(arcs().length).toBe(0);
    run().elapse(1);
    // 2 s left: three quadrants fade in one after another across the next second.
    await expect(arcTimings()).toEqual([[0, 333], [333, 333], [667, 333]]);
    const grown = arcs();
    // 1 s down to 500 ms left: nothing else happens to the ring.
    run().elapse(1499);
    await expect(arcs()).toEqual(grown);
    await expect(zoomOuts().length).toBe(0);
    // From 500 ms left it zooms out over 400 ms.
    run().elapse(1);
    await expect(zoomOuts().map(animation => animation.effect?.getTiming().duration)).toEqual([400]);
  }
}));

test('Joining late builds the growth once', () => runNoticeCase({
  args: { remainingMs: 1500 },
  play: async () => {
    await expect(arcTimings().length).toBe(3);
    run().elapse(500);
    await expect(arcTimings().length).toBe(3);
  }
}));

test('Reduced motion shows the full circle without fading or zooming', () => runNoticeCase({
  globals: { reduceMotion: 'on' }, args: { remainingMs: 3000 },
  play: async () => {
    run().elapse(1000);
    await expect(arcs().length).toBe(3);
    await expect(arcTimings()).toEqual([]);
    run().elapse(1499);
    await expect(notice()?.querySelector('.caption-hud-spinner')).not.toBeNull();
    run().elapse(1);
    await expect(notice()?.querySelector('.caption-hud-spinner')).toBeNull();
  }
}));

test('A 0 that waits on the video gets an ellipsis after 200 ms, cycling until hidden', () => runNoticeCase({
  args: { remainingMs: 1000 },
  play: async () => {
    run().elapse(1000);
    await expect(digit()).toBe('0');
    run().elapse(199);
    await expect(wait()?.parentElement?.classList.contains('is-waiting')).toBe(false);
    run().elapse(1);
    await expect(wait()?.parentElement?.classList.contains('is-waiting')).toBe(true);
    await expect(dotsOn()).toBe(1);
    for (const expected of [2, 3, 4, 1, 2]) {
      run().elapse(399);
      run().elapse(1);
      await expect(dotsOn()).toBe(expected);
    }
    // Decorative and silent: hidden from assistive tech, so no frame is announced.
    await expect(wait()?.getAttribute('aria-hidden')).toBe('true');
    await expect(notice()?.getAttribute('aria-live')).toBe('polite');
    run().stop();
    run().stop();
    await expect(run().stage.clock.pending).toBe(0);
    await expect(notice()).toBeNull();
  }
}));

test('Hiding inside the 200 ms grace never starts the ellipsis', () => runNoticeCase({
  args: { remainingMs: 1000 },
  play: async () => {
    run().elapse(1100);
    run().stop();
    await expect(run().stage.clock.pending).toBe(0);
    run().stage.clock.advance(5000);
    await expect(notice()).toBeNull();
  }
}));

test('A late join at 0 still waits 200 ms before the ellipsis', () => runNoticeCase({
  args: { remainingMs: 0 },
  play: async () => {
    run().elapse(199);
    await expect(wait()?.parentElement?.classList.contains('is-waiting')).toBe(false);
    run().elapse(1);
    await expect(dotsOn()).toBe(1);
  }
}));
