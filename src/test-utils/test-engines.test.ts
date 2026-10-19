import assert from 'node:assert/strict';
import { it } from 'node:test';
import { parseTestEngines, selectTestEngines } from './test-engines';

it('defaults to both engines and rejects typos or empty selections instead of dropping coverage', () => {
  assert.deepEqual(parseTestEngines('chromium,firefox'), ['chromium', 'firefox']);
  assert.deepEqual(parseTestEngines('firefox'), ['firefox']);
  assert.deepEqual(parseTestEngines(' chromium '), ['chromium']);
  for (const value of ['', 'webkit', 'chromium,', 'chromium,chromium']) {
    assert.throws(() => parseTestEngines(value), /THEATER_TEST_ENGINES/);
  }
});

it('selects labelled browser entries without changing their labels', () => {
  const previous = process.env.THEATER_TEST_ENGINES;
  try {
    delete process.env.THEATER_TEST_ENGINES;
    assert.deepEqual(parseTestEngines(), ['chromium', 'firefox']);
    process.env.THEATER_TEST_ENGINES = 'firefox';
    assert.deepEqual(selectTestEngines(['Chromium', 'Firefox'], name => name), ['Firefox']);
  } finally {
    if (previous === undefined) delete process.env.THEATER_TEST_ENGINES;
    else process.env.THEATER_TEST_ENGINES = previous;
  }
});
