/** An announced automatic entry stays visible this long before theater opens. */
export const AUTO_ENTER_NOTICE_MIN_MS = 5000;

/**
 * A pending notice survives this long without qualifying facts before it is torn down. YouTube's
 * loading phase flips pause/readyState/confirmation/ad facts and fires refresh events in bursts;
 * the countdown keeps running through such blips, and only a lapse longer than this restarts it.
 */
export const AUTO_ENTER_CANCEL_GRACE_MS = 700;

/**
 * Whole seconds shown on the notice: the full seconds left, so 0 is the last second (the ring exits
 * and entry happens at its end). The first frame shows 4 rather than flashing 5 for an instant.
 */
export function noticeSecondsRemaining(remainingMs: number): number {
  return Math.max(0, Math.ceil(remainingMs / 1000) - 1);
}

/** Time until the displayed seconds next change, or null once 0 is showing. */
export function msUntilNoticeSecondChanges(remainingMs: number): number | null {
  const seconds = noticeSecondsRemaining(remainingMs);
  return seconds === 0 ? null : remainingMs - seconds * 1000;
}

export type AutoEnterTarget<K> = {
  /** Identity of the thing being entered (the video); a different key restarts the notice. */
  key: K;
  /** Entry conditions hold right now, including active playback. */
  ready: boolean;
};

export type AutoEnterIntent<K> = {
  /**
   * Feed the latest facts. `null` means nothing qualifies right now: a pending notice keeps
   * counting down for `cancelGraceMs` and is dropped only if that lapses without qualifying facts.
   * A different key replaces the notice at once. Returns true once, when the notice has been
   * visible long enough and the target is ready.
   */
  update(target: AutoEnterTarget<K> | null): boolean;
  /** Stops the pending notice immediately, skipping the grace. Returns whether one was pending. */
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
  cancelGraceMs?: number;
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
  const cancelGraceMs = options.cancelGraceMs ?? AUTO_ENTER_CANCEL_GRACE_MS;
  let pending: { key: K; elapsed: boolean; timer: unknown; grace: unknown } | null = null;

  const endGrace = (): void => {
    if (pending?.grace === undefined) return;
    clearTimer(pending.grace);
    pending.grace = undefined;
  };
  const stop = (): boolean => {
    if (!pending) return false;
    clearTimer(pending.timer);
    endGrace();
    pending = null;
    options.hide();
    return true;
  };

  return {
    update(target) {
      if (!target) {
        const state = pending;
        // The first lapse starts the grace; repeats must not extend it.
        if (state && state.grace === undefined) {
          state.grace = setTimer(() => {
            if (pending === state) stop();
          }, cancelGraceMs);
        }
        return false;
      }
      endGrace();
      if (pending && !Object.is(pending.key, target.key)) stop();
      if (!pending) {
        const deadline = now() + options.minVisibleMs;
        const state = { key: target.key, elapsed: false, timer: undefined as unknown, grace: undefined as unknown };
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
