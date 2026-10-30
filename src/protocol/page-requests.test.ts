import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  encodeProbeRequest,
  encodeYoutubeCaptions,
  parseProbeRequest,
  parseYoutubeCaptions
} from './page-requests';

const HOSTILE = [undefined, null, 42, true, '', 'not json', '[]', '"text"', 'null', { requestId: 1 }, ['x']];

describe('page request details', () => {
  it('cross worlds as strings, never as objects Firefox hides from page code', () => {
    assert.equal(typeof encodeProbeRequest(1), 'string');
    assert.equal(typeof encodeYoutubeCaptions({ enabled: false, requestId: 1 }), 'string');
    assert.equal(parseProbeRequest({ requestId: 1 }), null);
    assert.equal(parseYoutubeCaptions({ enabled: false, requestId: 1 }), null);
  });

  it('round-trips a media probe request id', () => {
    assert.equal(parseProbeRequest(encodeProbeRequest(7)), 7);
  });

  it('round-trips YouTube caption requests', () => {
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
      assert.equal(parseYoutubeCaptions(raw), null);
    }
    for (const raw of ['{}', '{"requestId":0}', '{"requestId":-1}', '{"requestId":1.5}', '{"requestId":"1"}', `{"requestId":${Number.MAX_SAFE_INTEGER + 2}}`]) {
      assert.equal(parseProbeRequest(raw), null, raw);
    }
    for (const raw of ['{"enabled":true}', '{"enabled":true,"requestId":"1"}', '{"enabled":1,"requestId":1}', '{"requestId":1}',
      '{"enabled":true,"requestId":1,"language":7}', '{"enabled":true,"requestId":1,"kind":false}', '{"enabled":true,"requestId":1,"translation":""}',
      JSON.stringify({ enabled: true, requestId: 1, language: 'x'.repeat(201) }), JSON.stringify({ enabled: true, requestId: 1, pad: 'x'.repeat(1000) })]) {
      assert.equal(parseYoutubeCaptions(raw), null, raw);
    }
  });

  it('drops fields it does not know', () => {
    assert.equal(parseProbeRequest('{"requestId":2,"extra":{"a":1}}'), 2);
    assert.deepEqual(parseYoutubeCaptions('{"enabled":false,"requestId":2,"__proto__":{"x":1},"extra":[]}'), { enabled: false, requestId: 2 });
  });
});
