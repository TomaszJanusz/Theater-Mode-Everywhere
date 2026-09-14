import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createFrameMessage,
  createSessionId,
  isTrustedFrameEnvelope,
  parseFrameMessage,
  parseLegacyFrameMessage,
  readFrameEnvelope,
  type FrameEnvelope
} from './frame-messages';
import { createWorldMessage, parseWorldMessage, readWorldEnvelope } from './world-messages';

type FrameNode = {
  origin: string;
  sessionId: string | null;
  nonce: string | null;
  theater: boolean;
  inbox: FrameEnvelope[];
};

function deliver(from: FrameNode, to: FrameNode, type: FrameEnvelope['type']): void {
  const sessionId = from.sessionId || to.sessionId || createSessionId();
  const nonce = from.nonce || to.nonce || createSessionId();
  to.inbox.push(createFrameMessage(type, sessionId, {}, nonce, from.origin));
}

function accept(node: FrameNode, envelope: FrameEnvelope, fromParent: boolean, fromChild: boolean): boolean {
  return isTrustedFrameEnvelope(envelope, {
    eventOrigin: envelope.origin,
    fromParent,
    fromChild,
    activeSessionId: node.sessionId,
    activeNonce: node.nonce
  });
}

describe('F-01 frame session handshake', () => {
  it('parses a versioned envelope and rejects a forged payload', () => {
    const sessionId = createSessionId();
    const message = createFrameMessage('FRAME_EXIT', sessionId, {}, 'nonce-1', 'https://child.example');
    assert.deepEqual(parseFrameMessage(message)?.type, 'FRAME_EXIT');
    assert.equal(parseFrameMessage({ ...message, v: 0 }), null);
    assert.equal(parseFrameMessage({ ...message, channel: 'other' }), null);
    assert.equal(parseFrameMessage({ ...message, sessionId: '' }), null);
    assert.equal(parseFrameMessage({ ...message, origin: '' }), null);
    assert.equal(parseFrameMessage({ ...message, nonce: '' }), null);
    assert.equal(parseFrameMessage({ ...message, type: 'FRAME_PWN' }), null);
  });

  it('ignores a mismatched origin or nonce on playback commands', () => {
    const sessionId = createSessionId();
    const envelope = createFrameMessage('PLAYBACK_COMMAND', sessionId, { key: 'k' }, 'secret', 'https://child.example');
    assert.equal(isTrustedFrameEnvelope(envelope, {
      eventOrigin: 'https://evil.example',
      fromParent: false,
      fromChild: true,
      activeSessionId: sessionId,
      activeNonce: 'secret'
    }), false);
    assert.equal(isTrustedFrameEnvelope(envelope, {
      eventOrigin: 'https://child.example',
      fromParent: false,
      fromChild: true,
      activeSessionId: sessionId,
      activeNonce: 'other'
    }), false);
    assert.equal(isTrustedFrameEnvelope(envelope, {
      eventOrigin: 'https://child.example',
      fromParent: false,
      fromChild: true,
      activeSessionId: sessionId,
      activeNonce: 'secret'
    }), true);
  });

  it('dual-reads legacy theater-everywhere-* messages', () => {
    const legacy = readFrameEnvelope({ type: 'theater-everywhere-enter' });
    assert.equal(legacy?.type, 'FRAME_ENTER');
    assert.equal(parseLegacyFrameMessage({ type: 'theater-everywhere-exit-down' })?.type, 'FRAME_EXIT');
  });

  it('treats EXIT as idempotent for a matching session', () => {
    const sessionId = createSessionId();
    let theater = true;
    let current: string | null = sessionId;
    const exit = (incoming: string) => {
      if (current && incoming !== current && incoming !== 'legacy') return false;
      theater = false;
      current = null;
      return true;
    };
    assert.equal(exit(sessionId), true);
    assert.equal(theater, false);
    assert.equal(exit(sessionId), true);
  });

  it('keeps parent and child on the same sessionId from FRAME_ENTER', () => {
    const child: FrameNode = {
      origin: 'https://www.youtube-nocookie.com',
      sessionId: createSessionId(),
      nonce: createSessionId(),
      theater: true,
      inbox: []
    };
    const parent: FrameNode = {
      origin: 'https://parent.example',
      sessionId: null,
      nonce: null,
      theater: false,
      inbox: []
    };

    deliver(child, parent, 'FRAME_ENTER');
    const enter = parent.inbox.pop();
    assert.ok(enter);
    assert.equal(accept(parent, enter, false, true), true);
    parent.sessionId = enter.sessionId;
    parent.nonce = enter.nonce;
    parent.theater = true;
    assert.equal(parent.sessionId, child.sessionId);

    deliver(child, parent, 'FRAME_EXIT');
    const childExit = parent.inbox.pop();
    assert.ok(childExit);
    assert.equal(accept(parent, childExit, false, true), true);
    parent.theater = false;
    parent.sessionId = null;
    deliver(parent, child, 'FRAME_EXITED');
    assert.equal(child.inbox[0]?.type, 'FRAME_EXITED');

    parent.theater = true;
    parent.sessionId = child.sessionId;
    parent.nonce = child.nonce;
    deliver(parent, child, 'FRAME_EXIT');
    const parentExit = child.inbox.pop();
    assert.ok(parentExit);
    assert.equal(accept(child, parentExit, true, false), true);
    child.theater = false;

    assert.equal(accept(parent, createFrameMessage('FRAME_EXIT', child.sessionId || '', {}, child.nonce || '', child.origin), false, true), true);
  });

  it('rejects an untrusted source even with a valid envelope', () => {
    const envelope = createFrameMessage('FRAME_EXIT', createSessionId(), {}, 'n', 'https://child.example');
    assert.equal(isTrustedFrameEnvelope(envelope, {
      eventOrigin: envelope.origin,
      fromParent: false,
      fromChild: false,
      activeSessionId: envelope.sessionId,
      activeNonce: envelope.nonce
    }), false);
  });
});

describe('F-08 world fetch envelope', () => {
  it('requires a url payload and ignores a forged schema', () => {
    const message = createWorldMessage('PAGE_FETCH', { url: 'https://www.youtube.com/api/timedtext?v=1' }, 'req-1', 'nonce', 'https://www.youtube.com');
    assert.equal(parseWorldMessage(message)?.type, 'PAGE_FETCH');
    assert.equal(parseWorldMessage({ ...message, payload: { url: 1 } }), null);
    assert.equal(parseWorldMessage({ ...message, type: 'PAGE_FETCH_PWN' }), null);
    assert.equal(parseWorldMessage({ ...message, v: 0 }), null);
  });

  it('dual-reads a legacy same-window fetch postMessage that includes a url', () => {
    const parsed = readWorldEnvelope({
      type: 'theater-everywhere-media-fetch',
      requestId: 7,
      url: 'https://www.youtube.com/api/timedtext?v=1'
    });
    assert.equal(parsed?.type, 'PAGE_FETCH');
    assert.equal(parsed?.payload.url, 'https://www.youtube.com/api/timedtext?v=1');
  });
});
