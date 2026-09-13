import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clampToWindow,
  hostLiveHint,
  isAtLiveEdge,
  playbackWindow,
  ratioToTime,
  seekBy,
  timeToRatio
} from './playback-window';

function fakeVideo(init: {
  duration: number;
  currentTime?: number;
  seekable?: Array<{ start: number; end: number }>;
}): HTMLVideoElement {
  const ranges = init.seekable || [];
  return {
    duration: init.duration,
    currentTime: init.currentTime || 0,
    seekable: {
      length: ranges.length,
      start: (index: number) => ranges[index].start,
      end: (index: number) => ranges[index].end
    }
  } as unknown as HTMLVideoElement;
}

describe('playback window', () => {
  it('uses finite duration for VOD', () => {
    const window = playbackWindow(fakeVideo({ duration: 120 }));
    assert.equal(window.live, false);
    assert.equal(window.seekable, true);
    assert.equal(window.start, 0);
    assert.equal(window.end, 120);
    assert.equal(timeToRatio(30, window), 0.25);
    assert.equal(ratioToTime(0.5, window), 60);
  });

  it('treats finite-duration live (YouTube) as live DVR, not a VOD clock', () => {
    const video = fakeVideo({
      duration: 50_390,
      currentTime: 46_790,
      seekable: [{ start: 0, end: 50_390 }]
    });
    const vodShaped = playbackWindow(video);
    assert.equal(vodShaped.live, false);

    const live = playbackWindow(video, { live: true });
    assert.equal(live.live, true);
    assert.equal(live.seekable, true);
    assert.equal(live.end, 50_390);
    assert.equal(isAtLiveEdge(46_790, live), false);
    assert.equal(isAtLiveEdge(50_389, live), true);
  });

  it('reads YouTube live from the player host, not from finite duration', () => {
    const player = {
      classList: { contains: (name: string) => name === 'ytp-livebadge-color' },
      querySelector: () => null,
      getVideoData: () => ({ isLive: true })
    };
    const video = fakeVideo({ duration: 120, currentTime: 100 });
    (video as HTMLVideoElement & { closest: () => unknown }).closest = () => player;
    assert.equal(hostLiveHint(video), true);
    assert.equal(playbackWindow(video).live, true);
  });

  it('maps live DVR onto the seekable range instead of Infinity', () => {
    const window = playbackWindow(fakeVideo({
      duration: Number.POSITIVE_INFINITY,
      currentTime: 140,
      seekable: [{ start: 80, end: 200 }]
    }));
    assert.equal(window.live, true);
    assert.equal(window.seekable, true);
    assert.equal(window.start, 80);
    assert.equal(window.end, 200);
    assert.equal(timeToRatio(140, window), 0.5);
    assert.equal(ratioToTime(0, window), 80);
    assert.equal(isAtLiveEdge(199, window), true);
    assert.equal(isAtLiveEdge(150, window), false);
  });

  it('treats empty live media as unseekable', () => {
    const window = playbackWindow(fakeVideo({ duration: Number.POSITIVE_INFINITY }));
    assert.equal(window.live, true);
    assert.equal(window.seekable, false);
    assert.equal(timeToRatio(0, window), 1);
    assert.equal(isAtLiveEdge(0, window), true);
  });

  it('ignores bogus live seekable ranges that are not a DVR window', () => {
    const pausedTwitch = playbackWindow(fakeVideo({
      duration: Number.POSITIVE_INFINITY,
      currentTime: 0,
      seekable: [{ start: 0, end: 1_073_739_612 }]
    }));
    assert.equal(pausedTwitch.live, true);
    assert.equal(pausedTwitch.seekable, false);

    const ptsWindowWhilePaused = playbackWindow(fakeVideo({
      duration: Number.POSITIVE_INFINITY,
      currentTime: 0,
      seekable: [{ start: 1_073_739_000, end: 1_073_739_120 }]
    }));
    assert.equal(ptsWindowWhilePaused.seekable, false);

    const realDvr = playbackWindow(fakeVideo({
      duration: Number.POSITIVE_INFINITY,
      currentTime: 190,
      seekable: [{ start: 80, end: 200 }]
    }));
    assert.equal(realDvr.seekable, true);
    assert.equal(timeToRatio(190, realDvr), 110 / 120);
  });

  it('clamps seeks inside the DVR window', () => {
    const video = fakeVideo({
      duration: Number.POSITIVE_INFINITY,
      currentTime: 190,
      seekable: [{ start: 80, end: 200 }]
    });
    assert.equal(seekBy(video, 20), true);
    assert.equal(video.currentTime, 200);
    assert.equal(seekBy(video, -150), true);
    assert.equal(video.currentTime, 80);
    const live = fakeVideo({ duration: Number.POSITIVE_INFINITY, currentTime: 10 });
    assert.equal(seekBy(live, -5), false);
    assert.equal(live.currentTime, 10);
  });

  it('clamps times onto the window', () => {
    const window = playbackWindow(fakeVideo({ duration: 10 }));
    assert.equal(clampToWindow(-1, window), 0);
    assert.equal(clampToWindow(12, window), 10);
  });
});
