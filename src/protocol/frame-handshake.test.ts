import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createFrameMessage,
  createSessionId,
  isTrustedFrameEnvelope,
  parseFrameMessage,
  readFrameEnvelope
} from './frame-messages';
import { createWorldMessage, parseWorldMessage, readWorldEnvelope } from './world-messages';

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
      trustedOrigin: false,
      fromParent: false,
      fromChild: true,
      activeSessionId: sessionId,
      activeNonce: 'secret'
    }), false);
    assert.equal(isTrustedFrameEnvelope(envelope, {
      eventOrigin: 'https://child.example',
      trustedOrigin: false,
      fromParent: false,
      fromChild: true,
      activeSessionId: sessionId,
      activeNonce: 'other'
    }), false);
    assert.equal(isTrustedFrameEnvelope(envelope, {
      eventOrigin: 'https://child.example',
      trustedOrigin: false,
      fromParent: false,
      fromChild: true,
      activeSessionId: sessionId,
      activeNonce: 'secret'
    }), true);
  });

  it('ignores v0 theater-everywhere-* messages', () => {
    assert.equal(readFrameEnvelope({ type: 'theater-everywhere-enter' }), null);
    assert.equal(readFrameEnvelope({ type: 'theater-everywhere-exit-down' }), null);
  });

  it('rejects playlist navigation without the active theater session', () => {
    const sessionId = createSessionId();
    const nonce = createSessionId();
    for (const type of ['PLAYLIST_NAV_QUERY', 'PLAYLIST_NAV_STATE', 'PLAYLIST_NAV_GO'] as const) {
      const envelope = createFrameMessage(type, sessionId, { direction: 'next' }, nonce, 'https://ads.example');
      assert.equal(isTrustedFrameEnvelope(envelope, {
        eventOrigin: 'https://ads.example',
        trustedOrigin: true,
        fromParent: false,
        fromChild: true,
        activeSessionId: null,
        activeNonce: null
      }), false);
      assert.equal(isTrustedFrameEnvelope(envelope, {
        eventOrigin: 'https://ads.example',
        trustedOrigin: true,
        fromParent: false,
        fromChild: true,
        activeSessionId: sessionId,
        activeNonce: nonce
      }), true);
    }
  });

  it('rejects child FRAME_TOGGLE without the active session', () => {
    const sessionId = createSessionId();
    const nonce = createSessionId();
    const messages = [
      createFrameMessage('FRAME_TOGGLE', sessionId, {}, nonce, 'https://ads.example'),
      createFrameMessage('FRAME_FULLSCREEN', sessionId, {}, nonce, 'https://ads.example')
    ];
    for (const message of messages) {
      assert.equal(isTrustedFrameEnvelope(message, {
        eventOrigin: 'https://ads.example',
        trustedOrigin: false,
        fromParent: false,
        fromChild: true,
        activeSessionId: null,
        activeNonce: null
      }), false);
      assert.equal(isTrustedFrameEnvelope(message, {
        eventOrigin: 'https://ads.example',
        trustedOrigin: false,
        fromParent: false,
        fromChild: true,
        activeSessionId: sessionId,
        activeNonce: nonce
      }), true);
      assert.equal(isTrustedFrameEnvelope(message, {
        eventOrigin: 'https://ads.example',
        trustedOrigin: false,
        fromParent: true,
        fromChild: false,
        activeSessionId: null,
        activeNonce: null
      }), false);
      assert.equal(isTrustedFrameEnvelope(message, {
        eventOrigin: 'https://ads.example',
        trustedOrigin: true,
        fromParent: true,
        fromChild: false,
        activeSessionId: null,
        activeNonce: null
      }), true);
      assert.equal(isTrustedFrameEnvelope(message, {
        eventOrigin: 'https://ads.example',
        trustedOrigin: false,
        fromParent: true,
        fromChild: false,
        activeSessionId: sessionId,
        activeNonce: nonce
      }), true);
    }
  });

  it('never accepts FRAME_HOST_TOGGLE through the ordinary frame policy', () => {
    const sessionId = createSessionId();
    const nonce = createSessionId();
    const message = createFrameMessage(
      'FRAME_HOST_TOGGLE',
      sessionId,
      { action: 'toggle' },
      nonce,
      'https://vm.gtimg.cn'
    );
    assert.equal(parseFrameMessage(message)?.type, 'FRAME_HOST_TOGGLE');
    assert.equal(parseFrameMessage({ ...message, sessionId: '' }), null);
    assert.equal(parseFrameMessage({ ...message, requestId: '' }), null);
    assert.equal(parseFrameMessage({ ...message, origin: '' }), null);
    assert.equal(parseFrameMessage({ ...message, nonce: '' }), null);
    assert.equal(isTrustedFrameEnvelope(message, {
      eventOrigin: 'https://vm.gtimg.cn',
      trustedOrigin: true,
      fromParent: false,
      fromChild: true,
      activeSessionId: sessionId,
      activeNonce: nonce
    }), false);
    const enter = createFrameMessage('FRAME_ENTER', sessionId, {}, nonce, 'https://vm.gtimg.cn');
    assert.equal(isTrustedFrameEnvelope(enter, {
      eventOrigin: 'https://vm.gtimg.cn',
      trustedOrigin: false,
      fromParent: false,
      fromChild: false,
      activeSessionId: null,
      activeNonce: null
    }), false);
  });

  it('rejects unauthenticated FRAME_ENTER without a trusted origin policy', () => {
    const enter = createFrameMessage(
      'FRAME_ENTER',
      createSessionId(),
      {},
      createSessionId(),
      'https://child.example'
    );
    assert.equal(isTrustedFrameEnvelope(enter, {
      eventOrigin: 'https://child.example',
      trustedOrigin: false,
      fromParent: false,
      fromChild: true,
      activeSessionId: null,
      activeNonce: null
    }), false);
    assert.equal(isTrustedFrameEnvelope(enter, {
      eventOrigin: 'https://child.example',
      trustedOrigin: true,
      fromParent: false,
      fromChild: true,
      activeSessionId: null,
      activeNonce: null
    }), true);
    assert.equal(isTrustedFrameEnvelope(enter, {
      eventOrigin: 'https://child.example',
      trustedOrigin: false,
      fromParent: false,
      fromChild: true,
      activeSessionId: enter.sessionId,
      activeNonce: enter.nonce
    }), true);
  });

  it('accepts exits only from a known frame and the matching active session, including repeated idle exits', () => {
    for (const type of ['FRAME_EXIT', 'FRAME_EXITED'] as const) {
      const envelope = createFrameMessage(type, createSessionId(), {}, 'n', 'https://child.example');
      for (const source of [
        { fromParent: true, fromChild: false },
        { fromParent: false, fromChild: true },
        { fromParent: false, fromChild: false }
      ]) {
        for (const [activeSessionId, sessionAccepted] of [
          [envelope.sessionId, true],
          ['another-session', false],
          [null, true]
        ] as const) {
          assert.equal(isTrustedFrameEnvelope(envelope, {
            eventOrigin: envelope.origin,
            trustedOrigin: false,
            ...source,
            activeSessionId,
            activeNonce: 'different-nonce'
          }), (source.fromParent || source.fromChild) && sessionAccepted,
          `${type}: source=${JSON.stringify(source)}, activeSessionId=${activeSessionId}`);
        }
      }
    }
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

  it('ignores a v0 same-window fetch postMessage', () => {
    assert.equal(readWorldEnvelope({
      type: 'theater-everywhere-media-fetch',
      requestId: 7,
      url: 'https://www.youtube.com/api/timedtext?v=1'
    }), null);
  });
});
