import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { parseDisneyAudioSnapshot } from './audio-bridge';
import { createDisneyAudioHost } from './audio-main';
import { disneyVideoRole } from './watch-playback';

// Recorded signed-in Disney+ watch page, 2026-11-01 (see the fixture's notes). Fixture evidence, not an installed-extension pass.
type Hive = { id: number; language: string; hasDescribesVideo: boolean; displayName: { title: string } };
const fixture = JSON.parse(readFileSync(new URL('../../../test/host-fixtures/disney-watch-player.json', import.meta.url), 'utf8')) as {
  web: { mediaElementIndex: number };
  videos: Array<{ index: number; className: string; isMediaElement: boolean }>;
  mediaPlayer: { audio: { availableTracks: Hive[]; selectedTrackId: number } };
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
});

// Second recording, same day: playing and idle states, an audio switch and Disney's own Audio & Subtitles menu (see the fixture's notes).
type Capture = { videos: Array<{ index: number; className: string; isMediaElement: boolean; paused: boolean; readyState: number }>; mediaElementIndex: number; clock: { playheadPositionMs: number; contentVideoCurrentTimeSeconds: number }; audioSelectedTrackId: number; flags: { idleClass: boolean } };
type TrackList = { fields: string[]; tracks: Array<[number, string, string, number, number]> };
type Reload = Array<{ dtMs: number; paused: boolean; readyState: number; currentTime: number; playheadS: number; audioTrackId: number; videoCount: number; hiveVideoNodeId: number; mediaElementIsHiveVideo: boolean }>;
const states = JSON.parse(readFileSync(new URL('../../../test/host-fixtures/disney-watch-states.json', import.meta.url), 'utf8')) as {
  states: { playing: Capture; idleControlsHidden: Capture };
  audioSwitch: {
    tracksBefore: TrackList; tracksAfter: TrackList; before: Capture; after: Capture;
    reloadWhilePlaying: { toPolski: Reload; toEnglish: Reload };
    playbackModel: { afterExtensionPause: { videoPaused: boolean; hiveIsPaused: boolean; hiveCurrentState: string }; afterHivePause: { videoPaused: boolean; hiveIsPaused: boolean; hiveCurrentState: string } };
    positionAfterSwitch: Array<{ case: string; jumpS?: number }>;
  };
  captionLists: { hiveCaptionTrackCount: number };
};
const menu = (name: string) => readFileSync(new URL(`../../../test/host-fixtures/disney-watch-${name}-menu.html`, import.meta.url), 'utf8');
/** The radio rows of a recorded Disney menu view: label (badges dropped) and aria-checked. */
function radios(html: string): Array<{ label: string; checked: boolean }> {
  return [...html.matchAll(/<button[^>]*role="radio"[^>]*aria-checked="(true|false)"[^>]*>\s*<span class="[^"]*__label[^"]*">([^<]*)/g)]
    .map(match => ({ label: match[2], checked: match[1] === 'true' }));
}
const hiveHost = (list: TrackList) => {
  const tracks = list.tracks.map(([id, language, title, selected, describes]) => ({ id, language, hasDescribesVideo: describes === 1, displayName: { title }, isSelected: selected === 1 }));
  const selected = tracks.find(track => track.isSelected);
  let published: unknown = null;
  const host = createDisneyAudioHost({
    enabled: () => true, href: () => href, contentPaused: () => true,
    webPlayer: () => ({ mediaPlayer: { audio: { availableTracks: tracks, selectedTrack: selected, setTrack() {} } }, stateStore: { getState: () => ({}), subscribe: () => () => {} } }),
    publishSnapshot: payload => { published = payload; }, answer: () => {}, changed: () => {}, now: () => 0, setTimeout: () => 1, clearTimeout: () => {}
  });
  host.query('r1');
  return { tracks, snapshot: parseDisneyAudioSnapshot(JSON.stringify(published), 'r1', href) };
};

