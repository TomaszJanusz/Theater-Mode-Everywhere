import type { UiClock } from './ui-clock';

/** How long the seek-forward key must stay down before a press counts as a hold rather than a tap. */
export const SEEK_HOLD_DELAY_MS = 350;
/** The playback rate while the seek-forward key is held. */
export const SEEK_HOLD_RATE = 2;

export interface SeekHoldOptions {
  clock: UiClock;
  /** A short press: the ordinary seek forward, run on release. */
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
  /** Ends a hold without seeking, for blur, exit and replaced media; safe to repeat. */
  cancel(): void;
}

/**
 * Tells a tap from a hold on one key. A tap cannot be known until the key comes up, so the seek waits
 * for the release; a press that outlasts the delay never seeks and plays faster until released instead.
 */
export function createSeekHold(options: SeekHoldOptions): SeekHold {
  let pressed: string | null = null;
  let holding = false;
  let timer: number | undefined;

  const clear = () => {
    options.clock.clearTimeout(timer);
    timer = undefined;
  };

  function finish(tap: boolean): void {
    clear();
    pressed = null;
    if (holding) {
      holding = false;
      options.endHold();
    } else if (tap) {
      options.tap();
    }
  }

  return {
    press(key) {
      // A second press without a release (a lost keyup) completes the first one as it stood.
      if (pressed !== null) finish(true);
      pressed = key;
      timer = options.clock.setTimeout(() => {
        timer = undefined;
        holding = true;
        options.startHold();
      }, SEEK_HOLD_DELAY_MS);
    },
    release(key) {
      if (pressed === key) finish(true);
    },
    cancel() {
      if (pressed !== null) finish(false);
    }
  };
}
