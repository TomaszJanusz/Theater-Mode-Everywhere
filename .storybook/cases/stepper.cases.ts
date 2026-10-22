import { userEvent } from 'storybook/test';
import { expect, test } from 'vitest';

import { runStepperCase, type StepperCase } from '../fixture-test';
import { arrow, run, segments, stepperRoot, stepperRow, stepperValue } from '../stepper-story';

// The stepper owns no timers: its motion is a CSS transition, so these cases need no clock and no sleeps.

type Story = StepperCase;

const current = () => segments().findIndex(segment => segment.dataset.current === 'true');

const ClampsAtBothEnds: Story = {
  args: { count: 3, index: 1 },
  play: async () => {
    arrow(1).click();
    await expect(stepperValue().textContent).toBe('Option 3');
    await expect(arrow(1).disabled).toBe(true);
    await expect(arrow(-1).disabled).toBe(false);
    arrow(1).click();
    await expect(run().steps).toEqual([1]);
    arrow(-1).click();
    arrow(-1).click();
    await expect(current()).toBe(0);
    await expect(arrow(-1).disabled).toBe(true);
    arrow(-1).click();
    await expect(run().steps).toEqual([1, -1, -1]);
  }
};
test('ClampsAtBothEnds', () => runStepperCase(ClampsAtBothEnds));

/** A disabled button drops focus; the stepper hands it to the arrow that still works. */
const KeyboardKeepsFocus: Story = {
  args: { count: 2, index: 0 },
  play: async () => {
    arrow(1).focus();
    await userEvent.keyboard('{Enter}');
    await expect(arrow(1).disabled).toBe(true);
    await expect(stepperRoot().activeElement).toBe(arrow(-1));
    await userEvent.keyboard(' ');
    await expect(current()).toBe(0);
    await expect(stepperRoot().activeElement).toBe(arrow(1));
  }
};
test('KeyboardKeepsFocus', () => runStepperCase(KeyboardKeepsFocus));

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

const ReducedMotionSnapsSegments: Story = {
  globals: { reduceMotion: 'on' },
  play: async () => {
    await expect(getComputedStyle(segments()[0]).transitionDuration).toBe('0s');
  }
};
test('ReducedMotionSnapsSegments', () => runStepperCase(ReducedMotionSnapsSegments));