describe('recorded Disney+ menu, playing, idle and audio-switch states', () => {
  it('shows the same audio tracks in Disney\'s own menu as Hive lists, in the same order, with the selected one checked', () => {
    const rows = radios(menu('audio'));
    const { tracks, snapshot } = hiveHost(states.audioSwitch.tracksBefore);
    assert.equal(rows.length, 23);
    assert.deepEqual(rows.map(row => row.label), tracks.map(track => track.displayName.title));
    assert.deepEqual(rows.filter(row => row.checked).map(row => row.label), tracks.filter(track => track.isSelected).map(track => track.displayName.title));
    assert.deepEqual(snapshot?.tracks.map(track => track.label), rows.map(row => row.label), 'the extension list built from Hive reads like the native one');
  });

  it('follows the selected track through the real audio host before and after the switch', () => {
    const before = hiveHost(states.audioSwitch.tracksBefore).snapshot;
    const after = hiveHost(states.audioSwitch.tracksAfter).snapshot;
    assert.deepEqual(before?.tracks.filter(track => track.selected).map(track => track.id), [String(states.audioSwitch.before.audioSelectedTrackId)]);
    assert.deepEqual(after?.tracks.filter(track => track.selected).map(track => track.id), [String(states.audioSwitch.after.audioSelectedTrackId)]);
    assert.notEqual(states.audioSwitch.before.audioSelectedTrackId, states.audioSwitch.after.audioSelectedTrackId);
    assert.deepEqual(before?.tracks.map(track => track.id), after?.tracks.map(track => track.id), 'a switch does not reorder or rebuild the list');
  });

  it('keeps hive-video as the content video and the dummy out of it in every recorded state', () => {
    for (const capture of [states.states.playing, states.states.idleControlsHidden, states.audioSwitch.before, states.audioSwitch.after]) {
      const content = capture.videos[capture.mediaElementIndex];
      const dummy = capture.videos[1 - capture.mediaElementIndex];
      assert.equal(content.isMediaElement, true);
      assert.equal(disneyVideoRole(content, content), 'content');
      assert.equal(disneyVideoRole(dummy, content), 'dummy');
      assert.equal(dummy.readyState, 0, 'the dummy never loads');
    }
  });

  it('lists Off plus every Hive caption track in Disney\'s subtitle menu', () => {
    const rows = radios(menu('subtitles'));
    assert.equal(rows.length, states.captionLists.hiveCaptionTrackCount + 1);
    assert.equal(rows.filter(row => row.checked).length, 1);
    assert.ok(rows.some(row => row.label === 'English [CC]' && row.checked));
  });

  it('records the main settings view with the subtitle and audio rows and their current values', () => {
    const html = menu('settings');
    assert.match(html, /aria-label="Napisy, English \[CC\]"/);
    assert.match(html, /aria-label="Opcje dźwięku, English"/);
    assert.equal((html.match(/role="menuitem"/g) ?? []).length, 3);
  });

  it('reloads the media under a playing title without replacing the video or moving the playhead', () => {
    for (const sequence of [states.audioSwitch.reloadWhilePlaying.toPolski, states.audioSwitch.reloadWhilePlaying.toEnglish]) {
      assert.equal(new Set(sequence.map(sample => sample.hiveVideoNodeId)).size, 1, 'the same hive-video node throughout');
      assert.ok(sequence.every(sample => sample.mediaElementIsHiveVideo && sample.videoCount === 2));
      const emptied = sequence.findIndex(sample => sample.readyState === 0 && sample.currentTime === 0);
      assert.ok(emptied > 0, 'the picture empties once');
      assert.equal(sequence.at(-1)?.readyState, 4, 'and is back by the end');
      assert.ok((sequence.at(-1)?.currentTime ?? 0) >= 20, 'on a new timeline that restarts at 20 s');
      const tracks = sequence.map(sample => sample.audioTrackId);
      assert.equal(new Set(tracks).size, 2);
      assert.ok(tracks.indexOf(tracks.at(-1)!) > emptied - 1, 'the selected track changes with the reload, not before');
      const steps = sequence.slice(1).map((sample, index) => sample.playheadS - sequence[index].playheadS);
      assert.ok(steps.every(step => step >= 0 && step < 1), 'Hive\'s playhead carries on across the reload');
    }
  });

  it('records that pausing only the video element leaves Hive playing, and that a switch then moves the playhead', () => {
    const { afterExtensionPause, afterHivePause } = states.audioSwitch.playbackModel;
    assert.deepEqual([afterExtensionPause.videoPaused, afterExtensionPause.hiveIsPaused, afterExtensionPause.hiveCurrentState], [true, false, 'PLAYING']);
    assert.deepEqual([afterHivePause.videoPaused, afterHivePause.hiveIsPaused, afterHivePause.hiveCurrentState], [true, true, 'PAUSED']);
    const jumps = states.audioSwitch.positionAfterSwitch.filter(entry => entry.jumpS !== undefined);
    assert.ok(jumps.some(entry => (entry.jumpS ?? 0) > 50), 'a title Hive believes is playing resumes ahead of the pause point');
    assert.ok(jumps.some(entry => entry.jumpS === 0), 'a title Hive knows is paused stays where it was');
  });

  it('tells a playing from an idle title by the idle class, with the playhead off currentTime in both', () => {
    assert.equal(states.states.playing.flags.idleClass, false);
    assert.equal(states.states.idleControlsHidden.flags.idleClass, true);
    for (const capture of [states.states.playing, states.states.idleControlsHidden]) {
      assert.equal(capture.videos[capture.mediaElementIndex].paused, false);
      assert.ok(capture.clock.playheadPositionMs / 1000 > capture.clock.contentVideoCurrentTimeSeconds + 60, 'the playhead, not video.currentTime, is the content position');
    }
  });
});
