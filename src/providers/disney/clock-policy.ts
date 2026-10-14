/**
 * Disney playhead scheduling. Native TIMECODE / SEEK_COMPLETE / RESUMED events
 * own the clock. One fallback interval exists only while those events are not
 * covering playback, a paused seek still needs settling, or a play page is
 * still looking for its hive player. A single stall timeout waits out a quiet
 * native clock before that interval starts.
 */

/** Timeline reads while native timecode is silent. Matches the previous poll. */
export const DISNEY_CLOCK_FALLBACK_MS = 250;

/**
 * A playing native clock older than this is treated as stalled. Longer than one
 * 250 ms timecode, so a steady native cadence never starts the fallback.
 */
export const DISNEY_NATIVE_CLOCK_STALE_MS = 400;

/**
 * How long a `/play/` page may keep looking after a wake signal while the hive
 * player is not readable yet. Events take over once it binds.
 */
export const DISNEY_CLOCK_MOUNT_MS = 8_000;

/** Host seek is complete when the hive playhead is this close to the target. */
export const DISNEY_SEEK_REACHED_SECONDS = 2.5;

export type DisneyClockTick = 'discover' | 'playhead' | 'seek';

export type DisneyClockArm = 'off' | 'interval' | 'watchdog';

export type DisneyClockReason = 'sync' | 'tick' | 'watchdog';

export type DisneyClockSample = {
  enabled: boolean;
  hidden: boolean;
  /** `/play/` id. Null on the catalog and every other route. */
  playId: string | null;
  playerBound: boolean;
  nativeBound: boolean;
  paused: boolean;
  pendingSeek: boolean;
  /** Bumps when the cached hive player is replaced or dropped. */
  playerGeneration: number;
  /** A wake signal is still inside its discovery window and hive is not bound. */
  playerMounting: boolean;
};

export type DisneyClockInput = DisneyClockSample & {
  /** Play id the armed session belongs to. Null after the session ends. */
  sessionPlayId: string | null;
  /** Age of the last native clock event. Null when this player has not emitted one. */
  nativeAgeMs: number | null;
  /** Age of the current mount attempt. Null when nothing is mounting. */
  mountingForMs: number | null;
  /** Visibility returned, the player generation changed, or a suspend ended. */
  catchUp: boolean;
  reason: DisneyClockReason;
};

export type DisneyClockDecision = {
  /** Drop the remembered session. Hidden tabs keep it and resume later. */
  endSession: boolean;
  arm: DisneyClockArm;
  immediate: DisneyClockTick[];
};

export type DisneySeekSettlement = 'wait' | 'complete' | 'complete-and-pause';

export function disneySeekSettlement(input: {
  pendingTarget: number | null;
  playhead: number | null;
  pauseAfterSeek: boolean;
}): DisneySeekSettlement {
  if (input.pendingTarget == null || input.playhead == null) return 'wait';
  if (Math.abs(input.playhead - input.pendingTarget) > DISNEY_SEEK_REACHED_SECONDS) return 'wait';
  return input.pauseAfterSeek ? 'complete-and-pause' : 'complete';
}

/** Dataset / clock event only when this target does not already show `seconds`. */
export function disneyPlayheadChanged(previous: string | null | undefined, seconds: number | null): boolean {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return false;
  return previous !== String(seconds);
}

/**
 * Title walks are not part of the playback tick. Read when the play id changes
 * or a harvest / clock re-arm asks for one.
 */
export function shouldRefreshDisneyTitle(input: {
  enabled: boolean;
  playId: string | null;
  previousPlayId: string | null;
  requested: boolean;
}): boolean {
  if (!input.enabled || !input.playId) return false;
  return input.requested || input.playId !== input.previousPlayId;
}

function idle(endSession: boolean): DisneyClockDecision {
  return { endSession, arm: 'off', immediate: [] };
}

export function decideDisneyClock(input: DisneyClockInput): DisneyClockDecision {
  if (!input.enabled || !input.playId) return idle(true);
  if (input.sessionPlayId && input.sessionPlayId !== input.playId) return idle(true);
  if (input.hidden) return idle(false);
  if (!input.playerBound) {
    const mounting = input.playerMounting
      && (input.mountingForMs == null || input.mountingForMs < DISNEY_CLOCK_MOUNT_MS);
    if (mounting) return { endSession: false, arm: 'interval', immediate: ['discover'] };
    // One look on a wake signal or a stall. Ticks do not keep scanning.
    const look = input.reason === 'sync' || input.reason === 'watchdog';
    return { endSession: false, arm: 'off', immediate: look ? ['discover'] : [] };
  }
  if (input.pendingSeek) return { endSession: false, arm: 'interval', immediate: ['playhead', 'seek'] };
  if (input.paused) {
    return { endSession: false, arm: 'off', immediate: input.catchUp ? ['playhead'] : [] };
  }
  const fresh = input.nativeBound
    && input.nativeAgeMs != null
    && input.nativeAgeMs >= 0
    && input.nativeAgeMs < DISNEY_NATIVE_CLOCK_STALE_MS;
  // Wait out one stale window before polling. A native event resets that wait.
  if (input.nativeBound && input.reason !== 'watchdog' && (fresh || input.nativeAgeMs == null)) {
    return { endSession: false, arm: 'watchdog', immediate: input.catchUp ? ['playhead'] : [] };
  }
  const read = input.reason !== 'sync' || input.catchUp || !input.nativeBound;
  return { endSession: false, arm: 'interval', immediate: read ? ['playhead'] : [] };
}

