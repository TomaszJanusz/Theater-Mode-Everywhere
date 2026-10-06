import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DISNEY_CLOCK_EVENT } from './media-features/parsers/disney-page';
import {
  clampToWindow,
  displayMediaTime,
  hostLiveHint,
  isAtLiveEdge,
  isVideoAtLiveEdge,
  playbackWindow,
  presentPlaybackWindow,
  ratioToTime,
  seekBy,
  seekToLive,
  seekToMediaTime,
  timeToRatio
} from './playback-window';
import { observeProviderClock, readProviderClock } from './providers/timeline';

function fakeVideo(init: {
  duration: number;
  currentTime?: number;
  seekable?: Array<{ start: number; end: number }>;
  paused?: boolean;
}): HTMLVideoElement {
  const ranges = init.seekable || [];
  return {
    duration: init.duration,
    currentTime: init.currentTime || 0,
    paused: init.paused ?? false,
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

  it('does not remap YouTube live DVR when the native thumb jumps ahead of HTML5', () => {
    const video = youtubeLiveVideo({
      duration: 50_390,
      currentTime: 46_790,
      wall: { min: 15_513_207, max: 15_556_402, now: 15_556_402 },
      liveHead: true
    });
    const live = playbackWindow(video);
    const first = ratioToTime(0.4, live);
    video.setYoutubeLive({
      currentTime: first,
      liveHead: false,
      wall: { min: 15_513_207, max: 15_556_402, now: 15_513_207 + (first - live.start) }
    });
    const afterFirst = playbackWindow(video);
    assert.ok(Math.abs(afterFirst.end - live.end) < 1);
    const firstRatio = timeToRatio(first, afterFirst);

    const second = ratioToTime(0.15, afterFirst);
    const secondWall = 15_513_207 + (second - afterFirst.start);
    video.setYoutubeLive({
      currentTime: first,
      liveHead: false,
      wall: { min: 15_513_207, max: 15_556_402, now: secondWall }
    });
    const inFlight = playbackWindow(video);
    assert.ok(Math.abs(inFlight.end - live.end) < 1, 'live head should stay put while HTML5 lags');
    assert.ok(Math.abs(timeToRatio(first, inFlight) - firstRatio) < 0.01);
    assert.ok(timeToRatio(second, inFlight) < firstRatio);
  });

  it('holds the theater time on a YouTube live seek until HTML5 catches up', () => {
    const previousWindow = (globalThis as { window?: unknown }).window;
    const dispatched: unknown[] = [];
    (globalThis as { window?: { dispatchEvent: (event: Event) => boolean } }).window = {
      dispatchEvent: (event: Event) => {
        dispatched.push(event);
        return true;
      }
    };
    try {
      const video = youtubeLiveVideo({
        duration: 50_390,
        currentTime: 46_790,
        wall: { min: 15_513_207, max: 15_556_402, now: 15_556_402 },
        liveHead: true
      });
      playbackWindow(video);
      video.setYoutubeLive({
        currentTime: 32_577,
        liveHead: false,
        wall: { min: 15_513_207, max: 15_556_402, now: 15_542_189 }
      });
      const firstTime = video.currentTime;
      const window = playbackWindow(video);
      const target = ratioToTime(0.2, window);
      seekToMediaTime(video, target);
      assert.equal(video.currentTime, firstTime);
      assert.ok(dispatched.length > 0);
      assert.ok(Math.abs(displayMediaTime(video) - target) < 0.5);
      assert.ok(Math.abs(timeToRatio(displayMediaTime(video), playbackWindow(video)) - 0.2) < 0.02);
      video.currentTime = target;
      assert.ok(Math.abs(displayMediaTime(video) - target) < 0.5);
    } finally {
      if (previousWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = previousWindow;
      }
    }
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

  it('does not treat a YouTube VOD as live because the player has ytp-livebadge-color', () => {
    const player = {
      classList: { contains: (name: string) => name === 'ytp-livebadge-color' },
      querySelector: (selector: string) => selector.includes('live-badge') ? { offsetParent: null } : null,
      getVideoData: () => ({ isLive: false })
    };
    const video = fakeVideo({ duration: 1473, currentTime: 1445 });
    (video as HTMLVideoElement & { closest: () => unknown }).closest = () => player;
    assert.equal(hostLiveHint(video), false);
    assert.equal(playbackWindow(video).live, false);
    assert.equal(playbackWindow(video).end, 1473);
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

  it('does not present a video with no duration yet as live', () => {
    const unsettled = playbackWindow(fakeVideo({ duration: Number.NaN }));
    assert.equal(unsettled.live, false);
    assert.equal(unsettled.seekable, false);
    const held = presentPlaybackWindow(
      playbackWindow(fakeVideo({ duration: 1009, currentTime: 8 })),
      unsettled
    );
    assert.equal(held.live, false);
    assert.equal(held.end, 1009);
    assert.equal(presentPlaybackWindow(held, playbackWindow(fakeVideo({ duration: 6 }))).end, 6);
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

  it('treats Infinity duration with a seekable prefix from 0 as VOD of unknown length', () => {
    const window = playbackWindow(fakeVideo({
      duration: Number.POSITIVE_INFINITY,
      seekable: [{ start: 0, end: 156 }],
      currentTime: 143
    }));
    assert.equal(window.live, false);
    assert.equal(window.seekable, true);
    assert.equal(window.start, 0);
    assert.equal(window.end, 156);
    assert.ok(Math.abs(timeToRatio(143, window) - 143 / 156) < 0.001);
  });

  it('uses a known host duration instead of the growing MSE prefix', () => {
    const window = playbackWindow(fakeVideo({
      duration: Number.POSITIVE_INFINITY,
      seekable: [{ start: 0, end: 156 }],
      currentTime: 143
    }), { duration: 7080 });
    assert.equal(window.live, false);
    assert.equal(window.end, 7080);
    assert.ok(Math.abs(timeToRatio(143, window) - 143 / 7080) < 0.001);
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

  it('maps Disney+ theater time from Hive playhead and seeks through the host player', () => {
    const previousWindow = (globalThis as { window?: unknown }).window;
    const dispatched: unknown[] = [];
    (globalThis as { window?: { location: { hostname: string }; dispatchEvent: (event: Event) => boolean } }).window = {
      location: { hostname: 'www.disneyplus.com' },
      dispatchEvent: (event: Event) => {
        dispatched.push(event);
        return true;
      }
    };
    try {
      const video = fakeVideo({ duration: 7260, currentTime: 184 });
      (video as HTMLVideoElement & { dataset: Record<string, string> }).dataset = { teDisneyPlayhead: '1840' };
      assert.ok(Math.abs(displayMediaTime(video) - 1840) < 0.01);
      const before = video.currentTime;
      seekToMediaTime(video, 3600);
      assert.equal(video.currentTime, before);
      assert.equal(dispatched.length, 1);
      assert.equal((dispatched[0] as CustomEvent).detail.resumeAfterSeek, true);
      // Disney+ can report the HTMLMediaElement as paused while the first
      // host seek is buffering. A rapid second arrow key must retain the
      // original intent to resume playback.
      (video as HTMLVideoElement & { paused: boolean }).paused = true;
      seekToMediaTime(video, 3605);
      assert.equal(dispatched.length, 2);
      assert.equal((dispatched[1] as CustomEvent).detail.resumeAfterSeek, true);
      assert.ok(Math.abs(displayMediaTime(video) - 3605) < 0.5);
    } finally {
      if (previousWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = previousWindow;
      }
    }
  });

  it('seeks Disney+ through the host while the integration flag is off', () => {
    const previous = installHost('www.disneyplus.com', ['data-te-disney-integration-off']);
    try {
      const video = fakeVideo({ duration: 7260, currentTime: 184 });
      seekToMediaTime(video, 3600);
      assert.equal(video.currentTime, 184);
      assert.equal(previous.dispatched.length, 1);
      assert.equal((previous.dispatched[0] as CustomEvent).detail.time, 3600);
    } finally {
      previous.restore();
    }
  });

  it('dispatches Netflix seeks only while provider integration is on', () => {
    const blocked = installHost('www.netflix.com', ['data-te-netflix-integration-off']);
    try {
      const video = fakeVideo({ duration: 3600, currentTime: 10 });
      seekToMediaTime(video, 90);
      assert.equal(video.currentTime, 90);
      assert.equal(blocked.dispatched.length, 0);
    } finally {
      blocked.restore();
    }

    const enabled = installHost('www.netflix.com', []);
    try {
      const video = fakeVideo({ duration: 3600, currentTime: 10 });
      seekToMediaTime(video, 90);
      assert.equal(video.currentTime, 10);
      assert.equal(enabled.dispatched.length, 1);
      assert.equal((enabled.dispatched[0] as CustomEvent).detail.resumeAfterSeek, true);
      assert.equal((enabled.dispatched[0] as CustomEvent).detail.time, 90);
    } finally {
      enabled.restore();
    }
  });

  it('reads and observes the Disney clock only on Disney+', () => {
    const other = installHost('www.netflix.com', []);
    try {
      const video = fakeVideo({ duration: 100, currentTime: 4 });
      (video as HTMLVideoElement & { dataset: Record<string, string> }).dataset = { teDisneyPlayhead: '40' };
      assert.equal(readProviderClock(video), null);
      const seen: Array<number | null> = [];
      const stop = observeProviderClock(video, (published) => { seen.push(published); });
      other.win.dispatchEvent(new CustomEvent(DISNEY_CLOCK_EVENT, { detail: { time: 12 } }));
      assert.deepEqual(seen, []);
      stop();
    } finally {
      other.restore();
    }

    const disney = installHost('www.disneyplus.com', ['data-te-disney-integration-off']);
    try {
      const video = fakeVideo({ duration: 7260, currentTime: 184 });
      const dataset: Record<string, string> = {};
      (video as HTMLVideoElement & { dataset: Record<string, string> }).dataset = dataset;
      assert.equal(readProviderClock(video), null);
      const seen: Array<number | null> = [];
      const stop = observeProviderClock(video, (published) => { seen.push(published); });
      disney.win.dispatchEvent(new CustomEvent(DISNEY_CLOCK_EVENT, { detail: { time: 90 } }));
      assert.equal(dataset.teDisneyPlayhead, '90');
      assert.equal(readProviderClock(video), 90);
      disney.win.dispatchEvent(new CustomEvent(DISNEY_CLOCK_EVENT, { detail: { time: Number.NaN } }));
      assert.deepEqual(seen, [90, 90]);
      stop();
      disney.win.dispatchEvent(new CustomEvent(DISNEY_CLOCK_EVENT, { detail: { time: 10 } }));
      assert.deepEqual(seen, [90, 90]);
      assert.equal(dataset.teDisneyPlayhead, '90');
    } finally {
      disney.restore();
    }
  });
});

function installHost(hostname: string, integrationOff: string[]) {
  const previousWindow = (globalThis as { window?: unknown }).window;
  const previousDocument = (globalThis as { document?: unknown }).document;
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const dispatched: Event[] = [];
  const off = new Set(integrationOff);
  const win = {
    location: { hostname },
    addEventListener(type: string, listener: (event: Event) => void) {
      const set = listeners.get(type) ?? new Set<(event: Event) => void>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: (event: Event) => void) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event: Event) {
      dispatched.push(event);
      const handlers = listeners.get(event.type);
      if (handlers) {
        for (const listener of handlers) listener(event);
      }
      return true;
    }
  };
  (globalThis as { window?: unknown }).window = win;
  (globalThis as { document?: unknown }).document = {
    documentElement: {
      hasAttribute: (name: string) => off.has(name)
    }
  };
  return {
    win,
    dispatched,
    restore() {
      if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = previousWindow;
      if (previousDocument === undefined) delete (globalThis as { document?: unknown }).document;
      else (globalThis as { document?: unknown }).document = previousDocument;
    }
  };
}
