import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { parseDisneyAudioSnapshot } from './audio-bridge';
import { createDisneyAudioHost } from './audio-main';
import { disneyDurationSeconds, readDisneyContentTime, writeDisneyContentTime } from './page';
import { disneyVideoRole } from './watch-playback';

// Recorded signed-in Disney+ watch page, 2026-11-01 (see the fixture's notes). Fixture evidence, not an installed-extension pass.
type Hive = { id: number; language: string; hasDescribesVideo: boolean; displayName: { title: string } };
const fixture = JSON.parse(readFileSync(new URL('../../../test/host-fixtures/disney-watch-player.json', import.meta.url), 'utf8')) as {
  web: { mediaElementIndex: number };
  videos: Array<{ index: number; className: string; isMediaElement: boolean }>;
  mediaPlayer: { audio: { availableTracks: Hive[]; selectedTrackId: number }; timelineInfo: { programDurationMs: number } };
  clock: { playheadPositionMs: number; contentVideoCurrentTimeSeconds: number };
};
const PLAY = 'd1f7a6c2-3b4e-4f5a-9c8d-7e6f5a4b3c2d';
const href = `https://www.disneyplus.com/pl-pl/play/${PLAY}`;

describe('recorded Disney+ player objects', () => {
  it('lists Hive audio through the real host: ids, endonyms, descriptions and the selected track', () => {
    const tracks = fixture.mediaPlayer.audio.availableTracks;
    const selected = tracks.find(track => track.id === fixture.mediaPlayer.audio.selectedTrackId);
    const web = { mediaPlayer: { audio: { availableTracks: tracks, selectedTrack: selected, setTrack() {} } }, stateStore: { getState: () => ({}), subscribe: () => () => {} } };
    let published: unknown = null;
    const host = createDisneyAudioHost({
      enabled: () => true, href: () => href, webPlayer: () => web, contentPaused: () => true,
      publishSnapshot: payload => { published = payload; }, answer: () => {}, changed: () => {}, now: () => 0,
      setTimeout: () => 1, clearTimeout: () => {}
    });
    host.query('r1');
    const snapshot = parseDisneyAudioSnapshot(JSON.stringify(published), 'r1', href);
    assert.ok(snapshot, 'the recorded list is a well-formed snapshot');
    assert.deepEqual(snapshot.tracks.map(track => track.id), tracks.map(track => String(track.id)));
    assert.deepEqual(snapshot.tracks.filter(track => track.selected).map(track => track.id), [String(fixture.mediaPlayer.audio.selectedTrackId)]);
    assert.deepEqual(snapshot.tracks.map(track => track.label), tracks.map(track => track.displayName.title));
    assert.equal(snapshot.tracks.filter(track => track.description).length, tracks.filter(track => track.hasDescribesVideo).length);
  });

  it('tells the content video from the dummy by mediaElement identity, as classes alone cannot', () => {
    const dummy = fixture.videos[1 - fixture.web.mediaElementIndex];
    const content = fixture.videos[fixture.web.mediaElementIndex];
    assert.equal(content.isMediaElement, true);
    assert.equal(disneyVideoRole(content, content), 'content');
    assert.equal(disneyVideoRole(dummy, content), 'dummy');
    assert.equal(disneyVideoRole(content, null), 'content', 'without mediaElement the hive-video class decides');
    assert.equal(disneyVideoRole(dummy, null), 'dummy');
  });

  it('records a playhead that is not the content video clock after a reload', () => {
    assert.ok(fixture.clock.playheadPositionMs / 1000 > fixture.clock.contentVideoCurrentTimeSeconds + 60, 'Hive\'s playhead, not video.currentTime, is the content position');
  });

  it('carries the recorded Hive playhead and program length through the provider\'s clock helpers', () => {
    // MAIN publishes Hive's playhead on the video; the isolated timeline reads it back instead of `currentTime`.
    const video = { dataset: {}, currentTime: fixture.clock.contentVideoCurrentTimeSeconds } as unknown as HTMLVideoElement;
    assert.equal(writeDisneyContentTime(video, fixture.clock.playheadPositionMs / 1000), fixture.clock.playheadPositionMs / 1000);
    assert.equal(readDisneyContentTime(video), fixture.clock.playheadPositionMs / 1000);
    assert.equal(disneyDurationSeconds(fixture.mediaPlayer.timelineInfo.programDurationMs), fixture.mediaPlayer.timelineInfo.programDurationMs / 1000,
      'the millisecond program length is a VOD duration in seconds');
  });
});
