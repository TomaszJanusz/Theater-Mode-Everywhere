import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_CAPTION_BYTES } from '../../platform/media-url-policy';
import { createTimedtextCacheRecord } from '../../media-features/youtube-caption-url';
import {
  createTimedtextBodyCache,
  MAX_TIMEDTEXT_STRING_LENGTH,
  TIMEDTEXT_CACHE_STRING_BUDGET
} from './timedtext-cache';

const WORDS_PER_MINUTE = 150;
const WORDS_PER_EVENT = 6;
const LONG_MINUTES = 120;
const WORDS_EN = ['the', 'people', 'video', 'about', 'there', 'which', 'would', 'could', 'other', 'after', 'first', 'because', 'these', 'world', 'before'];
const WORDS_PL = ['cześć', 'łódź', 'gęślą', 'zażółć', 'jaźń', 'słońce', 'mózg', 'źródło', 'wciąż', 'pięć'];

/** Same json3 shape as the caption parser fixture, expanded to a full track. */
function json3Track(minutes: number, words: string[]): string {
  const list: string[] = [];
  const count = WORDS_PER_MINUTE * minutes;
  for (let i = 0; i < count; i++) list.push(words[i % words.length]);
  const events = [];
  for (let i = 0; i < list.length; i += WORDS_PER_EVENT) {
    const slice = list.slice(i, i + WORDS_PER_EVENT);
    events.push({
      tStartMs: (i / WORDS_PER_EVENT) * 2400,
      dDurationMs: 2400,
      segs: slice.map((word, index) => (
        index === 0 ? { utf8: `${word} ` } : { tOffsetMs: index * 400, utf8: `${word} ` }
      ))
    });
  }
  return JSON.stringify({
    wireMagic: 'pb3',
    pens: [{}],
    wsWinStyles: [{}],
    wpWinPositions: [{}],
    events
  });
}

function trackUrl(videoId: string, lang: string, fmt = 'json3', extra = ''): string {
  return `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=${fmt}${extra}`;
}

function putTrack(
  cache: ReturnType<typeof createTimedtextBodyCache>,
  videoId: string,
  lang: string,
  body: string,
  fmt = 'json3',
  extra = ''
): void {
  const record = createTimedtextCacheRecord(trackUrl(videoId, lang, fmt, extra), body);
  assert.ok(record);
  cache.put(record);
}

describe('timedtext body cache', () => {
  it('sizes the code-unit budget from a measured 120-minute json3 track', () => {
    const english = json3Track(LONG_MINUTES, WORDS_EN);
    const polish = json3Track(10, WORDS_PL);
    assert.equal(english.length, 722_016);
    assert.equal(Buffer.byteLength(english), english.length);
    assert.equal(TIMEDTEXT_CACHE_STRING_BUDGET, english.length * 4);
    assert.ok(polish.length < Buffer.byteLength(polish));
    assert.equal(MAX_TIMEDTEXT_STRING_LENGTH, 2_097_152);
    assert.equal(MAX_CAPTION_BYTES, 2_097_152);
    const polishAtByteCap = 'ł'.repeat(MAX_CAPTION_BYTES / 2);
    assert.equal(Buffer.byteLength(polishAtByteCap), MAX_CAPTION_BYTES);
    assert.ok(polishAtByteCap.length < MAX_TIMEDTEXT_STRING_LENGTH);
  });

  it('dedupes one track across pot refreshes and keeps distinct formats', () => {
    const cache = createTimedtextBodyCache();
    const body = '{"events":[{"segs":[{"utf8":"Hello"}]}]}';
    putTrack(cache, 'abc', 'en', body, 'json3', '&pot=ONE');
    putTrack(cache, 'abc', 'en', body, 'json3', '&pot=TWO');
    assert.equal(cache.trackCount(), 1);
    assert.equal(cache.retainedStringLength(), body.length);
    assert.equal(cache.records()[0]?.url.includes('pot=TWO'), true);
    putTrack(cache, 'abc', 'en', body, 'vtt');
    assert.equal(cache.trackCount(), 2);
    assert.equal(cache.find(trackUrl('abc', 'pl')), null);
    assert.equal(cache.find(trackUrl('other', 'en')), null);
    assert.equal(cache.find(trackUrl('abc', 'en', 'json3')), body);
  });

  it('keeps the active track and a previous video, then drops stale videos to stay inside the budget', () => {
    const cache = createTimedtextBodyCache();
    const bodyFor = (index: number) => `${String(index).padStart(6, '0')}${'a'.repeat(722_016 - 6)}`;
    for (let index = 0; index < 20; index++) {
      const videoId = `v${index}`;
      cache.notePageVideo(videoId);
      putTrack(cache, videoId, 'en', bodyFor(index));
      assert.equal(cache.find(trackUrl(videoId, 'en'))?.startsWith(String(index).padStart(6, '0')), true);
      assert.ok(cache.retainedStringLength() <= TIMEDTEXT_CACHE_STRING_BUDGET);
    }
    assert.equal(cache.retainedStringLength(), TIMEDTEXT_CACHE_STRING_BUDGET);
    assert.equal(cache.trackCount(), 4);
    assert.equal(cache.find(trackUrl('v0', 'en')), null);
    assert.equal(cache.find(trackUrl('v19', 'en'))?.startsWith('000019'), true);
    assert.equal(cache.find(trackUrl('v18', 'en'))?.startsWith('000018'), true);
    assert.equal(cache.find(trackUrl('v19', 'pl')), null);
  });

  it('drops the previous video before the active language when the current video fills the budget', () => {
    const cache = createTimedtextBodyCache();
    const body = 'b'.repeat(722_016);
    cache.notePageVideo('previous');
    putTrack(cache, 'previous', 'en', body);
    cache.find(trackUrl('previous', 'en'));
    cache.notePageVideo('current');
    putTrack(cache, 'current', 'en', body);
    cache.find(trackUrl('current', 'en'));
    for (const lang of ['pl', 'de', 'fr', 'es']) {
      putTrack(cache, 'current', lang, body);
      assert.ok(cache.retainedStringLength() <= TIMEDTEXT_CACHE_STRING_BUDGET);
    }
    assert.equal(cache.find(trackUrl('previous', 'en')), null);
    assert.equal(cache.find(trackUrl('current', 'en')), body);
    assert.equal(cache.find(trackUrl('current', 'ar')), null);
  });

  it('rejects an empty or over-cap string without evicting the active track', () => {
    const cache = createTimedtextBodyCache();
    const active = 'c'.repeat(1000);
    cache.notePageVideo('keep');
    putTrack(cache, 'keep', 'en', active);
    cache.find(trackUrl('keep', 'en'));
    const empty = createTimedtextCacheRecord(trackUrl('keep', 'pl'), '');
    assert.ok(empty);
    assert.equal(cache.put(empty), 'rejected');
    const over = createTimedtextCacheRecord(trackUrl('other', 'en'), 'd'.repeat(MAX_TIMEDTEXT_STRING_LENGTH + 1));
    assert.ok(over);
    assert.equal(cache.put(over), 'rejected');
    assert.equal(cache.retainedStringLength(), active.length);
    assert.equal(cache.find(trackUrl('keep', 'en')), active);
  });
});
