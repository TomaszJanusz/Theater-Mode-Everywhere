import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { encodeMediaSeekDetail, parseMediaSeekDetail } from './media-seek';

describe('media seek detail', () => {
  it('round-trips every request the isolated world sends', () => {
    for (const detail of [
      { time: 90.5, resumeAfterSeek: true },
      { time: 0, resumeAfterSeek: false },
      { live: true },
      { cancelPendingResume: true }
    ]) {
      assert.deepEqual(parseMediaSeekDetail(encodeMediaSeekDetail(detail)), detail);
    }
  });

  it('crosses worlds as a string, never as an object Firefox hides from page code', () => {
    assert.equal(typeof encodeMediaSeekDetail({ time: 1 }), 'string');
    assert.equal(parseMediaSeekDetail({ time: 1 }), null);
  });

  it('rejects malformed, oversized and non-actionable payloads', () => {
    for (const raw of [
      undefined,
      null,
      42,
      '',
      'not json',
      '[]',
      'null',
      '{}',
      '{"resumeAfterSeek":true}',
      '{"live":false}',
      '{"time":"12"}',
      '{"time":null}',
      '{"time":1,"resumeAfterSeek":"yes"}',
      '{"cancelPendingResume":1}',
      JSON.stringify({ time: 1, pad: 'x'.repeat(300) })
    ]) {
      assert.equal(parseMediaSeekDetail(raw), null, String(raw));
    }
    // JSON has no NaN/Infinity: they serialize to null and are rejected above.
    assert.equal(parseMediaSeekDetail(encodeMediaSeekDetail({ time: Number.NaN })), null);
  });

  it('drops unknown fields instead of forwarding them to host handlers', () => {
    assert.deepEqual(parseMediaSeekDetail('{"time":5,"extra":{"a":1}}'), { time: 5 });
  });
});
