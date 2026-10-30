import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { audioPreferenceForTrack, pickPreferredAudioTrack } from '../../media-features/audio-preference';

import { netflixAudioTrack, parseAudioAck, parseAudioQuery, parseAudioSelect, parseAudioSnapshot, type AudioRequest, type AudioSelect } from './audio-bridge';
import { readNetflixAudio } from './audio-main';

const request: AudioRequest = { requestId: 'r:1', clientId: 'client:1', pageHref: 'https://www.netflix.com/watch/123', mediaId: '123' };
const select: AudioSelect = { ...request, bindingId: 'binding:1', trackId: 'A:2:1;2;pl;0;0;0;' };
const original = { trackId: 'A:en', bcp47: 'en_US', displayName: 'English [original]', trackType: 'PRIMARY', isNative: true };
const ad = { ...original, trackId: 'A:ad', displayName: 'English — Audio Description', trackType: 'ASSISTIVE' };
const plain = { ...original, trackId: 'A:dub', isNative: false };
const track = netflixAudioTrack(original, original)!;
const list = { mediaId: '123', tracks: [track], blocked: false };
const snapshot = { ...request, bindingId: 'binding:1', list };

describe('Netflix public audio records', () => {
  it('keeps host IDs and labels, uses native for original and gives AD precedence', () => {
    assert.deepEqual(track, { id: 'A:en', languageTag: 'en-US', label: original.displayName, kind: 'original', selected: true });
    assert.equal(netflixAudioTrack(original, { ...original })?.selected, false, 'selection is host object identity');
    assert.equal(netflixAudioTrack(ad, null)?.kind, 'description');
    assert.equal(audioPreferenceForTrack(netflixAudioTrack(ad, null)!), null);
    assert.equal(netflixAudioTrack(plain, null)?.kind, 'dub');
    assert.equal(netflixAudioTrack({ ...plain, trackType: 'NEW' }, null)?.kind, 'unknown');
    assert.equal(netflixAudioTrack({ ...plain, trackType: 'COMMENTARY' }, null)?.kind, 'commentary');
    assert.equal(netflixAudioTrack({ ...plain, bcp47: 'not a tag' }, null)?.languageTag, '');
    assert.equal(netflixAudioTrack({ ...plain, trackType: 'NEW', isNative: true }, null)?.kind, 'unknown', 'never infer original from order or an unknown type');
  });

  it('preserves duplicate languages as distinct variants and never prefers AD', () => {
    const tracks = [original, ad, plain].map(raw => netflixAudioTrack(raw, original)!);
    assert.equal(new Set(tracks.map(item => item.id)).size, 3);
    assert.equal(pickPreferredAudioTrack(tracks, 'original', ['en'])?.id, 'A:en');
    assert.equal(pickPreferredAudioTrack(tracks, 'en', ['en'])?.id, 'A:en');
    assert.equal(pickPreferredAudioTrack([tracks[1]], 'en', ['en']), null);
    assert.equal(pickPreferredAudioTrack([tracks[2], { ...tracks[2], id: 'stereo' }], 'en', ['en']), null, 'ambiguous format stays host-owned');
  });

  it('rejects missing/throwing APIs and malformed or unbounded host data', () => {
    assert.equal(readNetflixAudio({}, '123'), null);
    assert.equal(readNetflixAudio({ getAudioTrackList() { throw Error('manifest loading'); } }, '123'), null);
    assert.equal(readNetflixAudio({ getAudioTrackList: () => [original], getAudioTrack() { throw Error('manifest loading'); } }, '123'), null);
    for (const invalid of [null, {}, { ...original, trackId: '' }, { ...original, displayName: 'x'.repeat(201) }]) assert.equal(netflixAudioTrack(invalid, null), null);
    assert.equal(readNetflixAudio({ getAudioTrackList: () => [original, original] }, '123'), null);
    assert.equal(readNetflixAudio({ getAudioTrackList: () => Array(101).fill(original) }, '123'), null);
    assert.equal(readNetflixAudio({ getAudioTrackList: () => [original], getAudioTrack: () => original }, '123')?.blocked, true, 'unknown ad state fails closed');
    assert.deepEqual(readNetflixAudio({ getAudioTrackList: () => [original], getAudioTrack: () => original, getAdManager: () => ({ adPresenting: false }) }, '123'), list);
  });
});

describe('Netflix audio JSON bridge validation', () => {
  it('binds snapshots to request, client, page and media, with bounded honest tracks', () => {
    const parse = (value: unknown, expected = request) => parseAudioSnapshot(JSON.stringify(value), expected);
    assert.deepEqual(parse(snapshot), snapshot);
    for (const key of ['requestId', 'clientId', 'pageHref', 'mediaId'] as const) assert.equal(parse(snapshot, { ...request, [key]: 'stale' }), null, key);
    for (const bad of [null, {}, { ...snapshot, bindingId: '' }, { ...snapshot, list: { ...list, mediaId: '999' } },
      { ...snapshot, list: { ...list, tracks: [{ ...track, selected: 1 }] } },
      { ...snapshot, list: { ...list, tracks: [{ ...track, languageTag: 'nonsense invalid' }] } },
      { ...snapshot, list: { ...list, tracks: [{ ...track, kind: 'ASSISTIVE' }] } },
      { ...snapshot, list: { ...list, tracks: [track, track] } },
      { ...snapshot, list: { ...list, tracks: [track, { ...track, id: 'second' }] } },
      { ...snapshot, list: { ...list, tracks: Array(101).fill(track) } }]) assert.equal(parse(bad), null);
    assert.equal(parseAudioSnapshot('x'.repeat(60_001), request), null);
    assert.equal(parseAudioSnapshot('{', request), null);
  });

  it('accepts only string requests and ACKs for the complete selection identity', () => {
    assert.deepEqual(parseAudioQuery(JSON.stringify({ ...request, observe: true })), { ...request, observe: true });
    assert.deepEqual(parseAudioSelect(JSON.stringify(select)), select);
    const ack = { ...select, ok: true };
    assert.deepEqual(parseAudioAck(JSON.stringify(ack), select), ack);
    for (const key of ['requestId', 'clientId', 'pageHref', 'mediaId', 'bindingId', 'trackId'] as const) {
      assert.equal(parseAudioAck(JSON.stringify({ ...ack, [key]: 'other' }), select), null, key);
    }
    assert.equal(parseAudioAck(JSON.stringify({ ...ack, ok: 'true' }), select), null);
    for (const raw of [select, null, '{}', '{', 'x'.repeat(3401), JSON.stringify({ ...select, trackId: '' }), JSON.stringify({ ...select, mediaId: 'undefined' })]) assert.equal(parseAudioSelect(raw), null);
    assert.equal(parseAudioQuery(JSON.stringify({ ...request, observe: 1 })), null);
  });
});
