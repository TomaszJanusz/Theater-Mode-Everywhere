/** Frames a drag judges together: the median of this many width-writing frames decides. */
const WINDOW = 6;
/** Consecutive in-budget writes that bring a drag back to live resizing. */
const RECOVERY = 2;
/** Longest frame a live resize may take; the display's own interval raises it on slow displays. */
export const LIVE_RESIZE_BUDGET_MS = 24;
const DISPLAY_HEADROOM = 1.5;
const DEFAULT_INTERVAL_MS = 1000 / 60;

/**
 * Decides whether a drag can afford to resize the layout every frame. It is fed the interval of
 * every drag frame, flagged when that frame wrote a width, so the decision follows what a write
 * actually costs on this host (on YouTube a width change restyles the whole page).
 *
 * Live resizing falls back once the median of the last few writing frames is over budget, and
 * returns after consecutive writes within budget: during the fallback those come from the widths
 * applied when the pointer rests. Frames without a write only tell the display's own interval,
 * so a 30 Hz display does not count as over budget.
 */
export interface LiveResizeBudget {
  readonly live: boolean;
  frame(intervalMs: number, wrote: boolean): void;
}

export function createLiveResizeBudget(): LiveResizeBudget {
  let live = true;
  // Learned from frames without a write only: while a slow drag writes every frame, its own
  // intervals must not raise the budget they are judged against.
  let displayInterval = Infinity;
  let writes: number[] = [];
  return {
    get live() { return live; },
    frame(intervalMs, wrote) {
      if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;
      if (!wrote) {
        displayInterval = Math.min(displayInterval, intervalMs);
        return;
      }
      const budget = Math.max(LIVE_RESIZE_BUDGET_MS,
        (Number.isFinite(displayInterval) ? displayInterval : DEFAULT_INTERVAL_MS) * DISPLAY_HEADROOM);
      writes = [...writes, intervalMs].slice(-WINDOW);
      if (live) {
        if (writes.length === WINDOW && median(writes) > budget) {
          live = false;
          writes = [];
        }
      } else if (writes.length >= RECOVERY && writes.slice(-RECOVERY).every(cost => cost <= budget)) {
        live = true;
        // A fresh window: one recovered write does not carry the old slow frames back in.
        writes = [];
      }
    }
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
