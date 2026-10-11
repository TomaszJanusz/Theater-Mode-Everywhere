import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { clockLabels, formatClock, TIME_DIGIT_TRANSITION_MS, timeShape } from './time-readout';

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
    const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../content.css'), 'utf8');
    assert.match(css, new RegExp(`theater-time-blur-in ${TIME_DIGIT_TRANSITION_MS}ms`));
    const keyframes = css.match(/@keyframes theater-time-blur-in \{[\s\S]*?\n\}/)?.[0] ?? '';
    assert.match(keyframes, /text-shadow: 0 0 1\.5px var\(--theater-time-ink, var\(--text-secondary, #a1a1aa\)\)/);
    assert.doesNotMatch(keyframes, /#f4f4f5/);
    assert.doesNotMatch(keyframes, /filter/);
    assert.doesNotMatch(css, /theater-time-blur-out/);
  });
});
