import {
  resolveSleepTimer, resolveSleepTimerRequest, SLEEP_TIMER_ACTION, type SleepTimer, type SleepTimerBroadcast
} from '../core/sleep-timer';

/** What the owner needs from the browser; the background passes the real APIs, tests pass fakes. */
export interface SleepTimerHost {
  /** Wall clock, the same one every frame reads the deadline against. */
  now(): number;
  read(): Promise<unknown>;
  write(timer: SleepTimer | null): Promise<void>;
  /** Wakes the owner through `expire` at `when`, or cancels the wake-up for null. */
  schedule(when: number | null): Promise<void>;
  /** Delivers to every frame of every tab; tabs without the player ignore it. */
  broadcast(message: SleepTimerBroadcast): Promise<void>;
}

export interface SleepTimerOwner {
  /** A frame's request: `minutes` sets (0 turns off), anything else reads. Resolves to the current timer. */
  request(minutes: unknown): Promise<SleepTimer | null>;
  /** The wake-up, and every start of the background: fires a timer that ran out, otherwise keeps its wake-up. */
  reconcile(): Promise<void>;
}

/**
 * The single writer of the profile's sleep timer. Operations run one after another, so a request and an expiry
 * never interleave their read and write.
 */
export function createSleepTimerOwner(host: SleepTimerHost): SleepTimerOwner {
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };

  /** The live timer; one that ran out is fired here, whoever noticed first (the alarm or a frame reading). */
  async function current(): Promise<SleepTimer | null> {
    const timer = resolveSleepTimer(await host.read());
    if (timer && timer.deadline <= host.now()) {
      await host.write(null);
      await host.schedule(null);
      await host.broadcast({ action: SLEEP_TIMER_ACTION, timer: null, fired: true });
      return null;
    }
    return timer;
  }

  return {
    request: minutes => serial(async () => {
      const chosen = resolveSleepTimerRequest(minutes);
      if (chosen === undefined) return current();
      const timer = chosen ? { minutes: chosen, deadline: host.now() + chosen * 60_000 } : null;
      await host.write(timer);
      await host.schedule(timer?.deadline ?? null);
      await host.broadcast({ action: SLEEP_TIMER_ACTION, timer });
      return timer;
    }),
    // A wake-up before the deadline (the wall clock moved back) is scheduled again for it.
    reconcile: () => serial(async () => { await host.schedule((await current())?.deadline ?? null); })
  };
}
