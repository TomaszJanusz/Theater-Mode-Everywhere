import { userEvent } from 'storybook/test';
import { expect, test } from 'vitest';

import { runStepperCase, type StepperCase } from '../fixture-test';
import { disposeStage } from '../stage-owner';
import { arrow, arrowDisabled, run, segments, segmentsBar, stepperRoot, stepperRow, stepperValue, thumb } from '../stepper-story';

// The stepper owns no timers: its motion is a CSS transition, so these cases need no clock and no sleeps.

type Story = StepperCase;

const current = () => segments().findIndex(segment => segment.dataset.current === 'true');

const ClampsAtBothEnds: Story = {
  args: { count: 3, index: 1 },
  play: async () => {
    arrow(1).click();
    await expect(stepperValue().textContent).toBe('Option 3');
    await expect(arrowDisabled(1)).toBe(true);
    await expect(arrowDisabled(-1)).toBe(false);
    arrow(1).click();
    await expect(run().steps).toEqual([1]);
    arrow(-1).click();
    arrow(-1).click();
    await expect(current()).toBe(0);
    await expect(arrowDisabled(-1)).toBe(true);
    arrow(-1).click();
    await expect(run().steps).toEqual([1, -1, -1]);
  }
};
test('ClampsAtBothEnds', () => runStepperCase(ClampsAtBothEnds));

/** A blocked end keeps focus where it is, so a held key never drops the user's place. */
const KeyboardKeepsFocus: Story = {
  args: { count: 2, index: 0 },
  play: async () => {
    arrow(1).focus();
    await userEvent.keyboard('{Enter}');
    await expect(arrowDisabled(1)).toBe(true);
    await expect(stepperRoot().activeElement).toBe(arrow(1));
    await userEvent.keyboard('{Enter}');
    await expect(run().steps).toEqual([1]);
    await expect(stepperRoot().activeElement).toBe(arrow(1));
  }
};
test('KeyboardKeepsFocus', () => runStepperCase(KeyboardKeepsFocus));

/** The highlight is one element that slides to the new segment; the value never waits for it. */
const ThumbFollowsValue: Story = {
  args: { count: 4, index: 0 },
  play: async () => {
    await expect(getComputedStyle(thumb()).transitionProperty).toBe('transform');
    await expect(Number.parseFloat(getComputedStyle(thumb()).transitionDuration)).toBeLessThanOrEqual(0.2);
    arrow(1).click();
    arrow(1).click();
    await expect(stepperValue().textContent).toBe('Option 3');
    await Promise.all(thumb().getAnimations().map(animation => animation.finished));
    await expect(Math.abs(thumb().getBoundingClientRect().left - segments()[2].getBoundingClientRect().left)).toBeLessThan(1);
  }
};
test('ThumbFollowsValue', () => runStepperCase(ThumbFollowsValue));

/** The label slides in from the pressed side and a quick second step replaces, never stacks, the first. */
const LabelSlidesThenYields: Story = {
  play: async () => {
    arrow(1).click();
    await expect(stepperValue().getAnimations().length).toBe(1);
    arrow(1).click();
    await expect(stepperValue().getAnimations().length).toBe(1);
    await expect(stepperValue().textContent).toBe('Option 5');
    await Promise.all(stepperValue().getAnimations().map(animation => animation.finished));
    await expect(stepperValue().getAnimations().length).toBe(0);
  }
};
test('LabelSlidesThenYields', () => runStepperCase(LabelSlidesThenYields));

/** A press the range cannot take answers with a nudge toward the blocked side, and changes nothing. */
const BlockedPressBumps: Story = {
  args: { count: 3, index: 2 },
  play: async () => {
    arrow(1).click();
    await expect(run().steps).toEqual([]);
    await expect(stepperValue().textContent).toBe('Option 3');
    await expect(stepperValue().getAnimations().length).toBe(1);
    await expect(arrow(1).querySelector('svg')!.getAnimations().length).toBe(1);
    await Promise.all(stepperValue().getAnimations().map(animation => animation.finished));
    await expect(stepperValue().getAnimations().length).toBe(0);
  }
};
test('BlockedPressBumps', () => runStepperCase(BlockedPressBumps));

/** Dropping the stepper (theater exit, navigation) cancels motion in flight. */
const CleanupCancelsMotion: Story = {
  play: async () => {
    arrow(1).click();
    const value = stepperValue();
    await expect(value.getAnimations().length).toBe(1);
    disposeStage();
    await expect(value.getAnimations().length).toBe(0);
  }
};
test('CleanupCancelsMotion', () => runStepperCase(CleanupCancelsMotion));

const SegmentsFollowOptions: Story = {
  play: async () => {
    await expect(segments().length).toBe(5);
    run().update(3, 2);
    await expect(segments().length).toBe(3);
    await expect(current()).toBe(2);
    run().update(6, 0);
    await expect(segments().length).toBe(6);
    await expect(segments().filter(segment => segment.dataset.reached === 'true').length).toBe(1);
  }
};
test('SegmentsFollowOptions', () => runStepperCase(SegmentsFollowOptions));

