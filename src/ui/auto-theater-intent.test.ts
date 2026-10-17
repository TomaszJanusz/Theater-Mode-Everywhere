import assert from 'node:assert/strict';
import { it } from 'node:test';
import { AUTO_ENTER_CANCEL_GRACE_MS, AUTO_ENTER_NOTICE_MIN_MS, createAutoEnterIntent, msUntilNoticeSecondChanges, noticeSecondsRemaining } from './auto-theater-intent';

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

it('floors the notice countdown so 0 is the last second', () => {
  assert.equal(noticeSecondsRemaining(AUTO_ENTER_NOTICE_MIN_MS), 4, 'the first frame shows 4, not an instant of 5');
  assert.equal(noticeSecondsRemaining(4001), 4);
  assert.equal(noticeSecondsRemaining(4000), 3);
  assert.equal(noticeSecondsRemaining(2500), 2);
  assert.equal(noticeSecondsRemaining(1001), 1);
  assert.equal(noticeSecondsRemaining(1000), 0);
  assert.equal(noticeSecondsRemaining(700), 0, '0.7 s remaining shows 0');
  assert.equal(noticeSecondsRemaining(0), 0, 'waiting for playback keeps showing 0');
  assert.equal(noticeSecondsRemaining(-50), 0);
  assert.equal(msUntilNoticeSecondChanges(AUTO_ENTER_NOTICE_MIN_MS), 1000);
  assert.equal(msUntilNoticeSecondChanges(3500), 500);
  assert.equal(msUntilNoticeSecondChanges(2000), 1000);
  assert.equal(msUntilNoticeSecondChanges(1001), 1);
  assert.equal(msUntilNoticeSecondChanges(1000), null);
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

it('counts 4, 3, 2, 1, 0 over the 5 s minimum, one second each', () => {
  assert.equal(AUTO_ENTER_NOTICE_MIN_MS, 5000);
  assert.deepEqual([5000, 4500, 4000, 3000, 2000, 1001, 1000, 500, 0].map(noticeSecondsRemaining), [4, 4, 3, 2, 1, 1, 0, 0, 0]);
});

it('keeps the same notice and countdown when facts return within the cancel grace', () => {
  const { intent, log, advance, onRecheck } = harness();
  const key = {};
  let entered = 0;
  const refresh = () => { if (intent.update({ key, ready: true })) entered++; };
  onRecheck(refresh);
  refresh();
  advance(1000);
  for (let flap = 0; flap < 3; flap++) {
    intent.update(null);
    intent.update(null); // Repeated lapses must not extend the grace.
    advance(AUTO_ENTER_CANCEL_GRACE_MS - 1);
    refresh();
    advance(1);
  }
  assert.deepEqual(log, ['show'], 'one notice, never rebuilt');
  advance(AUTO_ENTER_NOTICE_MIN_MS - 1000 - 3 * AUTO_ENTER_CANCEL_GRACE_MS);
  assert.equal(entered, 1, 'the original deadline still decides entry');
  assert.deepEqual(log, ['show', 'hide']);
});

it('drops the notice when facts stay lost beyond the grace and restarts in full', () => {
  const { intent, log, advance } = harness();
  const key = {};
  intent.update({ key, ready: true });
  advance(2000);
  intent.update(null);
  advance(AUTO_ENTER_CANCEL_GRACE_MS - 1);
  assert.deepEqual(log, ['show']);
  advance(1);
  assert.deepEqual(log, ['show', 'hide']);
  intent.update({ key, ready: true });
  advance(AUTO_ENTER_NOTICE_MIN_MS - 1);
  assert.equal(intent.update({ key, ready: true }), false, 'the restarted countdown is the full minimum');
  advance(1);
  assert.equal(intent.update({ key, ready: true }), true);
});

it('cancel and a different key skip the grace; no grace timer fires after them or disposal', () => {
  const { intent, log, advance } = harness();
  const first = {};
  const second = {};
  intent.update({ key: first, ready: true });
  intent.update(null);
  assert.equal(intent.cancel(), true);
  assert.deepEqual(log, ['show', 'hide']);
  intent.update({ key: first, ready: true });
  intent.update(null);
  intent.update({ key: second, ready: true });
  assert.deepEqual(log, ['show', 'hide', 'show', 'hide', 'show'], 'replacement is immediate');
  advance(AUTO_ENTER_CANCEL_GRACE_MS * 2);
  assert.equal(log.length, 5, 'the old grace timer was cleared by the replacement');
  intent.update(null);
  intent.dispose();
  advance(AUTO_ENTER_CANCEL_GRACE_MS * 2);
  assert.deepEqual(log.slice(5), ['hide']);
});
