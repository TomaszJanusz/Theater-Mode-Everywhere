import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clampToWindow,
  hostLiveHint,
  isAtLiveEdge,
  isVideoAtLiveEdge,
  playbackWindow,
  ratioToTime,
  seekBy,
  seekToLive,
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

function youtubeLiveVideo(init: {
  duration: number;
  currentTime: number;
  seekable?: Array<{ start: number; end: number }>;
  wall?: { min: number; max: number; now: number };
  liveHead?: boolean;
}): HTMLVideoElement & {
  setYoutubeLive: (next: { currentTime?: number; liveHead?: boolean; wall?: { min: number; max: number; now: number } }) => void;
} {
  const state = {
    wall: init.wall ? { ...init.wall } : null as { min: number; max: number; now: number } | null,
    liveHead: Boolean(init.liveHead)
  };
  const bar = {
    getAttribute: (name: string) => {
      if (!state.wall) return null;
      if (name === 'aria-valuemin') return String(state.wall.min);
      if (name === 'aria-valuemax') return String(state.wall.max);
      if (name === 'aria-valuenow') return String(state.wall.now);
      return null;
    }
  };
  const badge = {
    offsetParent: {},
    classList: {
      contains: (name: string) => state.liveHead && name === 'ytp-live-badge-is-livehead'
    }
  };
  const player = {
    classList: { contains: (name: string) => name === 'ytp-livebadge-color' },
    querySelector: (selector: string) => {
      if (selector.includes('progress-bar')) return state.wall ? bar : null;
      if (selector.includes('live-badge')) return badge;
      return null;
    },
    getVideoData: () => ({ isLive: true })
  };
  const video = fakeVideo({
    duration: init.duration,
    currentTime: init.currentTime,
    seekable: init.seekable || [{ start: 0, end: init.duration }]
  }) as HTMLVideoElement & {
    setYoutubeLive: (next: { currentTime?: number; liveHead?: boolean; wall?: { min: number; max: number; now: number } }) => void;
  };
  video.closest = () => player;
  video.setYoutubeLive = (next) => {
    if (typeof next.currentTime === 'number') video.currentTime = next.currentTime;
    if (typeof next.liveHead === 'boolean') state.liveHead = next.liveHead;
    if (next.wall) state.wall = { ...next.wall };
  };
  return video;
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

  it('treats finite-duration live without host DVR metadata as a seekable live window', () => {
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

  it('maps YouTube live DVR from the native progress bar, not media duration', () => {
    const video = youtubeLiveVideo({
      duration: 50_390,
      currentTime: 46_790,
      wall: { min: 15_513_207, max: 15_556_402, now: 15_556_402 },
      liveHead: true
    });
    const window = playbackWindow(video);
    assert.equal(window.live, true);
    assert.equal(window.seekable, true);
    assert.ok(Math.abs(window.end - 46_790) < 1);
    assert.ok(Math.abs(window.start - 3_595) < 1);
    assert.equal(isAtLiveEdge(46_790, window), true);
    assert.equal(isVideoAtLiveEdge(video), true);
    assert.ok(timeToRatio(46_790, window) > 0.99);
  });

  it('ignores a stale YouTube progress thumb when the live-head badge is on', () => {
    const video = youtubeLiveVideo({
      duration: 50_390,
      currentTime: 46_798,
      wall: { min: 15_514_182, max: 15_557_367, now: 15_544_383 },
      liveHead: true
    });
    const window = playbackWindow(video);
    assert.ok(Math.abs(window.end - 46_798) < 1);
    assert.equal(isAtLiveEdge(46_798, window), true);
    assert.ok(timeToRatio(46_798, window) > 0.99);
  });

  it('keeps the remembered YouTube live offset when the progress thumb is stuck at live', () => {
    const video = youtubeLiveVideo({
      duration: 50_390,
      currentTime: 46_790,
      wall: { min: 15_513_207, max: 15_556_402, now: 15_556_402 },
      liveHead: true
    });
    assert.ok(timeToRatio(46_790, playbackWindow(video)) > 0.99);
    video.setYoutubeLive({
      currentTime: 32_577,
      liveHead: false,
      wall: { min: 15_513_207, max: 15_556_402, now: 15_556_402 }
    });
    const window = playbackWindow(video);
    assert.ok(Math.abs(window.end - 46_790) < 1);
    assert.equal(isAtLiveEdge(32_577, window), false);
    assert.ok(window.end - 32_577 > 10_000);
    assert.ok(timeToRatio(32_577, window) < 0.8);
  });

  it('keeps the YouTube live head fixed while rewinding inside DVR', () => {
    const video = youtubeLiveVideo({
      duration: 50_390,
      currentTime: 46_610,
      wall: { min: 15_513_207, max: 15_556_402, now: 15_556_222 },
      liveHead: false
    });
    const window = playbackWindow(video);
    assert.ok(Math.abs(window.end - 46_790) < 1);
    assert.equal(isAtLiveEdge(46_610, window), false);
    assert.equal(isVideoAtLiveEdge(video, window), false);
    assert.ok(window.end - 46_610 > 170);
  });

  it('treats the YouTube live-head badge as the edge when the progress bar is missing', () => {
    const video = youtubeLiveVideo({
      duration: 50_390,
      currentTime: 46_790,
      liveHead: true
    });
    const window = playbackWindow(video);
    assert.equal(window.end, 46_790);
    assert.equal(isAtLiveEdge(46_790, window), true);
    assert.ok(timeToRatio(46_790, window) > 0.99);
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

  it('jumps seekable live to the live edge', () => {
    const video = fakeVideo({
      duration: Number.POSITIVE_INFINITY,
      currentTime: 140,
      seekable: [{ start: 80, end: 200 }]
    });
    assert.equal(seekToLive(video), true);
    assert.equal(video.currentTime, 200);
    assert.equal(seekToLive(fakeVideo({ duration: 120, currentTime: 10 })), false);
  });

  it('clamps times onto the window', () => {
    const window = playbackWindow(fakeVideo({ duration: 10 }));
    assert.equal(clampToWindow(-1, window), 0);
    assert.equal(clampToWindow(12, window), 10);
  });
});
