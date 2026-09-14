import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveParentMessageTarget } from './parent-origin';

describe('parent message target', () => {
  it('pins to a stored handshake origin', () => {
    assert.equal(resolveParentMessageTarget('https://parent.example', null), 'https://parent.example');
  });

  it('skips when the discovered parent origin no longer matches', () => {
    assert.equal(
      resolveParentMessageTarget('https://parent.example', 'https://other.example'),
      null
    );
  });

  it('uses a wildcard only before a parent origin is known', () => {
    assert.equal(resolveParentMessageTarget(null, null), '*');
  });
});
