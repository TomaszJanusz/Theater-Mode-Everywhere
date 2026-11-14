import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveSleepTimer, resolveSleepTimerRequest, SLEEP_TIMER_MINUTES, sleepTimerMinutesLeft, sleepTimerSegment, sleepTimerStep,
  type SleepTimerBroadcast
} from '../core/sleep-timer';

import { createSleepTimerOwner } from './sleep-timer-owner';

const MINUTE = 60_000;

/** The background's browser surface: session storage, one alarm and the tab broadcast, on a clock the test moves. */
function fakeBrowser(stored?: unknown) {
  const state = { now: 1_000_000, stored, alarm: null as number | null, sent: [] as SleepTimerBroadcast[] };
  const owner = createSleepTimerOwner({
    now: () => state.now,
    read: async () => state.stored,
    write: async timer => { state.stored = timer ?? undefined; },
    schedule: async when => { state.alarm = when; },
    broadcast: async message => { state.sent.push(message); }
  });
  return { state, owner };
}

describe('sleep timer record', () => {
  it('accepts only an offered duration with a finite deadline', () => {
    assert.deepEqual(resolveSleepTimer({ minutes: 30, deadline: 5 }), { minutes: 30, deadline: 5 });
    for (const value of [null, undefined, 30, 'x', {}, { minutes: 0, deadline: 5 }, { minutes: 20, deadline: 5 },
      { minutes: 30, deadline: Infinity }, { minutes: 30, deadline: '5' }]) {
      assert.equal(resolveSleepTimer(value), null, JSON.stringify(value));
    }
    assert.equal(resolveSleepTimerRequest(0), 0);
    assert.equal(resolveSleepTimerRequest(120), 120);
    assert.equal(resolveSleepTimerRequest(240), 240);
    assert.deepEqual(resolveSleepTimer({ minutes: 240, deadline: 5 }), { minutes: 240, deadline: 5 });
    for (const value of [undefined, -15, 16, 180, 480, '15', NaN]) assert.equal(resolveSleepTimerRequest(value), undefined);
  });

  it('counts whole minutes up, so a fresh timer reads its duration and the last minute reads 1', () => {
    const timer = { minutes: 30, deadline: 30 * MINUTE };
    assert.equal(sleepTimerMinutesLeft(timer, 0), 30);
    assert.equal(sleepTimerMinutesLeft(timer, 1), 30);
    assert.equal(sleepTimerMinutesLeft(timer, MINUTE), 29);
    assert.equal(sleepTimerMinutesLeft(timer, 30 * MINUTE - 1), 1);
    assert.equal(sleepTimerMinutesLeft(timer, 30 * MINUTE), 0);
    assert.equal(sleepTimerMinutesLeft(timer, 40 * MINUTE), 0);
    assert.equal(sleepTimerMinutesLeft(null, 0), 0);
  });
});

describe('sleep timer row', () => {
  // The row lights the longest option the time left still covers, and each arrow starts the next option past it.
  const now = 0;
  const left = (minutes: number) => ({ minutes: 240, deadline: now + minutes * MINUTE });
  const segment = (minutes: number) => SLEEP_TIMER_MINUTES[sleepTimerSegment(left(minutes), now)];
  it('lights the longest option the time left covers, and never Off while a timer runs', () => {
    for (const [minutes, option] of [[1, 15], [14, 15], [15, 15], [16, 15], [89, 60], [90, 90], [91, 90], [110, 90],
      [119, 90], [120, 120], [121, 120], [239, 120], [240, 240]] as const) {
      assert.equal(segment(minutes), option, `${minutes} min left`);
    }
    // Part of a minute counts as a whole one, as the label shows it: 119.5 minutes read 120.
    assert.equal(segment(119.5), 120);
  });

  it('starts the next option above or below the time left, so a step always changes the timer', () => {
    for (const [minutes, up, down] of [[1, 15, 0], [14, 15, 0], [15, 30, 0], [16, 30, 15], [89, 90, 60], [90, 120, 60],
      [91, 120, 90], [110, 120, 90], [119, 120, 90], [120, 240, 90], [121, 240, 120], [239, 240, 120],
      [240, undefined, 120]] as const) {
      assert.equal(sleepTimerStep(left(minutes), now, 1), up, `${minutes} min left, up`);
      assert.equal(sleepTimerStep(left(minutes), now, -1), down, `${minutes} min left, down`);
    }
  });

  it('is Off with no timer or one that ran out, and holds at the longest option after the clock moved back', () => {
    for (const timer of [null, left(0), left(-30)]) {
      assert.equal(sleepTimerSegment(timer, now), 0);
      assert.equal(sleepTimerStep(timer, now, 1), 15);
      assert.equal(sleepTimerStep(timer, now, -1), undefined);
    }
    assert.equal(segment(300), 240);
    assert.equal(sleepTimerStep(left(300), now, 1), undefined);
    assert.equal(sleepTimerStep(left(300), now, -1), 240);
  });
});

