import type { FrameSource } from '../src/ui/chat-separator';

/** Animation frames a story or test runs by hand, each lasting as long as it says. */
export interface ManualFrames {
  source: FrameSource;
  /** Frames requested and not yet run or cancelled. */
  readonly pending: number;
  /** Ends the current frame after `ms` and runs the callbacks requested for the next one. */
  tick(ms: number): void;
}

export function manualFrames(): ManualFrames {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, (now: number) => void>();
  return {
    source: {
      request(callback) { const id = nextId++; pending.set(id, callback); return id; },
      cancel(id) { pending.delete(id); }
    },
    get pending() { return pending.size; },
    tick(ms) {
      now += ms;
      const due = [...pending.values()];
      pending.clear();
      for (const callback of due) callback(now);
    }
  };
}
