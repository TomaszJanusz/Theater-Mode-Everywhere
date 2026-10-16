import assert from 'node:assert/strict';
import { it } from 'node:test';
import { AUTO_ENTER_NOTICE_MIN_MS, createAutoEnterIntent } from './auto-theater-intent';

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