describe('sleep timer owner', () => {
  it('sets a timer, wakes at its deadline and tells every tab', async () => {
    const { state, owner } = fakeBrowser();
    const timer = await owner.request(30);
    const expected = { minutes: 30, deadline: state.now + 30 * MINUTE };
    assert.deepEqual(timer, expected);
    assert.deepEqual(state.stored, expected);
    assert.equal(state.alarm, expected.deadline);
    assert.deepEqual(state.sent, [{ action: 'sleep-timer', timer: expected }]);
  });

  it('offers Off, 15, 30, 45, 60, 90, 120 and 240 minutes, in that order', () => {
    assert.deepEqual(SLEEP_TIMER_MINUTES, [0, 15, 30, 45, 60, 90, 120, 240]);
  });

  it('a four-hour timer wakes four hours from now and counts down from 240 minutes', async () => {
    const { state, owner } = fakeBrowser();
    const timer = await owner.request(240);
    assert.deepEqual(timer, { minutes: 240, deadline: state.now + 240 * MINUTE });
    assert.equal(state.alarm, state.now + 240 * MINUTE);
    assert.equal(sleepTimerMinutesLeft(timer, state.now), 240);
  });

  it('a change restarts from now and Off clears the timer and its wake-up everywhere', async () => {
    const { state, owner } = fakeBrowser();
    await owner.request(30);
    state.now += 10 * MINUTE;
    assert.deepEqual(await owner.request(45), { minutes: 45, deadline: state.now + 45 * MINUTE });
    assert.equal(state.alarm, state.now + 45 * MINUTE);
    assert.equal(await owner.request(0), null);
    assert.equal(state.stored, undefined);
    assert.equal(state.alarm, null);
    assert.deepEqual(state.sent.at(-1), { action: 'sleep-timer', timer: null });
  });

  it('a read or an invalid request changes nothing; a tab that opens later reads the running timer', async () => {
    const { state, owner } = fakeBrowser();
    const timer = await owner.request(15);
    state.now += 5 * MINUTE;
    for (const request of [undefined, 20, 'off']) assert.deepEqual(await owner.request(request), timer);
    assert.equal(state.sent.length, 1);
  });

  it('expiry fires once and clears; with no timer the wake-up only clears itself', async () => {
    const { state, owner } = fakeBrowser();
    await owner.request(15);
    state.now += 15 * MINUTE;
    await owner.reconcile();
    assert.deepEqual(state.sent.at(-1), { action: 'sleep-timer', timer: null, fired: true });
    assert.equal(state.stored, undefined);
    assert.equal(state.alarm, null);
    const sent = state.sent.length;
    await owner.reconcile();
    assert.equal(state.sent.length, sent);
  });

  it('a wake-up before the deadline (the wall clock moved back) waits for the deadline again', async () => {
    const { state, owner } = fakeBrowser();
    const timer = await owner.request(60);
    state.now -= 30 * MINUTE;
    state.alarm = null;
    await owner.reconcile();
    assert.equal(state.alarm, timer!.deadline);
    assert.deepEqual(state.stored, timer);
    assert.equal(state.sent.length, 1);
  });

  it('a deadline passed unnoticed (clock jump forward, missed alarm) fires at the next read', async () => {
    const { state, owner } = fakeBrowser();
    await owner.request(15);
    state.now += 3 * 60 * MINUTE;
    assert.equal(await owner.request(undefined), null);
    assert.deepEqual(state.sent.at(-1), { action: 'sleep-timer', timer: null, fired: true });
  });

  it('a worker start finds a timer that ran out while it slept and fires it; a browser start finds none', async () => {
    const asleep = fakeBrowser({ minutes: 30, deadline: 999_000 });
    await asleep.owner.reconcile();
    assert.deepEqual(asleep.state.sent, [{ action: 'sleep-timer', timer: null, fired: true }]);
    // Session storage is empty after a restart; an alarm the browser kept is cleared without a broadcast.
    const restarted = fakeBrowser();
    restarted.state.alarm = 999_000;
    await restarted.owner.reconcile();
    assert.equal(restarted.state.alarm, null);
    assert.deepEqual(restarted.state.sent, []);
  });

  it('runs requests and expiry one after another, so a change during expiry is not lost', async () => {
    const { state, owner } = fakeBrowser();
    await owner.request(15);
    state.now += 15 * MINUTE;
    const [, timer] = await Promise.all([owner.reconcile(), owner.request(30)]);
    assert.deepEqual(timer, { minutes: 30, deadline: state.now + 30 * MINUTE });
    assert.deepEqual(state.sent.map(message => message.fired ?? message.timer?.minutes), [15, true, 30]);
    assert.deepEqual(state.stored, timer);
  });
});
