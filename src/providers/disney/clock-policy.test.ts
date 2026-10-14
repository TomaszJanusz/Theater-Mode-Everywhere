import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DISNEY_CLOCK_FALLBACK_MS,
  DISNEY_CLOCK_MOUNT_MS,
  DISNEY_NATIVE_CLOCK_STALE_MS,
  createDisneyClockScheduler,
  decideDisneyClock,
  disneyPlayheadChanged,
  disneySeekSettlement,
  shouldRefreshDisneyTitle,
  type DisneyClockInput,
  type DisneyClockSample,
  type DisneyClockTick
} from './clock-policy';

function decision(overrides: Partial<DisneyClockInput> = {}): DisneyClockInput {
  return {
    enabled: true,
    hidden: false,
    playId: 'play-a',
    sessionPlayId: 'play-a',
    playerBound: true,
    nativeBound: true,
    nativeAgeMs: 0,
    paused: false,
    pendingSeek: false,
    playerGeneration: 1,
    playerMounting: false,
    mountingForMs: null,
    catchUp: false,
    reason: 'sync',
    ...overrides
  };
}

class FakeClock {
  time = 0;
  private serial = 0;
  private intervals = new Map<number, { every: number; due: number; callback: () => void }>();
  private timeouts = new Map<number, { due: number; callback: () => void }>();

  setInterval(callback: () => void, every: number): number {
    const id = ++this.serial;
    this.intervals.set(id, { every, due: this.time + every, callback });
    return id;
  }

  clearInterval(id: number): void {
    this.intervals.delete(id);
  }

  setTimeout(callback: () => void, delay: number): number {
    const id = ++this.serial;
    this.timeouts.set(id, { due: this.time + delay, callback });
    return id;
  }

  clearTimeout(id: number): void {
    this.timeouts.delete(id);
  }

  get pendingTimers(): number {
    return this.intervals.size + this.timeouts.size;
  }

  now(): number {
    return this.time;
  }

  advance(ms: number): void {
    const end = this.time + ms;
    while (true) {
      let next: { kind: 'timeout' | 'interval'; id: number; due: number } | null = null;
      for (const [id, item] of this.timeouts) {
        if (!next || item.due < next.due) next = { kind: 'timeout', id, due: item.due };
      }
      for (const [id, item] of this.intervals) {
        if (!next || item.due < next.due) next = { kind: 'interval', id, due: item.due };
      }
      if (!next || next.due > end) break;
      this.time = next.due;
      if (next.kind === 'timeout') {
        const item = this.timeouts.get(next.id);
        this.timeouts.delete(next.id);
        item?.callback();
      } else {
        const item = this.intervals.get(next.id);
        if (!item) continue;
        item.due += item.every;
        item.callback();
      }
    }
    this.time = end;
  }
}

function fixture(initial: Partial<DisneyClockSample> = {}) {
  const clock = new FakeClock();
  const sample: DisneyClockSample = {
    enabled: true,
    hidden: false,
    playId: 'play-a',
    playerBound: true,
    nativeBound: true,
    paused: false,
    pendingSeek: false,
    playerGeneration: 1,
    playerMounting: false,
    ...initial
  };
  const ticks: Record<DisneyClockTick, number> = { discover: 0, playhead: 0, seek: 0 };
  let onDiscover = () => {};
  const scheduler = createDisneyClockScheduler(clock, {
    sample: () => sample,
    perform(kind) {
      ticks[kind] += 1;
      if (kind === 'discover') onDiscover();
    }
  });
  return {
    clock,
    sample,
    ticks,
    scheduler,
    onDiscover(action: () => void) {
      onDiscover = action;
    },
    snapshot() {
      return { ...ticks, timers: clock.pendingTimers };
    }
  };
}

