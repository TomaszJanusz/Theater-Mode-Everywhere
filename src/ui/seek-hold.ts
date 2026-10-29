import { systemClock, type UiClock } from './ui-clock';

/** How long the seek-forward key must stay down before a press also counts as a hold. */
export const SEEK_HOLD_DELAY_MS = 120;
/** The playback rate while the seek-forward key is held. */
export const SEEK_HOLD_RATE = 2;

export interface SeekHoldOptions {
  clock?: UiClock;
  /** Every press: the ordinary seek forward, run as the key goes down. */
  tap(): void;
  /** The key stayed down past the delay. */
  startHold(): void;
  /** The held key was released, or the hold was abandoned. */
  endHold(): void;
}

export interface SeekHold {
  /** The first (non-repeat) keydown of `key`; auto-repeats are the caller's to drop. */
  press(key: string): void;
  /** A keyup; ignored unless it releases the pressed key. */
  release(key: string): void;
  /** Ends a press or hold without seeking, for blur, exit and replaced media; safe to repeat. */
  cancel(): void;
}

/**
 * Tells a tap from a hold on one key. Every press seeks at once, so a tap feels as before; a press that
 * outlasts the delay then plays faster until the key comes up. Ending a press never seeks.
 */
export function createSeekHold(options: SeekHoldOptions): SeekHold {
  const clock = options.clock ?? systemClock;
  let pressed: string | null = null;
  let holding = false;
  let timer: number | undefined;

  function finish(): void {
    clock.clearTimeout(timer);
    timer = undefined;
    pressed = null;
    if (!holding) return;
    holding = false;
    options.endHold();
  }

  return {
    press(key) {
      // A second press without a release (a lost keyup) ends the first one before it seeks again.
      finish();
      pressed = key;
      options.tap();
      timer = clock.setTimeout(() => {
        timer = undefined;
        holding = true;
        options.startHold();
      }, SEEK_HOLD_DELAY_MS);
    },
    release(key) {
      if (pressed === key) finish();
    },
    cancel: finish
  };
}
