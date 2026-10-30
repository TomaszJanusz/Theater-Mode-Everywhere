import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertBudgetFits, assertWithinBudget, isSyncQuotaMessage, SYNC_WINDOW_MS, SYNC_WRITE_CEILING, SyncWriteQuotaError, SyncWriteWindow,
  waitForRoom, type QuotaClock
} from './sync-quota';

/** A clock whose wait only advances itself, so waits cost no real time. */
function fakeClock(start = 1_000_000): QuotaClock & { waits: number[]; advance(ms: number): void } {
  let time = start;
  const waits: number[] = [];
  return {
    waits,
    now: () => time,
    wait: async ms => { waits.push(ms); time += ms; },
    advance: ms => { time += ms; }
  };
}

describe('SyncWriteWindow', () => {
  it('counts only changes inside the rolling minute', () => {
    const window = new SyncWriteWindow();
    window.record([59_000, 0, 30_000]);
    assert.deepEqual(window.live(59_999), [0, 30_000, 59_000]);
    assert.deepEqual(window.live(60_000), [30_000, 59_000], 'a change exactly one minute old has left the window');
  });

  it('needs no wait while the budget fits under the ceiling', () => {
    const window = new SyncWriteWindow();
    window.record(Array.from({ length: SYNC_WRITE_CEILING - 7 }, (_, i) => 1_000 + i));
    assert.equal(window.waitMs(2_000, 7), 0);
  });

  it('waits only until enough of the oldest changes age out', () => {
    const window = new SyncWriteWindow();
    // 100 changes, one per 500 ms from t=0; a budget of 3 needs the first three to leave.
    window.record(Array.from({ length: SYNC_WRITE_CEILING }, (_, i) => i * 500));
    assert.equal(window.waitMs(50_000, 3), 1_000 + SYNC_WINDOW_MS - 50_000);
    assert.equal(window.waitMs(50_000, 0), 0, 'a scenario that writes nothing never waits');
  });
});

describe('waitForRoom', () => {
  it('waits on the injected clock until the window has room, and not at all when it has', async () => {
    const window = new SyncWriteWindow();
    const clock = fakeClock(0);
    window.record(Array.from({ length: SYNC_WRITE_CEILING }, (_, i) => i * 100));
    const waited = await waitForRoom(window, clock, 10, async () => {});
    // The tenth-oldest change is at 900 ms and leaves the window at 60.9 s.
    assert.equal(clock.now(), 900 + SYNC_WINDOW_MS);
    assert.equal(waited, 900 + SYNC_WINDOW_MS);
    assert.equal(await waitForRoom(window, clock, 10, async () => {}), 0);
    assert.equal(clock.waits.length, 1);
  });

  it('counts changes that show up while it waits', async () => {
    const window = new SyncWriteWindow();
    const clock = fakeClock(0);
    window.record(Array.from({ length: SYNC_WRITE_CEILING }, (_, i) => i));
    let late = [clock.now() + 20_000];
    await waitForRoom(window, clock, 1, async () => { window.record(late); late = []; });
    assert.equal(window.live(clock.now()).length + 1 <= SYNC_WRITE_CEILING, true);
  });

  it('keeps every scenario sequence under the ceiling in any minute, where unthrottled it would exceed Chrome\'s 120', async () => {
    // The shipped suite: about 150 changes in 85 s, here compressed into 55 s of CI-speed scenarios.
    const budgets = [7, 7, 10, 4, 9, 0, 4, 7, 7, 7, 7, 7, 11, 7, 4, 7, 7, 1, 4, 3, 5];
    const peak = async (throttle: boolean) => {
      const window = new SyncWriteWindow();
      const clock = fakeClock(0);
      const all: number[] = [];
      for (const budget of budgets) {
        if (throttle) await waitForRoom(window, clock, budget, async () => {});
        for (let i = 0; i < budget; i++) { window.record([clock.now()]); all.push(clock.now()); }
        clock.advance(2_600); // one scenario
      }
      return Math.max(...all.map(end => all.filter(time => time > end - SYNC_WINDOW_MS && time <= end).length));
    };
    assert.ok(await peak(false) > 120, 'the fixture must overrun the quota without the wait');
    assert.ok(await peak(true) <= SYNC_WRITE_CEILING);
  });
});

describe('budgets', () => {
  it('names the scenario and both counts when a scenario exceeds its declaration', () => {
    assert.doesNotThrow(() => assertWithinBudget('assertAudioWorld', 7, 7));
    assert.doesNotThrow(() => assertWithinBudget('assertAudioWorld', 7, 5));
    assert.throws(() => assertWithinBudget('assertAudioWorld', 7, 9), (error: unknown) => {
      assert.ok(error instanceof SyncWriteQuotaError);
      assert.match(error.message, /"assertAudioWorld" made 9 chrome\.storage\.sync changes but declared 7/);
      return true;
    });
  });

  it('rejects budgets that cannot fit the ceiling or are not counts', () => {
    assert.doesNotThrow(() => assertBudgetFits('ok', SYNC_WRITE_CEILING));
    for (const bad of [-1, 1.5, Number.NaN, SYNC_WRITE_CEILING + 1]) {
      assert.throws(() => assertBudgetFits('bad', bad), /"bad" declares/);
    }
  });

  it('recognizes Chrome\'s quota errors', () => {
    assert.ok(isSyncQuotaMessage('Uncaught (in promise) Error: This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota.'));
    assert.ok(isSyncQuotaMessage('This request exceeds the MAX_SUSTAINED_WRITE_OPERATIONS_PER_MINUTE quota.'));
    assert.ok(!isSyncQuotaMessage('Timeout 30000ms exceeded.'));
  });
});