describe('Disney clock policy', () => {
  it('keeps a paused seek on the completion check and off discovery', () => {
    const pausedSeek = decideDisneyClock(decision({ paused: true, pendingSeek: true }));
    assert.deepEqual(pausedSeek.immediate, ['playhead', 'seek']);
    assert.equal(pausedSeek.arm, 'interval');
    assert.equal(pausedSeek.immediate.includes('discover'), false);
    assert.equal(decideDisneyClock(decision({ paused: true, pendingSeek: false })).arm, 'off');
    assert.equal(disneySeekSettlement({ pendingTarget: 40, playhead: 42.5, pauseAfterSeek: true }), 'complete-and-pause');
    assert.equal(disneySeekSettlement({ pendingTarget: 40, playhead: 42.5, pauseAfterSeek: false }), 'complete');
    assert.equal(disneySeekSettlement({ pendingTarget: 40, playhead: 43, pauseAfterSeek: true }), 'wait');
    assert.equal(disneySeekSettlement({ pendingTarget: null, playhead: 40, pauseAfterSeek: true }), 'wait');
    assert.equal(disneySeekSettlement({ pendingTarget: 40, playhead: null, pauseAfterSeek: true }), 'wait');
  });

  it('does not schedule the catalog, a disabled integration, a hidden tab, or a finished session', () => {
    assert.equal(decideDisneyClock(decision({ playId: null })).endSession, true);
    assert.deepEqual(decideDisneyClock(decision({ playId: null })).immediate, []);
    assert.equal(decideDisneyClock(decision({ enabled: false })).arm, 'off');
    assert.equal(decideDisneyClock(decision({ hidden: true })).endSession, false);
    assert.equal(decideDisneyClock(decision({ hidden: true })).arm, 'off');
    assert.equal(decideDisneyClock(decision({ playId: 'play-b', sessionPlayId: 'play-a' })).endSession, true);
    assert.equal(decideDisneyClock(decision({ playerBound: false, playerMounting: false })).immediate[0], 'discover');
    assert.equal(decideDisneyClock(decision({ playerBound: false, playerMounting: false })).arm, 'off');
    assert.equal(decideDisneyClock(decision({
      playerBound: false, playerMounting: true, mountingForMs: 0
    })).arm, 'interval');
    assert.equal(decideDisneyClock(decision({
      playerBound: false, playerMounting: true, mountingForMs: DISNEY_CLOCK_MOUNT_MS, reason: 'tick'
    })).arm, 'off');
    assert.deepEqual(decideDisneyClock(decision({
      playerBound: false, playerMounting: false, reason: 'watchdog'
    })).immediate, ['discover']);
  });

  it('refreshes the title on play id changes and explicit re-arm requests', () => {
    assert.equal(shouldRefreshDisneyTitle({
      enabled: true, playId: 'play-a', previousPlayId: 'play-a', requested: false
    }), false);
    assert.equal(shouldRefreshDisneyTitle({
      enabled: true, playId: 'play-b', previousPlayId: 'play-a', requested: false
    }), true);
    assert.equal(shouldRefreshDisneyTitle({
      enabled: true, playId: 'play-a', previousPlayId: 'play-a', requested: true
    }), true);
    assert.equal(shouldRefreshDisneyTitle({
      enabled: false, playId: 'play-b', previousPlayId: 'play-a', requested: true
    }), false);
    assert.equal(shouldRefreshDisneyTitle({
      enabled: true, playId: null, previousPlayId: 'play-a', requested: true
    }), false);
    assert.equal(disneyPlayheadChanged('12.5', 12.5), false);
    assert.equal(disneyPlayheadChanged('12.5', 12.75), true);
    assert.equal(disneyPlayheadChanged(undefined, null), false);
  });

  it('counts no fallback ticks on the catalog, after disable, while hidden, or after the old session ends', () => {
    const catalog = fixture({ playId: null, playerBound: false, nativeBound: false, playerGeneration: 0 });
    catalog.scheduler.sync();
    catalog.clock.advance(10_000);
    assert.deepEqual(catalog.ticks, { discover: 0, playhead: 0, seek: 0 });
    assert.equal(catalog.clock.pendingTimers, 0);

    const disabled = fixture({ nativeBound: false });
    disabled.scheduler.sync();
    disabled.clock.advance(DISNEY_CLOCK_FALLBACK_MS);
    assert.equal(disabled.ticks.playhead > 0, true);
    disabled.sample.enabled = false;
    disabled.scheduler.sync();
    const disabledAt = disabled.snapshot();
    disabled.clock.advance(10_000);
    assert.deepEqual(disabled.snapshot(), disabledAt);

    const hidden = fixture();
    hidden.scheduler.noteNative();
    hidden.sample.hidden = true;
    hidden.scheduler.sync();
    hidden.clock.advance(10_000);
    assert.deepEqual(hidden.ticks, { discover: 0, playhead: 0, seek: 0 });
    assert.equal(hidden.clock.pendingTimers, 0);

    const ended = fixture({ nativeBound: false });
    ended.scheduler.sync();
    ended.clock.advance(DISNEY_CLOCK_FALLBACK_MS);
    ended.sample.playId = 'play-b';
    ended.sample.playerBound = false;
    ended.sample.nativeBound = false;
    ended.scheduler.sync();
    const endedAt = ended.snapshot();
    ended.clock.advance(10_000);
    assert.equal(ended.ticks.discover, 1);
    assert.deepEqual(ended.snapshot(), endedAt);
  });

  it('lets native timecode own playback and starts timeline reads only after it stalls', () => {
    const healthy = fixture();
    healthy.scheduler.sync();
    healthy.scheduler.noteNative();
    const warmed = healthy.snapshot();
    for (let step = 0; step < 50; step += 1) {
      healthy.clock.advance(200);
      healthy.scheduler.noteNative();
    }
    assert.deepEqual(healthy.snapshot(), warmed);
    assert.equal(healthy.clock.time, 10_000);

    const stalled = fixture();
    stalled.scheduler.sync();
    stalled.scheduler.noteNative();
    const before = stalled.ticks.playhead;
    stalled.clock.advance(DISNEY_NATIVE_CLOCK_STALE_MS - 1);
    assert.equal(stalled.ticks.playhead, before);
    stalled.clock.advance(1);
    assert.equal(stalled.ticks.playhead, before + 1);
    stalled.clock.advance(DISNEY_CLOCK_FALLBACK_MS);
    assert.equal(stalled.ticks.playhead, before + 2);
    stalled.scheduler.noteNative();
    const recovered = stalled.snapshot();
    stalled.clock.advance(DISNEY_NATIVE_CLOCK_STALE_MS - 1);
    assert.deepEqual(stalled.snapshot(), recovered);
  });

  it('keeps revalidating a paused seek, then stops when the seek completes', () => {
    const seek = fixture({ paused: true, pendingSeek: true });
    seek.scheduler.sync();
    assert.equal(seek.ticks.discover, 0);
    assert.equal(seek.ticks.playhead, 1);
    assert.equal(seek.ticks.seek, 1);
    seek.clock.advance(DISNEY_CLOCK_FALLBACK_MS * 4);
    assert.equal(seek.ticks.discover, 0);
    assert.equal(seek.ticks.playhead, 5);
    assert.equal(seek.ticks.seek, 5);
    seek.sample.pendingSeek = false;
    seek.scheduler.sync();
    const done = seek.snapshot();
    seek.clock.advance(10_000);
    assert.deepEqual(seek.snapshot(), done);
    assert.equal(seek.ticks.discover, 0);
  });

  it('restores the current clock when the tab becomes visible or the player is replaced', () => {
    const visible = fixture({ paused: true });
    visible.scheduler.noteNative();
    visible.sample.hidden = true;
    visible.scheduler.sync();
    visible.clock.advance(10_000);
    visible.sample.hidden = false;
    visible.scheduler.sync();
    assert.equal(visible.ticks.playhead, 1);
    assert.equal(visible.ticks.discover, 0);
    const shown = visible.snapshot();
    visible.clock.advance(10_000);
    assert.deepEqual(visible.snapshot(), shown);

    const replaced = fixture({ paused: true });
    replaced.scheduler.sync();
    const before = replaced.ticks.playhead;
    replaced.sample.playerGeneration += 1;
    replaced.scheduler.sync();
    assert.equal(replaced.ticks.playhead, before + 1);
    assert.equal(replaced.ticks.discover, 0);
    const afterReplace = replaced.snapshot();
    replaced.clock.advance(10_000);
    assert.deepEqual(replaced.snapshot(), afterReplace);
  });

  it('discovers a missing player once and does not poll until one is bound', () => {
    const missing = fixture({ playerBound: false, nativeBound: false, playerGeneration: 0 });
    missing.scheduler.sync();
    assert.equal(missing.ticks.discover, 1);
    assert.equal(missing.ticks.playhead, 0);
    missing.clock.advance(10_000);
    assert.deepEqual(missing.ticks, { discover: 1, playhead: 0, seek: 0 });
    assert.equal(missing.clock.pendingTimers, 0);

    const appears = fixture({ playerBound: false, nativeBound: false, playerGeneration: 0 });
    appears.onDiscover(() => {
      appears.sample.playerBound = true;
      appears.sample.nativeBound = true;
      appears.sample.playerGeneration = 1;
    });
    appears.scheduler.sync();
    assert.equal(appears.ticks.discover, 1);
    assert.equal(appears.ticks.playhead, 1);
    appears.scheduler.noteNative();
    const live = appears.snapshot();
    for (let step = 0; step < 10; step += 1) {
      appears.clock.advance(200);
      appears.scheduler.noteNative();
    }
    assert.deepEqual(appears.snapshot(), live);
  });

  it('rediscovers only while a play page has a player shell, then stops', () => {
    const mounting = fixture({
      playerBound: false,
      nativeBound: false,
      playerGeneration: 0,
      playerMounting: true
    });
    mounting.scheduler.sync();
    assert.equal(mounting.ticks.discover, 1);
    mounting.clock.advance(DISNEY_CLOCK_FALLBACK_MS * 3);
    assert.equal(mounting.ticks.discover > 1, true);
    assert.equal(mounting.ticks.playhead, 0);
    assert.equal(mounting.ticks.seek, 0);
    mounting.clock.advance(DISNEY_CLOCK_MOUNT_MS);
    const stopped = mounting.snapshot();
    mounting.clock.advance(5_000);
    assert.deepEqual(mounting.snapshot(), stopped);
    assert.equal(mounting.clock.pendingTimers, 0);
  });
});
