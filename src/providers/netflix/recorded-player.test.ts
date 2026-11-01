import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { netflixAudioBlocked, readNetflixAudio, type NetflixAudioPlayer } from './audio-main';
import { netflixCaptionList, netflixLiveTrackId, parseNetflixTextTracks } from './page';

// Recorded signed-in Netflix watch page, 2026-11-01 (see the fixture's notes). Fixture evidence, not an installed-extension pass.
type Track = Record<string, unknown> & { trackId: string };
type State = { selectedAudioTrackId: string; selectedTimedTextTrackId: string };
const fixture = JSON.parse(readFileSync(new URL('../../../test/host-fixtures/netflix-watch-player.json', import.meta.url), 'utf8')) as {
  movieId: string;
  api: { audioTrackList: Track[]; timedTextTrackList: Track[]; adManager: { adPresentingValue: boolean } };
  states: Record<'paused' | 'audio-subtitles-menu-open' | 'subtitles-off-menu-open', State>;
};

/** Cadmium selects by object identity, so the recorded objects are copied once and the selection points into the copy. */
function recordedPlayer(state: State) {
  const audio = fixture.api.audioTrackList.map(track => ({ ...track }));
  const text = fixture.api.timedTextTrackList.map(track => ({ ...track }));
  const player = {
    getAudioTrackList: () => audio,
    getAudioTrack: () => audio.find(track => track.trackId === state.selectedAudioTrackId),
    getTimedTextTrackList: () => text,
    getTimedTextTrack: () => text.find(track => track.trackId === state.selectedTimedTextTrackId),
    getAdManager: () => ({ adPresenting: { value: fixture.api.adManager.adPresentingValue } })
  };
  return player as unknown as NetflixAudioPlayer;
}

describe('recorded Netflix player objects', () => {
  it('reads the audio list: one native original, one description, the selection by identity, no ad', () => {
    const list = readNetflixAudio(recordedPlayer(fixture.states.paused), fixture.movieId);
    assert.ok(list, 'a settled manifest yields a list');
    assert.equal(list.tracks.length, fixture.api.audioTrackList.length);
    assert.equal(list.blocked, false);
    assert.deepEqual(list.tracks.filter(track => track.selected).map(track => track.id), [fixture.states.paused.selectedAudioTrackId]);
    assert.deepEqual(list.tracks.filter(track => track.kind === 'original').map(track => track.languageTag), ['en']);
    assert.deepEqual(list.tracks.filter(track => track.kind === 'description').map(track => track.languageTag), ['en']);
    assert.equal(list.tracks.filter(track => track.kind === 'dub').length, list.tracks.length - 2);
    assert.ok(list.tracks.some(track => track.languageTag === 'fr-CA'), 'regional BCP-47 tags survive normalisation');
    assert.equal(netflixAudioBlocked(recordedPlayer(fixture.states.paused)), false, 'adPresenting is an observable with value false');
  });

  it('reads the timed-text list: an off track, closed captions and subtitles, and the live selection', () => {
    const player = recordedPlayer(fixture.states.paused);
    const tracks = parseNetflixTextTracks(netflixCaptionList(player));
    assert.equal(tracks.length, Math.min(40, fixture.api.timedTextTrackList.length));
    assert.deepEqual(tracks.filter(track => track.none).map(track => track.id), ['T:2:1;1;NONE;0;1;0;0;']);
    assert.equal(tracks.find(track => track.language === 'en')?.kind, 'captions');
    assert.equal(tracks.find(track => track.language === 'pl')?.kind, 'subtitles');
    assert.equal(netflixLiveTrackId(player), fixture.states.paused.selectedTimedTextTrackId);
    assert.equal(netflixLiveTrackId(recordedPlayer(fixture.states['subtitles-off-menu-open'])), 'T:2:1;1;NONE;0;1;0;0;');
  });
});
