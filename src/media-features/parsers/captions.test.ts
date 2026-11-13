import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import type { CaptionCue } from '../types';

import { parseCaptionPayload } from './captions';

/** Two real tracks of one YouTube video (sanitized json3, around 1:28): auto-generated and a broadcast's CC1. */
const recorded = JSON.parse(readFileSync(new URL('../../../test/fixtures/youtube-timedtext-broadcast-captions.json', import.meta.url), 'utf8')) as {
  tracks: Record<'asr' | 'cc1', { body: unknown }>;
};
const track = (name: 'asr' | 'cc1') => parseCaptionPayload(JSON.stringify(recorded.tracks[name].body));

/** Each word as `text`, `+text` when it continues the previous word without a space. */
const shape = (cue: CaptionCue | undefined) => cue?.words?.map((word) => `${word.joinsPrevious ? '+' : ''}${word.text}`);

/** The line the words make: a space only where `joinsPrevious` does not join them. */
const spoken = (cue: CaptionCue) => (cue.words || [])
  .map((word, index) => (index === 0 || word.joinsPrevious ? word.text : ` ${word.text}`)).join('');

function json3(segs: Array<{ utf8?: string; tOffsetMs?: number }>): CaptionCue | undefined {
  return parseCaptionPayload(JSON.stringify({ events: [{ tStartMs: 1000, dDurationMs: 3000, segs }] }))[0];
}

describe('caption word pieces', () => {
  it('joins the two-character pieces of a broadcast CC1 track into its words', () => {
    const cues = track('cc1');
    const line = cues.find((cue) => cue.text === "CERTAINLY HERE. BUT IT WASN'T");
    assert.deepEqual(shape(line), [
      'CE', '+RT', '+AI', '+NL', '+Y', 'H', '+ER', '+E.', 'B', '+UT', 'I', '+T', 'W', '+AS', "+N'", '+T'
    ]);
    // Every piece keeps its own time, so the highlight still moves through a word.
    assert.deepEqual(line?.words?.slice(0, 2).map((word) => word.start), [85.251, 85.284]);
    // A piece ending in a space ("N ", "E ") ends its word.
    assert.deepEqual(shape(cues.find((cue) => cue.text === 'JUST HERE IN THE FIRST DISTRICT')), [
      'JU', '+ST', 'H', '+ER', '+E', 'I', '+N', 'TH', '+E', 'F', '+IR', '+ST', 'D', '+IS', '+TR', '+IC', '+T'
    ]);
    assert.ok(cues.length > 0);
    // The track is upper case at the source, as YouTube shows it; only the spacing changes.
    for (const cue of cues) assert.equal(spoken(cue), cue.text);
  });

  it('keeps every auto-generated word separate, as its pieces start with a space', () => {
    const cues = track('asr');
    assert.deepEqual(shape(cues.find((cue) => cue.text.startsWith('materialize'))), ['materialize', 'certainly', 'here,', 'but', 'it']);
    assert.ok(cues.every((cue) => cue.words?.every((word) => !word.joinsPrevious)));
    for (const cue of cues) assert.equal(spoken(cue), cue.text);
  });

  it('joins single characters and punctuation, and starts a word after a leading space', () => {
    const cue = json3([
      { utf8: 'A' }, { utf8: 'B', tOffsetMs: 100 }, { utf8: ',', tOffsetMs: 200 },
      { utf8: ' C', tOffsetMs: 300 }, { utf8: '!', tOffsetMs: 400 }, { utf8: ' ', tOffsetMs: 500 }, { utf8: '?', tOffsetMs: 600 }
    ]);
    assert.deepEqual(shape(cue), ['A', '+B', '+,', 'C', '+!', '?']);
    assert.equal(cue?.text, 'AB, C! ?');
  });

  it('places pieces without an offset at the event start and keeps their spacing', () => {
    const cue = json3([{ utf8: 'one' }, { utf8: ' two' }, { utf8: 'three', tOffsetMs: 800 }]);
    assert.deepEqual(shape(cue), ['one', 'two', '+three']);
    assert.deepEqual(cue?.words?.map((word) => word.start), [1, 1, 1.8]);
    // All pieces at one time are no word timing.
    assert.equal(json3([{ utf8: 'one' }, { utf8: ' two' }])?.words, undefined);
  });

  it('adds no space to scripts written without one and keeps right-to-left words apart', () => {
    const japanese = json3([{ utf8: '今日' }, { utf8: 'は', tOffsetMs: 300 }, { utf8: '晴れ', tOffsetMs: 600 }]);
    assert.deepEqual(shape(japanese), ['今日', '+は', '+晴れ']);
    assert.equal(japanese && spoken(japanese), '今日は晴れ');
    const arabic = json3([{ utf8: 'مرحبا' }, { utf8: ' بكم', tOffsetMs: 400 }]);
    assert.deepEqual(shape(arabic), ['مرحبا', 'بكم']);
    assert.equal(arabic?.text, 'مرحبا بكم');
  });

  it('treats a line break between pieces as a space', () => {
    assert.deepEqual(shape(json3([{ utf8: 'end' }, { utf8: '\n', tOffsetMs: 100 }, { utf8: 'next', tOffsetMs: 300 }])), ['end', 'next']);
  });

  it('keeps a space that lies between srv3 spans', () => {
    const [cue] = parseCaptionPayload('<timedtext format="3"><body><p t="1000" d="3000"><s>Hello</s> <s t="500">world</s></p></body></timedtext>');
    assert.equal(cue?.text, 'Hello world');
    assert.deepEqual(shape(cue), ['Hello', 'world']);
  });

  it('separates words where markup or an entity shows a space', () => {
    assert.deepEqual(shape(json3([{ utf8: 'Hello<br>' }, { utf8: 'world', tOffsetMs: 500 }])), ['Hello', 'world']);
    assert.deepEqual(shape(json3([{ utf8: 'Hello' }, { utf8: '<br/>world', tOffsetMs: 500 }])), ['Hello', 'world']);
    assert.deepEqual(shape(json3([{ utf8: 'Hello&nbsp;' }, { utf8: 'world', tOffsetMs: 500 }])), ['Hello', 'world']);
    assert.deepEqual(shape(json3([{ utf8: 'Hello' }, { utf8: '&#32;world', tOffsetMs: 500 }])), ['Hello', 'world']);
    const [srv3] = parseCaptionPayload('<timedtext format="3"><body><p t="1000" d="3000"><s>Hello&#32;</s><s t="500">world</s></p></body></timedtext>');
    assert.deepEqual(shape(srv3), ['Hello', 'world']);
    // An entity that is not a space still joins, as the shown text has no space there.
    assert.deepEqual(shape(json3([{ utf8: 'R&amp;' }, { utf8: 'D', tOffsetMs: 500 }])), ['R&', '+D']);
  });

  it('reads srv3 spans the same way', () => {
    const [cue] = parseCaptionPayload('<timedtext format="3"><body><p t="1000" d="3000"><s>CE</s><s t="33">RT</s><s t="300"> H</s><s t="333">E.</s></p></body></timedtext>');
    assert.deepEqual(shape(cue), ['CE', '+RT', 'H', '+E.']);
    assert.equal(cue && spoken(cue), cue?.text);
  });
});
