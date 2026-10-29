import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  encodeProbeRequest,
  encodeProbeAsyncReply,
  encodeProbeAsyncRequest,
  encodeTwitchCaptions,
  encodeYoutubeCaptions,
  parseProbeRequest,
  parseProbeAsyncReply,
  parseProbeAsyncRequest,
  parseTwitchCaptions,
  parseYoutubeCaptions
} from './page-requests';

const HOSTILE = [undefined, null, 42, true, '', 'not json', '[]', '"text"', 'null', { requestId: 1 }, ['x']];

describe('page request details', () => {
  it('cross worlds as strings, never as objects Firefox hides from page code', () => {
    assert.equal(typeof encodeProbeRequest(1), 'string');
    assert.equal(typeof encodeTwitchCaptions({ enabled: true, requestId: 'a' }), 'string');
    assert.equal(typeof encodeYoutubeCaptions({ enabled: false, requestId: 1 }), 'string');
    assert.equal(parseProbeRequest({ requestId: 1 }), null);
    assert.equal(parseTwitchCaptions({ enabled: true, requestId: 'a' }), null);
    assert.equal(parseYoutubeCaptions({ enabled: false, requestId: 1 }), null);
  });

  it('round-trips a media probe request id', () => {
    assert.equal(parseProbeRequest(encodeProbeRequest(7)), 7);
  });

  it('round-trips a provider probe request and its reply', () => {
    assert.deepEqual(parseProbeAsyncRequest(encodeProbeAsyncRequest({ requestId: 2, provider: 'bilibiliIntl' })), { requestId: 2, provider: 'bilibiliIntl' });
    const request = { requestId: 2, provider: 'bilibili' };
    assert.deepEqual(parseProbeAsyncReply(encodeProbeAsyncReply({ ...request, value: { videoId: 'BV1' } }), request), { value: { videoId: 'BV1' } });
    assert.deepEqual(parseProbeAsyncReply(encodeProbeAsyncReply({ ...request, value: undefined }), request), { value: null });
    assert.equal(parseProbeAsyncReply(encodeProbeAsyncReply({ requestId: 3, provider: 'bilibili', value: 1 }), request), null);
    assert.equal(parseProbeAsyncReply(encodeProbeAsyncReply({ requestId: 2, provider: 'bilibiliIntl', value: 1 }), request), null);
  });

  it('rejects provider probe messages without a correlatable id or provider', () => {
    for (const raw of [...HOSTILE, '{"requestId":1}', '{"requestId":1,"provider":"a.b"}', '{"requestId":0,"provider":"x"}', '{"requestId":1.5,"provider":"x"}']) {
      assert.equal(parseProbeAsyncRequest(raw), null, String(raw));
      assert.equal(parseProbeAsyncReply(raw, { requestId: 1, provider: 'x' }), null, String(raw));
    }
    assert.equal(parseProbeAsyncReply('{"requestId":1,"provider":"x"}', { requestId: 1, provider: 'x' }), null, 'a reply names its value, even null');
    assert.equal(encodeProbeAsyncReply({ requestId: 1, provider: 'x', value: 10n }), null);
    assert.equal(encodeProbeAsyncReply({ requestId: 1, provider: 'x', value: 'x'.repeat(1024 * 1024) }), null);
  });

  it('round-trips Twitch and YouTube caption requests', () => {
    assert.deepEqual(parseTwitchCaptions(encodeTwitchCaptions({ enabled: false, requestId: 'te-cc-1-x' })), { enabled: false, requestId: 'te-cc-1-x' });
    for (const request of [
      { requestId: 3, enabled: false },
      { requestId: 4, enabled: true, language: 'pl', kind: null },
      { requestId: 5, enabled: true, language: 'en', kind: 'asr', translation: 'de' }
    ]) {
      assert.deepEqual(parseYoutubeCaptions(encodeYoutubeCaptions(request)), request);
    }
  });

  it('rejects malformed, oversized and uncorrelated requests', () => {
    for (const raw of HOSTILE) {
      assert.equal(parseProbeRequest(raw), null);
      assert.equal(parseTwitchCaptions(raw), null);
      assert.equal(parseYoutubeCaptions(raw), null);
    }
    for (const raw of ['{}', '{"requestId":0}', '{"requestId":-1}', '{"requestId":1.5}', '{"requestId":"1"}', `{"requestId":${Number.MAX_SAFE_INTEGER + 2}}`]) {
      assert.equal(parseProbeRequest(raw), null, raw);
    }
    for (const raw of ['{"enabled":true}', '{"enabled":true,"requestId":""}', '{"enabled":"yes","requestId":"a"}', '{"requestId":"a"}', '{"enabled":true,"requestId":7}', JSON.stringify({ enabled: true, requestId: 'x'.repeat(201) })]) {
      assert.equal(parseTwitchCaptions(raw), null, raw);
    }
    for (const raw of ['{"enabled":true}', '{"enabled":true,"requestId":"1"}', '{"enabled":1,"requestId":1}', '{"requestId":1}',
      '{"enabled":true,"requestId":1,"language":7}', '{"enabled":true,"requestId":1,"kind":false}', '{"enabled":true,"requestId":1,"translation":""}',
      JSON.stringify({ enabled: true, requestId: 1, language: 'x'.repeat(201) }), JSON.stringify({ enabled: true, requestId: 1, pad: 'x'.repeat(1000) })]) {
      assert.equal(parseYoutubeCaptions(raw), null, raw);
    }
  });

  it('drops fields it does not know', () => {
    assert.equal(parseProbeRequest('{"requestId":2,"extra":{"a":1}}'), 2);
    assert.deepEqual(parseTwitchCaptions('{"enabled":true,"requestId":"a","extra":1}'), { enabled: true, requestId: 'a' });
    assert.deepEqual(parseYoutubeCaptions('{"enabled":false,"requestId":2,"__proto__":{"x":1},"extra":[]}'), { enabled: false, requestId: 2 });
  });
});
