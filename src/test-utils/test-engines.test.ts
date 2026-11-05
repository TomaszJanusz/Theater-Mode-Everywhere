import assert from 'node:assert/strict';
import { it } from 'node:test';
import { parseTestEngines, selectTestEngines, skipUnlessEngine } from './test-engines';

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

it('skips an engine-tied case only when an explicit selection leaves its engine out', () => {
  // An undefined value falls back to the environment, which a CI engine lane sets.
  const previous = process.env.THEATER_TEST_ENGINES;
  try {
    delete process.env.THEATER_TEST_ENGINES;
    // Unset is the local, nightly and release default: nothing may be skipped.
    assert.equal(skipUnlessEngine('chromium', undefined), false);
    assert.equal(skipUnlessEngine('firefox', undefined), false);
  } finally {
    if (previous === undefined) delete process.env.THEATER_TEST_ENGINES;
    else process.env.THEATER_TEST_ENGINES = previous;
  }
  assert.equal(skipUnlessEngine('chromium', 'chromium'), false);
  assert.equal(skipUnlessEngine('firefox', 'chromium,firefox'), false);
  assert.equal(skipUnlessEngine('chromium', 'firefox'), 'needs chromium; THEATER_TEST_ENGINES=firefox');
  assert.equal(skipUnlessEngine('firefox', 'chromium'), 'needs firefox; THEATER_TEST_ENGINES=chromium');
  // A typo must fail the file, not skip its cases.
  for (const value of ['', 'chrome', 'firefox,firefox']) {
    assert.throws(() => skipUnlessEngine('chromium', value), /THEATER_TEST_ENGINES/);
  }
});

it('reads THEATER_TEST_ENGINES by default', () => {
  const previous = process.env.THEATER_TEST_ENGINES;
  try {
    delete process.env.THEATER_TEST_ENGINES;
    assert.equal(skipUnlessEngine('chromium'), false);
    process.env.THEATER_TEST_ENGINES = 'firefox';
    assert.match(String(skipUnlessEngine('chromium')), /needs chromium/);
    assert.equal(skipUnlessEngine('firefox'), false);
  } finally {
    if (previous === undefined) delete process.env.THEATER_TEST_ENGINES;
    else process.env.THEATER_TEST_ENGINES = previous;
  }
});
