import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { noteWrapperFailure, wrapperFailureCount } from './wrapper-failures';

describe('wrapper failure diagnostics', () => {
  it('never throws into the page when console.warn is replaced by a throwing function', (t) => {
    t.mock.method(console, 'warn', () => { throw new Error('page console'); });
    assert.doesNotThrow(() => noteWrapperFailure('throwing-console', new TypeError('boom')));
    assert.equal(wrapperFailureCount('throwing-console'), 1);
  });
});
