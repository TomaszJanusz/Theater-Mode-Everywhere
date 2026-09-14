import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MediaSnapshot } from './media-snapshot';
import { PlayerSession } from './player-session';

function emptySnapshot(): MediaSnapshot {
  return {
    capabilities: { captions: false, chapters: false, previews: false },
    tracks: [],
    chapters: [],
    errors: []
  };
}

describe('PlayerSession', () => {
  it('bind bumps epoch and stays in binding until activate', () => {
    const session = new PlayerSession();
    const first = session.bind();
    assert.equal(session.state.kind, 'binding');
    assert.equal(session.activate(first.epoch), true);
    const second = session.bind(first.id, first.nonce);
    assert.equal(second.id, first.id);
    assert.equal(second.nonce, first.nonce);
    assert.equal(second.epoch, first.epoch + 1);
    assert.equal(session.state.kind, 'binding');
    assert.equal(session.activate(), true);
    assert.equal(session.state.kind, 'active');
  });

  it('exit and dispose are idempotent', () => {
    const session = new PlayerSession();
    session.bind();
    assert.equal(session.tryBeginExit(), true);
    assert.equal(session.tryBeginExit(), false);
    session.finishExit();
    session.finishExit();
    assert.equal(session.state.kind, 'idle');
    session.dispose();
    session.dispose();
    assert.equal(session.state.kind, 'disposed');
  });

  it('rejects snapshots until the session is active', () => {
    const session = new PlayerSession();
    const bound = session.bind();
    assert.equal(session.publishSnapshot(emptySnapshot(), bound.epoch), false);
    assert.equal(session.activate(bound.epoch), true);
    assert.equal(session.publishSnapshot(emptySnapshot(), bound.epoch), true);
  });

  it('ignores a snapshot from a stale epoch', () => {
    const session = new PlayerSession();
    const first = session.bind();
    session.activate(first.epoch);
    session.bind();
    session.activate();
    assert.equal(session.publishSnapshot({
      capabilities: { captions: true, chapters: false, previews: false },
      tracks: [],
      chapters: [],
      errors: []
    }, first.epoch), false);
    assert.equal(session.state.kind, 'active');
    if (session.state.kind === 'active') {
      assert.equal(session.state.snapshot.capabilities.captions, false);
    }
  });
});
