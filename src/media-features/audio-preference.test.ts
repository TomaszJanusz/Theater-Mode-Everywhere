import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  audioPreferenceForTrack,
  pickPreferredAudioTrack,
  resolveAudioPreference,
  resolveAudioPreferences,
  upsertAudioPreference
} from './audio-preference';
import type { AudioTrack } from './types';

const track = (id: string, languageTag: string, kind: AudioTrack['kind'], label = id): AudioTrack =>
  ({ id, languageTag, label, kind, selected: false });

describe('saved audio preference per service', () => {
  it('keeps original and canonical language tags; anything else means the service decides', () => {
    assert.equal(resolveAudioPreference('original'), 'original');
    assert.equal(resolveAudioPreference('pt_br'), 'pt-BR');
    assert.equal(resolveAudioPreference('ZH-hant'), 'zh-Hant');
    for (const value of [undefined, null, '', 'und', 'not a tag!', 42, { language: 'de' }, ['de']]) {
      assert.equal(resolveAudioPreference(value), null, JSON.stringify(value));
    }
  });

  it('keys entries by service like subtitles, dropping invalid ones', () => {
    assert.deepEqual(resolveAudioPreferences({
      'www.youtube.com': 'fr', 'm.youtube.com': 'original', 'vimeo.com': 'xx-invalid-!', 'player.vimeo.com': 'de', '': 'en', 'netflix.com': null
    }), { 'youtube.com': 'original', 'vimeo.com': 'de' });
    for (const value of [undefined, null, 'fr', ['fr']]) assert.deepEqual(resolveAudioPreferences(value), {});
  });

  it('saves and clears one service without touching another', () => {
    let map = upsertAudioPreference({}, 'www.youtube.com', 'fr');
    map = upsertAudioPreference(map, 'www.netflix.com', 'original');
    assert.deepEqual(map, { 'youtube.com': 'fr', 'netflix.com': 'original' });
    // Embeds and short links are the same service.
    map = upsertAudioPreference(map, 'www.youtube-nocookie.com', 'de');
    assert.deepEqual(map, { 'youtube.com': 'de', 'netflix.com': 'original' });
    map = upsertAudioPreference(map, 'youtu.be', null);
    assert.deepEqual(map, { 'netflix.com': 'original' });
    assert.equal(upsertAudioPreference(map, 'vimeo.com', null), map, 'clearing nothing keeps the map');
  });

  it('caps the map like subtitles and keeps the entry just saved', () => {
    let map = {};
    for (let index = 0; index < 85; index++) map = upsertAudioPreference(map, `site${index}.example`, 'en');
    assert.equal(Object.keys(map).length, 80);
    assert.ok('site84.example' in map);
  });

  it('a pick saves original, or its language; description, commentary and untagged picks save nothing', () => {
    assert.equal(audioPreferenceForTrack(track('a', 'en-US', 'original')), 'original');
    assert.equal(audioPreferenceForTrack(track('b', 'fr', 'dub')), 'fr');
    assert.equal(audioPreferenceForTrack(track('c', 'es_419', 'unknown')), 'es-419');
    assert.equal(audioPreferenceForTrack(track('d', 'en', 'description')), null);
    assert.equal(audioPreferenceForTrack(track('e', 'en', 'commentary')), null);
    assert.equal(audioPreferenceForTrack(track('f', '', 'dub', 'French')), null);
  });
});

describe('preferred audio track matching', () => {
  // Shape measured on a dubbed YouTube video: one original and language-tagged dubs.
  const youtube = [track('ar', 'ar', 'dub'), track('en', 'en-US', 'original', 'English (US) original'), track('fr', 'fr', 'dub'),
    track('zh-Hans', 'zh-Hans', 'dub'), track('zh-Hant', 'zh-Hant', 'dub'), track('es', 'es', 'dub')];

  it('never selects without a saved preference', () => {
    assert.equal(pickPreferredAudioTrack(youtube, null, ['en']), null);
  });

  it('original picks the single original track, and nothing when that is unclear', () => {
    assert.equal(pickPreferredAudioTrack(youtube, 'original', ['en'])?.id, 'en');
    assert.equal(pickPreferredAudioTrack([track('a', 'en', 'unknown'), track('b', 'de', 'dub')], 'original', ['en']), null);
    assert.equal(pickPreferredAudioTrack([track('a', 'en', 'original'), track('b', 'de', 'original')], 'original', ['en']), null);
  });

  it('matches by tag before region, and leaves the host choice without a match', () => {
    assert.equal(pickPreferredAudioTrack(youtube, 'fr', ['en'])?.id, 'fr');
    assert.equal(pickPreferredAudioTrack(youtube, 'en', ['en'])?.id, 'en');
    assert.equal(pickPreferredAudioTrack(youtube, 'zh-Hant', ['en'])?.id, 'zh-Hant');
    assert.equal(pickPreferredAudioTrack([track('es', 'es', 'dub'), track('es-419', 'es-419', 'dub')], 'es-419', ['en'])?.id, 'es-419');
    assert.equal(pickPreferredAudioTrack([track('en', 'en', 'original'), track('pt', 'pt-BR', 'dub')], 'pt', ['en'])?.id, 'pt');
    assert.equal(pickPreferredAudioTrack(youtube, 'pl', ['en']), null);
  });

  it('does not guess between equal matches', () => {
    assert.equal(pickPreferredAudioTrack(youtube, 'zh', ['en']), null);
  });

  it('never picks description or commentary tracks automatically, and prefers original over dub', () => {
    const tracks = [track('desc', 'en', 'description'), track('talk', 'en', 'commentary'), track('dub', 'en', 'dub'), track('main', 'en', 'original')];
    assert.equal(pickPreferredAudioTrack(tracks, 'en', ['en'])?.id, 'main');
    assert.equal(pickPreferredAudioTrack(tracks.slice(0, 2), 'en', ['en']), null);
    assert.equal(pickPreferredAudioTrack([track('desc', 'en', 'description'), track('de', 'de', 'dub')], 'en', ['en']), null);
    assert.equal(pickPreferredAudioTrack([track('desc', 'en', 'description'), track('plain', 'en', 'unknown')], 'en', ['en'])?.id, 'plain');
  });

  it('maps untagged labels to languages in the UI locale, English or the language itself', () => {
    const untagged = [track('1', '', 'unknown', 'Francuski'), track('2', '', 'unknown', 'English (US) original'), track('3', 'und', 'unknown', 'Deutsch')];
    assert.equal(pickPreferredAudioTrack(untagged, 'fr', ['pl'])?.id, '1');
    assert.equal(pickPreferredAudioTrack(untagged, 'en', ['pl'])?.id, '2');
    assert.equal(pickPreferredAudioTrack(untagged, 'de', ['ja'])?.id, '3');
    // A label that merely contains the name is not a language label.
    assert.equal(pickPreferredAudioTrack([track('x', '', 'unknown', 'Director commentary in French')], 'fr', ['en']), null);
    // A tag outranks a label naming the same language.
    assert.equal(pickPreferredAudioTrack([track('label', '', 'unknown', 'French'), track('tag', 'fr', 'unknown')], 'fr', ['en'])?.id, 'tag');
  });
});
