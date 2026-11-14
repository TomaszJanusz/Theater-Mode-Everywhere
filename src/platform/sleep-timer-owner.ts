import {
  resolveSleepTimer, resolveSleepTimerRequest, SLEEP_TIMER_ACTION, sleepTimerStep, type SleepTimer, type SleepTimerBroadcast
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
  /**
   * The cycle shortcut: the row's up arrow, from the time left now (Off starts 15, 110 left starts 120), and Off
   * once nothing longer is offered, so presses go Off, 15, 30 ... 240, Off.
   */
  cycle(): Promise<SleepTimer | null>;
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

  /** Starts `minutes` from now, or turns the timer off for 0, and tells every tab. */
  async function set(minutes: number): Promise<SleepTimer | null> {
    const timer = minutes ? { minutes, deadline: host.now() + minutes * 60_000 } : null;
    await host.write(timer);
    await host.schedule(timer?.deadline ?? null);
    await host.broadcast({ action: SLEEP_TIMER_ACTION, timer });
    return timer;
  }

  return {
    request: minutes => serial(async () => {
      const chosen = resolveSleepTimerRequest(minutes);
      return chosen === undefined ? current() : set(chosen);
    }),
    cycle: () => serial(async () => set(sleepTimerStep(await current(), host.now(), 1) ?? 0)),
    // A wake-up before the deadline (the wall clock moved back) is scheduled again for it.
    reconcile: () => serial(async () => { await host.schedule((await current())?.deadline ?? null); })
  };
}

/** What the background answers a frame: the timer a request left (null is Off), or `failed`. */
export type SleepTimerReply = { timer: SleepTimer | null } | { failed: true };

/**
 * Turns a request into its answer. A request that rejected (a refused alarm or broadcast after the write) answers
 * `failed`, never `{ timer: null }`, so no frame reports Off, or any state, the owner did not reach.
 */
export function sleepTimerReply(work: Promise<SleepTimer | null>, onError: (error: unknown) => void): Promise<SleepTimerReply> {
  return work.then(timer => ({ timer }), (error: unknown) => {
    onError(error);
    return { failed: true };
  });
}
