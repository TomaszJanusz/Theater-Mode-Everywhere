import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { youtubePlaybackCommand, type YoutubePlaybackPlayer } from './playback-main';

// getProgressState().allowSeeking as recorded on 2026-11-03: NBC News NOW (B9i_01yEgt0, live without DVR),
// a Davao City camera (6kX0K9u3NTQ, live with DVR) and Big Buck Bunny (aqz-KE-bpKQ, VOD).
const NO_DVR = { allowSeeking: false, isAtLiveHead: true, seekableStart: 0, seekableEnd: 2163.452435 };
const DVR = { allowSeeking: true, isAtLiveHead: true, seekableStart: 3_417_871.733, seekableEnd: 3_461_054.212722 };
const VOD = { allowSeeking: true, isAtLiveHead: false, seekableStart: 0, seekableEnd: 634.5666666666667 };

const player = (progress: object | null): YoutubePlaybackPlayer => ({
  getProgressState: () => progress,
  pauseVideo: () => {},
  playVideo: () => {}
});
const media = (src: string) => ({ currentSrc: src, src, srcObject: null, querySelector: () => null }) as unknown as HTMLVideoElement;
const loaded = media('blob:https://www.youtube.com/0b9e');
const unloaded = media('');

describe('YouTube playback commands', () => {
  it('stops and resumes a live stream without DVR through the player, as its Stop button does', () => {
    assert.equal(youtubePlaybackCommand(player(NO_DVR), loaded, 'pause'), 'pauseVideo');
    assert.equal(youtubePlaybackCommand(player(NO_DVR), loaded, 'play'), 'playVideo');
  });

  it('leaves VOD and live with DVR to the media element', () => {
    for (const progress of [DVR, VOD, null]) {
      assert.equal(youtubePlaybackCommand(player(progress), loaded, 'pause'), null);
      assert.equal(youtubePlaybackCommand(player(progress), loaded, 'play'), null);
    }
  });

  it('plays media YouTube unloaded through the player, never the empty element', () => {
    for (const progress of [NO_DVR, DVR, VOD, null]) {
      assert.equal(youtubePlaybackCommand(player(progress), unloaded, 'play'), 'playVideo');
    }
  });

  it('falls back to the element when the player API is missing', () => {
    assert.equal(youtubePlaybackCommand({ getProgressState: () => NO_DVR }, loaded, 'pause'), null);
    assert.equal(youtubePlaybackCommand({}, unloaded, 'play'), null);
  });
});
