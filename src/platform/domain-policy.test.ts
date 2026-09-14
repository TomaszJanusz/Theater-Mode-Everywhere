import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeHost,
  parentBlockedEntry,
  removeMatchingBlacklistEntry,
  resolveDomainPolicy
} from './domain-policy';

describe('F-04 domain policy', () => {
  it('matches an exact host and strips www', () => {
    assert.equal(normalizeHost('www.Example.com'), 'example.com');
    assert.deepEqual(
      resolveDomainPolicy('www.video.example.com', ['video.example.com']),
      { effective: true, matchedEntry: 'video.example.com', source: 'exact' }
    );
  });

  it('inherits a parent-domain blacklist entry', () => {
    assert.deepEqual(
      resolveDomainPolicy('video.example.com', ['example.com']),
      { effective: true, matchedEntry: 'example.com', source: 'parent' }
    );
  });

  it('treats a trailing DNS root dot as the same host', () => {
    assert.deepEqual(
      resolveDomainPolicy('www.Example.com.', ['example.com']),
      { effective: true, matchedEntry: 'example.com', source: 'exact' }
    );
    assert.deepEqual(
      resolveDomainPolicy('child.example.localhost.', ['example.localhost']),
      { effective: true, matchedEntry: 'example.localhost', source: 'parent' }
    );
  });

  it('prefers the longest parent match', () => {
    assert.deepEqual(
      resolveDomainPolicy('a.b.example.com', ['example.com', 'b.example.com']),
      { effective: true, matchedEntry: 'b.example.com', source: 'parent' }
    );
  });

  it('does not treat sibling or superdomains as matches', () => {
    assert.deepEqual(
      resolveDomainPolicy('example.com', ['video.example.com']),
      { effective: false, matchedEntry: null, source: 'none' }
    );
    assert.deepEqual(
      resolveDomainPolicy('notexample.com', ['example.com']),
      { effective: false, matchedEntry: null, source: 'none' }
    );
  });

  it('removes the matched parent entry when enabling a subdomain', () => {
    assert.deepEqual(
      removeMatchingBlacklistEntry('video.example.com', ['example.com', 'other.test']),
      ['other.test']
    );
  });

  it('exposes the parent entry used by the toolbar popup copy', () => {
    const policy = resolveDomainPolicy('child.example.localhost', ['example.localhost']);
    assert.equal(parentBlockedEntry(policy), 'example.localhost');
    assert.equal(parentBlockedEntry(resolveDomainPolicy('example.localhost', ['example.localhost'])), null);
  });
});
