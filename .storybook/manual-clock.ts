import type { UiClock } from '../src/ui/ui-clock';

/** A clock a story or test advances by hand: timers run in due order, including ones scheduled meanwhile. */
export interface ManualClock extends UiClock {
  /** Timers scheduled and not yet fired or cleared. */
  readonly pending: number;
  advance(ms: number): void;
  clear(): void;
}

export function manualClock(): ManualClock {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { due: number; handler: () => void }>();
  return {
    now: () => now,
    get pending() { return timers.size; },
    setTimeout(handler, delayMs) {
      const id = nextId++;
      timers.set(id, { due: now + Math.max(0, delayMs), handler });
      return id;
    },
    clearTimeout(id) {
      if (id !== undefined) timers.delete(id);
    },
    clear: () => timers.clear(),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next: [number, { due: number; handler: () => void }] | undefined;
        for (const entry of timers) if (entry[1].due <= end && (!next || entry[1].due < next[1].due)) next = entry;
        if (!next) break;
        timers.delete(next[0]);
        now = Math.max(now, next[1].due);
        next[1].handler();
      }
      now = end;
    }
  };
}
