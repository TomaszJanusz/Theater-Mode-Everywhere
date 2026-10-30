import assert from 'node:assert/strict';
import { it } from 'node:test';

import { encodeTwitchCaptions, parseTwitchCaptions } from './captions';

it('crosses worlds as a string and round-trips a caption request', () => {
  assert.equal(typeof encodeTwitchCaptions({ enabled: true, requestId: 'a' }), 'string');
  assert.equal(parseTwitchCaptions({ enabled: true, requestId: 'a' }), null);
  assert.deepEqual(parseTwitchCaptions(encodeTwitchCaptions({ enabled: false, requestId: 'te-cc-1-x' })), { enabled: false, requestId: 'te-cc-1-x' });
});

it('rejects malformed, oversized and uncorrelated requests and drops unknown fields', () => {
  for (const raw of [undefined, null, 42, true, '', 'not json', '[]', '"text"', 'null', { requestId: 1 }, ['x'],
    '{"enabled":true}', '{"enabled":true,"requestId":""}', '{"enabled":"yes","requestId":"a"}', '{"requestId":"a"}',
    '{"enabled":true,"requestId":7}', JSON.stringify({ enabled: true, requestId: 'x'.repeat(201) })]) {
    assert.equal(parseTwitchCaptions(raw), null, String(raw));
  }
  assert.deepEqual(parseTwitchCaptions('{"enabled":true,"requestId":"a","extra":1}'), { enabled: true, requestId: 'a' });
});
