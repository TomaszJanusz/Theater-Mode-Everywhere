import assert from 'node:assert/strict';
import { it } from 'node:test';
import { AUTO_ENTER_NOTICE_MIN_MS, createAutoEnterIntent, msUntilNoticeSecondChanges, noticeSecondsRemaining } from './auto-theater-intent';

function harness() {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; run(): void }>();
  const log: string[] = [];
  let recheck: () => void = () => {};
  const intent = createAutoEnterIntent<object>({
    minVisibleMs: AUTO_ENTER_NOTICE_MIN_MS,
    show: () => log.push('show'),
    hide: () => log.push('hide'),
    recheck: () => recheck(),
    setTimer: (run, ms) => { timers.set(++nextId, { at: now + ms, run }); return nextId; },
    clearTimer: id => { timers.delete(id as number); }
  });
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.run(); }
  };
  return { intent, log, advance, onRecheck: (fn: () => void) => { recheck = fn; } };
}

it('announces immediately but enters only after the minimum visible time', () => {
  const { intent, log, advance, onRecheck } = harness();
  const video = {};
  let ready = true;
  let entered = 0;
  const refresh = () => { if (intent.update({ key: video, ready })) entered++; };
  onRecheck(refresh);
  refresh();
  assert.deepEqual(log, ['show']);
  advance(AUTO_ENTER_NOTICE_MIN_MS - 1);
  refresh(); // Playback events during the notice must not shorten it.
  assert.equal(entered, 0);
  advance(1);
  assert.equal(entered, 1);
  assert.deepEqual(log, ['show', 'hide']);
  ready = false;
  refresh();
  assert.equal(entered, 1);
});

it('keeps the notice while the player is still loading, then enters once ready', () => {
  const { intent, log, advance, onRecheck } = harness();
  const video = {};
  let ready = false;
  let entered = 0;
  const refresh = () => { if (intent.update({ key: video, ready })) entered++; };
  onRecheck(refresh);
  refresh();
  advance(10_000);
  assert.equal(entered, 0);
  assert.deepEqual(log, ['show']);
  ready = true;
  refresh();
  assert.equal(entered, 1);
  assert.deepEqual(log, ['show', 'hide']);
});

it('cancel hides the notice, reports it was pending, and prevents the timed entry', () => {
  const { intent, log, advance, onRecheck } = harness();
  let entered = 0;
  const refresh = () => { if (intent.update({ key: {}, ready: true })) entered++; };
  onRecheck(refresh);
  assert.equal(intent.cancel(), false);
  refresh();
  assert.equal(intent.cancel(), true);
  assert.equal(intent.cancel(), false);
  advance(AUTO_ENTER_NOTICE_MIN_MS * 2);
  assert.equal(entered, 0);
  assert.deepEqual(log, ['show', 'hide']);
});

it('rejects stale intent: lost eligibility, replaced media and disposal', () => {
  const { intent, log, advance } = harness();
  const first = {};
  const second = {};
  assert.equal(intent.update({ key: first, ready: true }), false);
  assert.equal(intent.update(null), false);
  advance(AUTO_ENTER_NOTICE_MIN_MS);
  assert.deepEqual(log, ['show', 'hide']);

  intent.update({ key: first, ready: true });
  advance(AUTO_ENTER_NOTICE_MIN_MS - 1);
  intent.update({ key: second, ready: true }); // Restarts the visible time for the new media.
  advance(1);
  assert.equal(intent.update({ key: second, ready: true }), false);
  advance(AUTO_ENTER_NOTICE_MIN_MS);
  assert.equal(intent.update({ key: second, ready: true }), true);

  intent.update({ key: first, ready: true });
  intent.dispose();
  advance(AUTO_ENTER_NOTICE_MIN_MS);
  assert.equal(log.at(-1), 'hide');
  assert.equal(log.filter(entry => entry === 'show').length, log.filter(entry => entry === 'hide').length);
});

it('rounds the notice countdown up and ends on 0 as the ring clears', () => {
  assert.equal(noticeSecondsRemaining(AUTO_ENTER_NOTICE_MIN_MS), 5);
  assert.equal(noticeSecondsRemaining(2001), 3);
  assert.equal(noticeSecondsRemaining(2000), 2);
  assert.equal(noticeSecondsRemaining(1001), 2);
  assert.equal(noticeSecondsRemaining(1000), 1);
  assert.equal(noticeSecondsRemaining(501), 1);
  assert.equal(noticeSecondsRemaining(500), 0);
  assert.equal(noticeSecondsRemaining(0), 0, 'waiting for playback keeps showing 0');
  assert.equal(noticeSecondsRemaining(-50), 0);
  assert.equal(msUntilNoticeSecondChanges(3000), 1000);
  assert.equal(msUntilNoticeSecondChanges(2500), 500);
  assert.equal(msUntilNoticeSecondChanges(2000), 1000);
  assert.equal(msUntilNoticeSecondChanges(1000), 500);
  assert.equal(msUntilNoticeSecondChanges(700), 200);
  assert.equal(msUntilNoticeSecondChanges(500), null);
  assert.equal(msUntilNoticeSecondChanges(0), null);
});

it('hands the notice a remaining time read from the intent clock', () => {
  let now = 100;
  let remaining: (() => number) | undefined;
  const intent = createAutoEnterIntent<object>({
    minVisibleMs: 3000, now: () => now,
    show: read => { remaining = read; }, hide: () => {}, recheck: () => {},
    setTimer: () => 0, clearTimer: () => {}
  });
  intent.update({ key: {}, ready: false });
  assert.equal(remaining!(), 3000);
  now += 1250;
  assert.equal(remaining!(), 1750);
  now += 5000;
  assert.equal(remaining!(), 0);
});

it('counts down from 5 and the ring finishes leaving 0.5 s before the end', () => {
  assert.equal(AUTO_ENTER_NOTICE_MIN_MS, 5000);
  assert.deepEqual([5000, 4500, 4000, 1001, 1000, 501, 500, 0].map(noticeSecondsRemaining), [5, 5, 4, 2, 1, 1, 0, 0]);
  assert.equal(msUntilNoticeSecondChanges(AUTO_ENTER_NOTICE_MIN_MS), 1000);
});
