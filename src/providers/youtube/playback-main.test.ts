import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { youtubeApiForbidsSeeking, youtubePlaybackCommand, type YoutubePlaybackPlayer } from './playback-main';
import { youtubeSeekForbidden } from './timeline';

// getProgressState().allowSeeking as recorded on 2026-11-03: NBC News NOW (B9i_01yEgt0, live without DVR),
// a Davao City camera (6kX0K9u3NTQ, live with DVR) and Big Buck Bunny (aqz-KE-bpKQ, VOD).
const NO_DVR = { allowSeeking: false, isAtLiveHead: true, seekableStart: 0, seekableEnd: 2163.452435 };
const DVR = { allowSeeking: true, isAtLiveHead: true, seekableStart: 3_417_871.733, seekableEnd: 3_461_054.212722 };
const VOD = { allowSeeking: true, isAtLiveHead: false, seekableStart: 0, seekableEnd: 634.5666666666667 };

const player: YoutubePlaybackPlayer = { pauseVideo: () => {}, playVideo: () => {} };
const media = (src: string) => ({ currentSrc: src, src, srcObject: null, querySelector: () => null }) as unknown as HTMLVideoElement;
const loaded = media('blob:https://www.youtube.com/0b9e');
const unloaded = media('');

/** A watch player as both worlds read it: the bar container's aria-disabled, the live badge and the progress state. */
function watchPlayer(init: { live: boolean; barDisabled: boolean; progress: object | null }): { video: HTMLVideoElement; host: Element } {
  const container = { getAttribute: (name: string) => (name === 'aria-disabled' && init.barDisabled ? 'true' : null) };
  const badge = { offsetParent: init.live ? {} : null, classList: { contains: () => init.live } };
  const host = {
    querySelector: (selector: string) => {
      if (selector.includes('progress-bar-container')) return container;
      if (selector.includes('live-badge')) return badge;
      return null;
    },
    getProgressState: () => init.progress
  } as unknown as Element;
  const video = { closest: () => host } as unknown as HTMLVideoElement;
  return { video, host };
}

describe('YouTube seek rule', () => {
  it('forbids seeking a live stream when either YouTube signal says so, in both worlds alike', () => {
    for (const [barDisabled, progress, forbidden] of [
      [true, NO_DVR, true],
      [true, DVR, true],
      [false, NO_DVR, true],
      [true, null, true],
      [false, DVR, false],
      [false, null, false]
    ] as const) {
      const { video } = watchPlayer({ live: true, barDisabled, progress });
      assert.equal(youtubeSeekForbidden(video, youtubeApiForbidsSeeking), forbidden, `bar ${barDisabled}, progress ${JSON.stringify(progress)}`);
    }
  });

  it('never applies to a VOD, whose ads also disable seeking', () => {
    const { video } = watchPlayer({ live: false, barDisabled: true, progress: { ...VOD, allowSeeking: false } });
    assert.equal(youtubeSeekForbidden(video, youtubeApiForbidsSeeking), false);
  });

  it('reads the API defensively', () => {
    const throwing = { getProgressState: () => { throw new Error('not ready'); } } as unknown as Element;
    assert.equal(youtubeApiForbidsSeeking(throwing), false);
    assert.equal(youtubeApiForbidsSeeking({} as Element), false);
  });
});

describe('YouTube playback commands', () => {
  it('stops and resumes a live stream that forbids seeking through the player, as its Stop button does', () => {
    assert.equal(youtubePlaybackCommand(player, loaded, 'pause', true), 'pauseVideo');
    assert.equal(youtubePlaybackCommand(player, loaded, 'play', true), 'playVideo');
  });

  it('leaves VOD and live with DVR to the media element', () => {
    assert.equal(youtubePlaybackCommand(player, loaded, 'pause', false), null);
    assert.equal(youtubePlaybackCommand(player, loaded, 'play', false), null);
  });

  it('plays media YouTube unloaded through the player, never the empty element', () => {
    for (const forbidden of [true, false]) assert.equal(youtubePlaybackCommand(player, unloaded, 'play', forbidden), 'playVideo');
  });

  it('falls back to the element when the player API is missing', () => {
    assert.equal(youtubePlaybackCommand({}, loaded, 'pause', true), null);
    assert.equal(youtubePlaybackCommand({}, unloaded, 'play', true), null);
  });
});
