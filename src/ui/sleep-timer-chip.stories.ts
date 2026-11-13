import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect } from 'storybook/test';

import { manualClock, type ManualClock } from '../../.storybook/manual-clock';
import { renderPlayerBar } from '../../.storybook/player-stage';

import { t } from './messages';
import { queryPlayerUi } from './root';
import { createSleepTimerChip } from './sleep-timer-chip';

interface Args {
  /** Time left on the timer when the story opens; 0 is no timer. */
  secondsLeft: number;
}

const MINUTE = 60_000;
// A fixed wall clock: the chip counts down to the shared deadline on it, and the story moves it by hand.
const WALL_START = Date.UTC(2026, 0, 1, 23, 0);
let stage: { clock: ManualClock; opened: boolean[]; dispose: () => void } | undefined;

/**
 * The control bar's sign of a running sleep timer, the production chip on a manual clock. It sits in a right
 * section as in the player; the timer itself is the background's and never runs here.
 */
const meta: Meta<Args> = {
  title: 'Components/Sleep timer chip',
  argTypes: { secondsLeft: { control: { type: 'number', min: 0, max: 14400, step: 30 } } },
  args: { secondsLeft: 23 * 60 },
  render: ({ secondsLeft }) => renderPlayerBar(scope => {
    const clock = manualClock();
    const opened: boolean[] = [];
    stage = { clock, opened, dispose: () => scope.dispose() };
    const chip = createSleepTimerChip({
      scope, clock, t, wallNow: () => WALL_START + clock.now(),
      bindTooltip: () => {},
      onActivate: keyboard => opened.push(keyboard)
    });
    chip.set(secondsLeft ? { minutes: 30, deadline: WALL_START + secondsLeft * 1000 } : null);
    const right = document.createElement('div');
    right.className = 'theater-controls-right';
    right.append(chip.element);
    return [right];
  })
};
export default meta;

type Story = StoryObj<Args>;

const chip = () => queryPlayerUi<HTMLButtonElement>('.sleep-timer-chip')!;

export const Running: Story = {
  play: async () => {
    await expect(chip().hidden).toBe(false);
    await expect(chip().textContent).toBe(t('sleepTimerMinutes', '23'));
    await expect(chip().getAttribute('aria-label')).toBe(t('sleepTimerPausesIn', t('sleepTimerMinutes', '23')));
  }
};

export const LastMinute: Story = {
  args: { secondsLeft: 40 },
  play: async () => {
    await expect(chip().textContent).toBe(t('sleepTimerUnderMinute'));
  }
};

/** No timer: the chip is absent from the layout, not an empty slot. */
export const Off: Story = {
  args: { secondsLeft: 0 },
  tags: ['no-shot'],
  play: async () => {
    await expect(chip().hidden).toBe(true);
    await expect(chip().getBoundingClientRect().width).toBe(0);
  }
};

/** Repaints at each minute boundary of the deadline, shows under a minute last and goes at the deadline. */
export const CountsDown: Story = {
  args: { secondsLeft: 2 * 60 + 30 },
  tags: ['no-shot'],
  play: async () => {
    const { clock } = stage!;
    await expect(chip().textContent).toBe(t('sleepTimerMinutes', '3'));
    await expect(clock.pending).toBe(1);
    clock.advance(30_000 - 1);
    await expect(chip().textContent).toBe(t('sleepTimerMinutes', '3'));
    clock.advance(1);
    await expect(chip().textContent).toBe(t('sleepTimerMinutes', '2'));
    clock.advance(MINUTE);
    await expect(chip().textContent).toBe(t('sleepTimerUnderMinute'));
    clock.advance(MINUTE);
    await expect(chip().hidden).toBe(true);
    await expect(clock.pending).toBe(0);
  }
};

/** The pointer and the keyboard press the same button; only the keyboard asks the menu to take focus. */
export const Activates: Story = {
  tags: ['no-shot'],
  play: async () => {
    const { opened } = stage!;
    // A pointer click counts presses; Enter and Space on a button click with a count of 0.
    chip().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    chip().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    await expect(opened).toEqual([false, true]);
  }
};

/** A hidden tab keeps no countdown timer and catches up when it shows again; cleanup leaves none either. */
export const HiddenTab: Story = {
  tags: ['no-shot'],
  play: async () => {
    const { clock, dispose } = stage!;
    const setHidden = (value: boolean) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    try {
      setHidden(true);
      await expect(clock.pending).toBe(0);
      clock.advance(5 * MINUTE);
      await expect(chip().textContent).toBe(t('sleepTimerMinutes', '23'));
      setHidden(false);
      await expect(chip().textContent).toBe(t('sleepTimerMinutes', '18'));
      await expect(clock.pending).toBe(1);
    } finally {
      // The own property shadowed the prototype's getter; removing it restores the real visibility.
      delete (document as { hidden?: boolean }).hidden;
    }
    dispose();
    await expect(clock.pending).toBe(0);
  }
};
