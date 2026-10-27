import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseYouTubeAudio,
  parseYouTubeAudioSelect,
  parseYoutubeXtags,
  youtubeAudioTrack,
  youtubeAudioTrackKey,
  type YouTubeAudioRecord
} from './youtube-audio-tracks';

// Track ids and language ids as the player reported them on 0e3GPea1Tyg (player 6b2fce74, 2026-10-27).
const ORIGINAL = '251;ChEKBWFjb250EghvcmlnaW5hbAoICgNkcmMSATEKDQoEbGFuZxIFZW4tVVM';
const FRENCH = '251;Cg8KBWFjb250EgZkdWJiZWQKCgoEbGFuZxICZnI';
const SIMPLIFIED = '251;Cg8KBWFjb250EgZkdWJiZWQKDwoEbGFuZxIHemgtSGFucw';
const record = (id: string, label: string, languageId: string, extra: Partial<YouTubeAudioRecord> = {}): YouTubeAudioRecord =>
  ({ id, label, languageId, autoDubbed: false, selected: false, ...extra });

describe('YouTube audio track records', () => {
  it('decodes xtags into content kind and BCP-47 language', () => {
    assert.deepEqual([...parseYoutubeXtags(ORIGINAL.split(';')[1])], [['acont', 'original'], ['drc', '1'], ['lang', 'en-US']]);
    assert.deepEqual(youtubeAudioTrack(record(ORIGINAL, 'English (US) original', 'en-US.4', { selected: true })),
      { id: ORIGINAL.split(';')[1], languageTag: 'en-US', label: 'English (US) original', kind: 'original', selected: true });
    assert.deepEqual(youtubeAudioTrack(record(SIMPLIFIED, 'Chinese (Simplified)', 'zh-Hans.3')),
      { id: SIMPLIFIED.split(';')[1], languageTag: 'zh-Hans', label: 'Chinese (Simplified)', kind: 'dub', selected: false });
  });

  it('keeps the track id across the stream that carries it', () => {
    assert.equal(youtubeAudioTrackKey(record(FRENCH, '', 'fr.3')), youtubeAudioTrackKey(record(FRENCH.replace('251;', '140;'), '', 'fr.3')));
  });

  it('falls back to the language info, then to unknown, when xtags are missing or not understood', () => {
    assert.deepEqual(youtubeAudioTrack(record('140', 'Deutsch', 'de.3')), { id: 'de.3', languageTag: 'de', label: 'Deutsch', kind: 'unknown', selected: false });
    assert.equal(youtubeAudioTrack(record('140', 'Deutsch', 'de.10', { autoDubbed: true })).kind, 'dub');
    assert.equal(youtubeAudioTrack(record('140;%%%', 'Default', 'und')).languageTag, '');
    assert.deepEqual([...parseYoutubeXtags('CAE')], [], 'a varint field means the format changed');
  });

  it('accepts a snapshot only for its request and page, with bounded fields', () => {
    const snapshot = { requestId: 'r:1', pageHref: 'https://www.youtube.com/watch?v=0e3GPea1Tyg', videoId: '0e3GPea1Tyg', ad: false, tracks: [record(FRENCH, 'French', 'fr.3')] };
    const text = JSON.stringify(snapshot);
    assert.deepEqual(parseYouTubeAudio(text, 'r:1', snapshot.pageHref), snapshot);
    assert.equal(parseYouTubeAudio(text, 'r:2', snapshot.pageHref), null);
    assert.equal(parseYouTubeAudio(text, 'r:1', 'https://www.youtube.com/watch?v=other000000'), null);
    assert.equal(parseYouTubeAudio(JSON.stringify({ ...snapshot, tracks: [{ ...snapshot.tracks[0], label: 'x'.repeat(201) }] }), 'r:1', snapshot.pageHref), null);
    assert.equal(parseYouTubeAudio(JSON.stringify({ ...snapshot, videoId: 'short' }), 'r:1', snapshot.pageHref), null);
  });

  it('MAIN accepts only well-formed selection requests', () => {
    assert.deepEqual(parseYouTubeAudioSelect(JSON.stringify({ requestId: 'r:1', videoId: '0e3GPea1Tyg', trackId: 'abc', extra: 1 })),
      { requestId: 'r:1', videoId: '0e3GPea1Tyg', trackId: 'abc' });
    for (const raw of [null, {}, '{', JSON.stringify({ requestId: 'r 1', videoId: '0e3GPea1Tyg', trackId: 'a' }),
      JSON.stringify({ requestId: 'r:1', videoId: '0e3GPea1Tyg', trackId: '' })]) {
      assert.equal(parseYouTubeAudioSelect(raw), null, String(raw));
    }
  });
});
