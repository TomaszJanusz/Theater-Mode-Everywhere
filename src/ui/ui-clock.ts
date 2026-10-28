/** The timer surface transient UI schedules on, so a caller can drive its lifetime without waiting. */
export interface UiClock {
  setTimeout(handler: () => void, delayMs: number): number;
  clearTimeout(id: number | undefined): void;
  /** Milliseconds on the same timeline the timers run on. */
  now(): number;
}

/** Resolves the window timers at call time, so a page that patches them is still honoured. */
export const systemClock: UiClock = {
  setTimeout: (handler, delayMs) => window.setTimeout(handler, delayMs),
  clearTimeout: id => window.clearTimeout(id),
  now: () => performance.now()
};