const ArrowsAreLabelled: Story = {
  play: async () => {
    await expect(arrow(-1).getAttribute('aria-label')).toBe('Setting: previous option');
    await expect(arrow(1).getAttribute('aria-label')).toBe('Setting: next option');
    await expect(stepperRow().getAttribute('role')).toBe('group');
    await expect(stepperRoot().querySelector('.theater-stepper-segments')?.getAttribute('aria-hidden')).toBe('true');
  }
};
test('ArrowsAreLabelled', () => runStepperCase(ArrowsAreLabelled));

/** The lowest option sits at the start edge: arrows, chevrons and segments all mirror. */
const MirrorsInRtl: Story = {
  globals: { locale: 'ar' },
  args: { count: 3, index: 0 },
  play: async () => {
    await expect(arrow(-1).getBoundingClientRect().left).toBeGreaterThan(arrow(1).getBoundingClientRect().left);
    await expect(segments()[0].getBoundingClientRect().left).toBeGreaterThan(segments()[2].getBoundingClientRect().left);
    await expect(getComputedStyle(arrow(-1).querySelector('svg')!).transform).toBe('matrix(-1, 0, 0, 1, 0, 0)');
  }
};
test('MirrorsInRtl', () => runStepperCase(MirrorsInRtl));

const LtrOrder: Story = {
  args: { count: 3, index: 0 },
  play: async () => {
    await expect(arrow(-1).getBoundingClientRect().left).toBeLessThan(arrow(1).getBoundingClientRect().left);
    await expect(segments()[0].getBoundingClientRect().left).toBeLessThan(segments()[2].getBoundingClientRect().left);
  }
};
test('LtrOrder', () => runStepperCase(LtrOrder));

/** Reduce motion keeps every state and removes every movement. */
const ReducedMotionStatesOnly: Story = {
  globals: { reduceMotion: 'on' },
  args: { count: 3, index: 1 },
  play: async () => {
    await expect(getComputedStyle(thumb()).transitionDuration).toBe('0s');
    arrow(1).click();
    arrow(1).click();
    await expect(stepperValue().textContent).toBe('Option 3');
    await expect(stepperValue().getAnimations().length).toBe(0);
    await expect(arrow(1).querySelector('svg')!.getAnimations().length).toBe(0);
    await expect(current()).toBe(2);
  }
};
test('ReducedMotionStatesOnly', () => runStepperCase(ReducedMotionStatesOnly));

/** Off and On: two segments, and each end is the other's only way out. */
const TwoOptionsHoldAtBothEnds: Story = {
  args: { count: 2, index: 0 },
  play: async () => {
    await expect(segments().length).toBe(2);
    await expect(arrowDisabled(-1)).toBe(true);
    await expect(arrowDisabled(1)).toBe(false);
    arrow(1).click();
    await expect(current()).toBe(1);
    await expect(arrowDisabled(1)).toBe(true);
    await expect(arrowDisabled(-1)).toBe(false);
    arrow(1).click();
    await expect(current()).toBe(1);
    arrow(-1).click();
    await expect(current()).toBe(0);
    await expect(run().steps).toEqual([1, -1]);
  }
};
test('TwoOptionsHoldAtBothEnds', () => runStepperCase(TwoOptionsHoldAtBothEnds));

/** A setting that cannot change: both arrows blocked yet focusable, value muted, no segment bar at all, a press only nudges. */
const DisabledStaysInert: Story = {
  args: { count: 2, index: 1, disabled: true },
  play: async () => {
    await expect(arrowDisabled(-1)).toBe(true);
    await expect(arrowDisabled(1)).toBe(true);
    await expect(segmentsBar()).toBe(null);
    await expect(segments().length).toBe(0);
    await expect(stepperValue().textContent).toBe('Unavailable');
    const muted = getComputedStyle(stepperValue()).color;
    arrow(1).focus();
    await userEvent.keyboard('{Enter}');
    arrow(-1).click();
    await expect(run().steps).toEqual([]);
    await expect(stepperRoot().activeElement).toBe(arrow(1));
    await expect(stepperValue().getAnimations().length).toBe(1);
    // It comes back to life when the setting does.
    run().update(2, 1, false);
    await expect(arrowDisabled(-1)).toBe(false);
    await expect(segments().length).toBe(2);
    await expect(current()).toBe(1);
    await expect(getComputedStyle(stepperValue()).color).not.toBe(muted);
    // The bar returns in place: the thumb sits on its segment at once, with nothing sliding in from elsewhere.
    await expect(thumb().getAnimations().length).toBe(0);
    await expect(Math.abs(thumb().getBoundingClientRect().left - segments()[1].getBoundingClientRect().left)).toBeLessThan(1);
    // And it can go away again, leaving no stale bar behind.
    run().update(2, 1, true);
    await expect(segmentsBar()).toBe(null);
    await expect(getComputedStyle(stepperValue()).color).toBe(muted);
  }
};
test('DisabledStaysInert', () => runStepperCase(DisabledStaysInert));
