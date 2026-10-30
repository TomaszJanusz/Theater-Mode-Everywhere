/**
 * Chrome drops `chrome.storage.sync` writes beyond MAX_WRITE_OPERATIONS_PER_MINUTE (120), which looks
 * like a UI timeout in whichever scenario happens to write next. The installed Chromium smoke makes
 * more changes than that in a CI-speed minute, so every scenario declares how many it makes and the
 * runner waits until a rolling minute has room for them. `onChanged` does not fire for writes that
 * change nothing, so the ceiling keeps headroom below Chrome's limit (observed counts matched Chrome's
 * within a few when the quota was forced).
 */
export const SYNC_WINDOW_MS = 60_000;
export const SYNC_WRITE_CEILING = 110;

const QUOTA_MESSAGE = /MAX_(?:SUSTAINED_)?WRITE_OPERATIONS_PER_(?:MINUTE|HOUR)/;

export function isSyncQuotaMessage(text: string): boolean {
  return QUOTA_MESSAGE.test(text);
}

/** Real time is injected so the waits stay under test control; `smoke.ts` owns the real timer. */
export interface QuotaClock {
  now(): number;
  wait(ms: number): Promise<void>;
}

/** Timestamps of observed sync changes. */
export class SyncWriteWindow {
  private times: number[] = [];

  record(times: readonly number[]): void {
    this.times = [...this.times, ...times].sort((a, b) => a - b);
  }

  /** Changes inside the rolling window ending at `now`, oldest first. */
  live(now: number): number[] {
    return this.times.filter(time => time > now - SYNC_WINDOW_MS);
  }

  /** How long until `budget` more changes fit under the ceiling in every window that can contain them. */
  waitMs(now: number, budget: number): number {
    if (budget === 0) return 0;
    const live = this.live(now);
    const excess = live.length + budget - SYNC_WRITE_CEILING;
    if (excess <= 0) return 0;
    // The `excess` oldest changes must age out; the last of them leaves the window at its time + 60 s.
    return live[excess - 1] + SYNC_WINDOW_MS - now;
  }
}

export class SyncWriteQuotaError extends Error {
  override name = 'SyncWriteQuotaError';
}

export function assertWithinBudget(scenario: string, declared: number, measured: number): void {
  if (measured <= declared) return;
  throw new SyncWriteQuotaError(
    `Smoke scenario "${scenario}" made ${measured} chrome.storage.sync changes but declared ${declared}. ` +
    'Raise its syncWrites in timeScenario so the runner keeps the minute under Chrome\'s write quota.');
}

export function assertBudgetFits(scenario: string, declared: number): void {
  if (Number.isSafeInteger(declared) && declared >= 0 && declared <= SYNC_WRITE_CEILING) return;
  throw new SyncWriteQuotaError(`Smoke scenario "${scenario}" declares ${declared} sync writes; it must be a whole number up to ${SYNC_WRITE_CEILING}.`);
}

/** Waits (on `clock`) until the window has room for `budget` changes; returns the milliseconds slept. */
export async function waitForRoom(
  window: SyncWriteWindow, clock: QuotaClock, budget: number, drain: () => Promise<void>
): Promise<number> {
  let slept = 0;
  for (;;) {
    await drain();
    const ms = window.waitMs(clock.now(), budget);
    if (ms <= 0) return slept;
    await clock.wait(ms);
    slept += ms;
  }
}