export type DisneyClockTimer = {
  now(): number;
  setInterval(callback: () => void, ms: number): number;
  clearInterval(id: number): void;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(id: number): void;
};

export type DisneyClockScheduler = {
  /** Apply the current sample. Performs any immediate work. */
  sync(): void;
  /** A native TIMECODE, SEEK_COMPLETE, or RESUMED event arrived. */
  noteNative(): void;
  /** Drop timers without forgetting the session. Safe to repeat. */
  suspend(): void;
};

export function createDisneyClockScheduler(
  timer: DisneyClockTimer,
  hooks: {
    sample(): DisneyClockSample;
    perform(kind: DisneyClockTick): void;
  }
): DisneyClockScheduler {
  let sessionPlayId: string | null = null;
  let lastNativeAt: number | null = null;
  let seenGeneration = 0;
  let wasHidden = false;
  let suspended = false;
  let mountStartedAt: number | null = null;
  let intervalId: number | null = null;
  let watchdogId: number | null = null;

  const clearIntervalTimer = () => {
    if (intervalId == null) return;
    timer.clearInterval(intervalId);
    intervalId = null;
  };
  const clearWatchdog = () => {
    if (watchdogId == null) return;
    timer.clearTimeout(watchdogId);
    watchdogId = null;
  };
  const arm = (next: DisneyClockArm, resetWatchdog: boolean) => {
    if (next === 'interval') {
      clearWatchdog();
      if (intervalId == null) intervalId = timer.setInterval(() => apply('tick', false), DISNEY_CLOCK_FALLBACK_MS);
      return;
    }
    clearIntervalTimer();
    if (next === 'off') {
      clearWatchdog();
      return;
    }
    if (watchdogId != null && !resetWatchdog) return;
    clearWatchdog();
    watchdogId = timer.setTimeout(() => {
      watchdogId = null;
      apply('watchdog', false);
    }, DISNEY_NATIVE_CLOCK_STALE_MS);
  };

  const apply = (reason: DisneyClockReason, extraCatchUp: boolean) => {
    let catchUp = extraCatchUp;
    // A discover can bind the player, and a seek tick can finish the pending
    // seek. One follow-up applies the arm for that new sample.
    for (let pass = 0; pass < 3; pass += 1) {
      const sample = hooks.sample();
      if (sample.playerGeneration !== seenGeneration) lastNativeAt = null;
      const mounting = sample.enabled && !sample.hidden && Boolean(sample.playId)
        && sample.playerMounting && !sample.playerBound;
      if (!mounting) mountStartedAt = null;
      else if (mountStartedAt == null) mountStartedAt = timer.now();
      const decision = decideDisneyClock({
        ...sample,
        sessionPlayId,
        nativeAgeMs: lastNativeAt == null ? null : timer.now() - lastNativeAt,
        mountingForMs: mountStartedAt == null ? null : timer.now() - mountStartedAt,
        catchUp: catchUp || suspended || (wasHidden && !sample.hidden) || sample.playerGeneration !== seenGeneration,
        reason
      });
      if (decision.endSession) {
        const endedPlayId = sessionPlayId;
        sessionPlayId = null;
        lastNativeAt = null;
        mountStartedAt = null;
        arm('off', false);
        wasHidden = sample.hidden;
        suspended = false;
        seenGeneration = sample.playerGeneration;
        if (sample.hidden || !sample.enabled || !sample.playId || sample.playId === endedPlayId) return;
        catchUp = true;
        continue;
      }
      if (!sample.hidden && sample.playId) sessionPlayId = sample.playId;
      arm(decision.arm, false);
      const boundBefore = sample.playerBound;
      const pendingBefore = sample.pendingSeek;
      for (const kind of decision.immediate) hooks.perform(kind);
      const after = hooks.sample();
      seenGeneration = after.playerGeneration;
      wasHidden = after.hidden;
      suspended = false;
      const discovered = decision.immediate.includes('discover') && !boundBefore && after.playerBound;
      const settled = pendingBefore && decision.immediate.includes('seek') && !after.pendingSeek;
      if (!discovered && !settled) return;
      catchUp = discovered;
      reason = 'sync';
    }
  };

  return {
    sync() {
      apply('sync', suspended);
    },
    noteNative() {
      const sample = hooks.sample();
      if (!sample.enabled || sample.hidden || !sample.playId || !sample.playerBound) {
        arm('off', false);
        return;
      }
      seenGeneration = sample.playerGeneration;
      lastNativeAt = timer.now();
      sessionPlayId = sample.playId;
      suspended = false;
      wasHidden = false;
      if (sample.pendingSeek) {
        arm('interval', false);
        return;
      }
      if (sample.paused) {
        arm('off', false);
        return;
      }
      arm('watchdog', true);
    },
    suspend() {
      suspended = true;
      arm('off', false);
    }
  };
}
