import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { clockLabels, formatClock, planDigitRolls, TIME_DIGIT_STAGGER_MS, TIME_DIGIT_TRANSITION_MS, timeShape } from './time-readout';

describe('clock labels', () => {
  it('keeps one width for every position in a title', () => {
    for (const end of [0, 9, 59, 90, 599, 600, 3599, 3600, 5400, 36000]) {
      const first = clockLabels(0, end, false);
      for (let current = 0; current <= end; current += end > 4000 ? 37 : 1) {
        const remaining = clockLabels(current, end, false);
        const total = clockLabels(current, end, true);
        assert.equal(remaining.elapsed.length, first.elapsed.length, `elapsed @ ${current}/${end}`);
        assert.equal(remaining.edge.length, first.edge.length, `remaining @ ${current}/${end}`);
        assert.equal(total.edge.length, remaining.edge.length, `toggle @ ${current}/${end}`);
        assert.equal(total.elapsed, remaining.elapsed);
      }
    }
  });

  it('matches the previous clock for ordinary durations', () => {
    assert.equal(formatClock(0, timeShape(90)), '0:00');
    assert.equal(formatClock(65, timeShape(90)), '1:05');
    assert.equal(formatClock(65, timeShape(600)), '01:05');
    assert.equal(formatClock(3661, timeShape(7200)), '1:01:01');
  });

  it('pads hours to the duration so the tenth hour does not grow the label', () => {
    assert.equal(formatClock(0, timeShape(36000)), '00:00:00');
    assert.equal(formatClock(36000, timeShape(36000)), '10:00:00');
    assert.equal(clockLabels(0, 36000, false).elapsed.length, clockLabels(36000, 36000, false).elapsed.length);
  });

  it('puts a stable sign column on the trailing time', () => {
    const remaining = clockLabels(30, 125, false);
    const total = clockLabels(30, 125, true);
    assert.equal(remaining.edge, '-1:35');
    assert.equal(total.edge, ' 2:05');
    assert.equal(remaining.elapsed, '0:30');
  });

  it('settles well inside the one-second tick', () => {
    assert.ok(TIME_DIGIT_TRANSITION_MS <= 400);
    assert.ok(TIME_DIGIT_TRANSITION_MS >= 280);
    const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), './shadow.css'), 'utf8');
    for (const name of ['roll-in', 'sharpen', 'roll-out', 'soften']) {
      assert.match(css, new RegExp(`theater-time-${name} ${TIME_DIGIT_TRANSITION_MS}ms`));
      const keyframes = css.match(new RegExp(`@keyframes theater-time-${name} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? '';
      assert.ok(keyframes, name);
      assert.doesNotMatch(keyframes, /color|opacity|text-shadow/, `${name} keeps the ink as it is`);
    }
  });

  it('starts the leftmost changing digit first and skips unchanged ones', () => {
    const plan = planDigitRolls('0:39', '0:40');
    assert.deepEqual(plan.map((roll) => roll?.delayMs ?? null), [null, null, 0, TIME_DIGIT_STAGGER_MS]);
    assert.deepEqual(planDigitRolls('0:41', '0:42').map((roll) => roll?.delayMs ?? null), [null, null, null, 0]);
  });

  it('rolls every digit of a readout one way, carries included', () => {
    assert.ok(planDigitRolls('0:59', '1:00').every((roll) => roll === null || !roll.countsDown));
    assert.ok(planDigitRolls('1:00', '0:59').every((roll) => roll === null || roll.countsDown));
    assert.ok(planDigitRolls('0:41', '0:40')[3]?.countsDown);
  });

  it('caps the stagger and leaves non-digits undelayed', () => {
    const plan = planDigitRolls('0:00:00', '1:11:11');
    const delays = plan.map((roll) => roll?.delayMs);
    assert.deepEqual(delays, [0, undefined, TIME_DIGIT_STAGGER_MS, 2 * TIME_DIGIT_STAGGER_MS, undefined, 3 * TIME_DIGIT_STAGGER_MS, 3 * TIME_DIGIT_STAGGER_MS]);
    assert.equal(planDigitRolls('-0:10', ' 0:10')[0]?.delayMs, 0);
  });

  it('finishes the widest stagger before the next one-second tick', () => {
    const latest = Math.max(...planDigitRolls('0:00:00', '1:11:11').map((roll) => roll?.delayMs ?? 0));
    assert.ok(latest + TIME_DIGIT_TRANSITION_MS < 1000, `${latest} ms`);
  });
});
