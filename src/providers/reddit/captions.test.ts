import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { parseCaptionPayload } from '../../media-features/parsers/captions';
import { PROVIDER_CATALOG } from '../catalog';
import { matchesMediaFetchRules } from '../media-fetch-rules';

import { mergeRedditCues, redditCaptionFile } from './captions';

/** The first cues of a post's caption file as Reddit served it (test/host-fixtures/reddit-post-player.json). */
const RECORDED = readFileSync(new URL('../../../test/host-fixtures/reddit-post-captions.vtt', import.meta.url), 'utf8');
const rules = PROVIDER_CATALOG.find(item => item.id === 'reddit')?.mediaFetch ?? [];

describe('Reddit caption files', () => {
  it('takes the language from the file name and accepts only WebVTT on v.redd.it', () => {
    assert.deepEqual(redditCaptionFile('https://v.redd.it/eis4xl66bv2i1/wh_ben_en.vtt'), { url: 'https://v.redd.it/eis4xl66bv2i1/wh_ben_en.vtt', language: 'en' });
    assert.equal(redditCaptionFile('https://v.redd.it/ejqjhemhyokh1/advertiser_en.vtt')?.language, 'en');
    assert.equal(redditCaptionFile('https://v.redd.it/ejqjhemhyokh1/captions.vtt')?.language, '');
    for (const value of [null, '', 'not a url', 'http://v.redd.it/abc123/wh_ben_en.vtt', 'https://evil.test/abc123/wh_ben_en.vtt',
      'https://v.redd.it.evil.test/abc123/wh_ben_en.vtt', 'https://user@v.redd.it/abc123/wh_ben_en.vtt', 'https://v.redd.it:8443/abc123/wh_ben_en.vtt',
      'https://v.redd.it/abc123/HLSPlaylist.m3u8', 'https://v.redd.it/abc123/wh_ben_en/index.m3u8', 'https://v.redd.it/a/b/c.vtt']) {
      assert.equal(redditCaptionFile(value), null, String(value));
    }
  });

  it('asks only for files the descriptor admits to the page fetch and the broker', () => {
    for (const url of ['https://v.redd.it/eis4xl66bv2i1/wh_ben_en.vtt', 'https://v.redd.it/ejqjhemhyokh1/advertiser_en.vtt']) {
      assert.ok(redditCaptionFile(url));
      assert.equal(matchesMediaFetchRules(rules, { kind: 'caption-track', url }), true, url);
    }
    assert.equal(matchesMediaFetchRules(rules, { kind: 'caption-track', url: 'https://v.redd.it/eis4xl66bv2i1/HLS_720.mp4' }), false);
    assert.equal(matchesMediaFetchRules(rules, { kind: 'storyboard-vtt', url: 'https://v.redd.it/eis4xl66bv2i1/wh_ben_en.vtt' }), false);
  });
});

describe('Reddit word-timed captions', () => {
  it('folds the per-word cues of the recorded file into one cue per line', () => {
    const parsed = parseCaptionPayload(RECORDED, 'text/vtt');
    assert.equal(parsed.length, 49, 'the shared parser keeps every word cue');
    assert.ok(parsed.every(cue => !cue.text.includes('<u>')), 'the emphasis on the spoken word is dropped');
    const lines = mergeRedditCues(parsed);
    assert.deepEqual(lines.slice(0, 2), [
      { start: 1.46, end: 2.86, text: 'amet' },
      { start: 16.22, end: 19.38, text: 'sed sit. sed sit eiusmod ut. sed sit\neiusmod elit amet.' }
    ]);
    assert.equal(lines.length, 4);
    for (let index = 1; index < lines.length; index += 1) assert.notEqual(lines[index].text, lines[index - 1].text);
  });

  it('keeps a repeated line apart when time passes between its cues', () => {
    const lines = mergeRedditCues([
      { start: 0, end: 1, text: 'again' },
      { start: 1, end: 2, text: 'again' },
      { start: 5, end: 6, text: 'again' }
    ]);
    assert.deepEqual(lines, [{ start: 0, end: 2, text: 'again' }, { start: 5, end: 6, text: 'again' }]);
  });
});
