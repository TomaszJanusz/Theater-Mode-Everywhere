import { SPINNER_DEADLINE_END_MS } from './spinner-exit';

/** An announced automatic entry stays visible this long before theater opens. */
export const AUTO_ENTER_NOTICE_MIN_MS = 3000;

/**
 * Whole seconds shown on the notice: rounded up while more than one second remains, 1 until the
 * ring has finished leaving, then 0 for the final stretch and while entry waits for playback.
 */
export function noticeSecondsRemaining(remainingMs: number): number {
  if (remainingMs <= SPINNER_DEADLINE_END_MS) return 0;
  return remainingMs <= 1000 ? 1 : Math.ceil(remainingMs / 1000);
}

/** Time until the displayed seconds next change, or null once 0 is showing. */
export function msUntilNoticeSecondChanges(remainingMs: number): number | null {
  const seconds = noticeSecondsRemaining(remainingMs);
  if (seconds === 0) return null;
  return seconds === 1 ? remainingMs - SPINNER_DEADLINE_END_MS : remainingMs - (seconds - 1) * 1000;
}

export type AutoEnterTarget<K> = {
  /** Identity of the thing being entered (the video); a different key restarts the notice. */
  key: K;
  /** Entry conditions hold right now, including active playback. */
  ready: boolean;
};

export type AutoEnterIntent<K> = {
  /**
   * Feed the latest facts; `null` means nothing qualifies (also rejects stale intent).
   * Returns true once, when the notice has been visible long enough and the target is ready.
   */
  update(target: AutoEnterTarget<K> | null): boolean;
  /** Stops the pending notice. Returns whether one was pending. */
  cancel(): boolean;
  dispose(): void;
};

/**
 * Announces an automatic theater entry before performing it. Time and effects are
 * injected; the owner re-evaluates through `recheck` when the minimum time elapses,
 * so the final decision always uses fresh facts.
 */
export function createAutoEnterIntent<K>(options: {
  minVisibleMs: number;
  /** `remainingMs` reads the notice's remaining minimum time from the same clock as the timer. */
  show(remainingMs: () => number): void;
  hide(): void;
  recheck(): void;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}): AutoEnterIntent<K> {
  const now = options.now ?? (() => performance.now());
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let pending: { key: K; elapsed: boolean; timer: unknown } | null = null;

  const stop = (): boolean => {
    if (!pending) return false;
    clearTimer(pending.timer);
    pending = null;
    options.hide();
    return true;
  };

  return {
    update(target) {
      if (!target) {
        stop();
        return false;
      }
      if (pending && !Object.is(pending.key, target.key)) stop();
      if (!pending) {
        const deadline = now() + options.minVisibleMs;
        const state = { key: target.key, elapsed: false, timer: undefined as unknown };
        pending = state;
        state.timer = setTimer(() => {
          if (pending !== state) return;
          state.elapsed = true;
          options.recheck();
        }, options.minVisibleMs);
        options.show(() => Math.max(0, deadline - now()));
      }
      if (!target.ready || !pending.elapsed) return false;
      stop();
      return true;
    },
    cancel: stop,
    dispose: stop
  };
}
