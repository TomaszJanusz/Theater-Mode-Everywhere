import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import type * as PlaybackWindow from '../../playback-window';
import type * as Timeline from '../timeline';

import { DISNEY_CLOCK_EVENT } from './page';
import { disneyTimeline } from './timeline';

let displayMediaTime: typeof PlaybackWindow.displayMediaTime;
let seekToMediaTime: typeof PlaybackWindow.seekToMediaTime;
let observeProviderClock: typeof Timeline.observeProviderClock;
let readProviderClock: typeof Timeline.readProviderClock;

// The registry belongs to its document's host, read when its module loads: load the shared playback window on a
// Disney+ host, where Disney's isolated entry registers its timeline.
before(async () => {
  const scope = globalThis as { window?: unknown };
  scope.window = { location: { hostname: 'www.disneyplus.com' } };
  const { providerRegistry } = await import('../runtime-registration');
  ({ displayMediaTime, seekToMediaTime } = await import('../../playback-window'));
  ({ observeProviderClock, readProviderClock } = await import('../timeline'));
  delete scope.window;
  assert.equal(providerRegistry.register({ id: 'disney', contractVersion: 1, timeline: disneyTimeline }), true);
});

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

describe('Disney+ through the shared playback window', () => {
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
      assert.equal(typeof (dispatched[0] as CustomEvent).detail, 'string');
      assert.equal(JSON.parse((dispatched[0] as CustomEvent).detail).resumeAfterSeek, true);
      // Disney+ can report the HTMLMediaElement as paused while the first
      // host seek is buffering. A rapid second arrow key must retain the
      // original intent to resume playback.
      (video as HTMLVideoElement & { paused: boolean }).paused = true;
      seekToMediaTime(video, 3605);
      assert.equal(dispatched.length, 2);
      assert.equal(JSON.parse((dispatched[1] as CustomEvent).detail).resumeAfterSeek, true);
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
      assert.equal(JSON.parse((previous.dispatched[0] as CustomEvent).detail).time, 3600);
    } finally {
      previous.restore();
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
