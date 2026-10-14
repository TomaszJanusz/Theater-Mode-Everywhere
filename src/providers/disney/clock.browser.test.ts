import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const SRC = path.dirname(fileURLToPath(import.meta.url));
const PLAY_ID = '86e14fdb-3841-4282-ad38-07c8c4aab4b6';

const esbuild = require(createRequire(require.resolve('vite')).resolve('esbuild')) as {
  buildSync: (options: {
    stdin: { contents: string; resolveDir: string; sourcefile: string; loader: 'ts' };
    bundle: true;
    write: false;
    format: 'iife';
    globalName: string;
    platform: 'browser';
    target: string;
    logLevel: 'silent';
  }) => { outputFiles: Array<{ text: string }> };
};

const compiled = esbuild.buildSync({
  stdin: {
    contents: "import { handleDisneyMediaSeek, installDisneyMain } from './main'; export { handleDisneyMediaSeek, installDisneyMain };",
    resolveDir: SRC,
    sourcefile: 'disney-clock-browser-entry.ts',
    loader: 'ts'
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'DisneyMain',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'silent'
}).outputFiles[0].text;

type ClockReport = {
  catalog: { intervals: number; watchdogs: number; any: number };
  afterPush: { intervals: number; watchdogs: number; any: number };
  mounting: { intervals: number; watchdogs: number };
  native: { intervals: number; watchdogs: number };
  silent: { intervals: number; watchdogs: number };
  hidden: { intervals: number; watchdogs: number };
  disabled: { intervals: number; watchdogs: number };
  seeking: { intervals: number; watchdogs: number };
  settled: { intervals: number; watchdogs: number; playhead: string | null; sought: boolean };
};

for (const engine of ['chromium', 'firefox'] as const) {
  describe(`${engine} Disney playback clock`, () => {
    it('keeps timers off the catalog and arms the fallback only while native time is missing', async (t) => {
      const browserType = (await import('playwright'))[engine];
      let executable = '';
      try {
        executable = browserType.executablePath();
      } catch {
        t.skip(`${engine} module or browser path is unavailable`);
        return;
      }
      if (!existsSync(executable)) {
        t.skip(`${engine} is not installed`);
        return;
      }
      const browser = await browserType.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.route('https://www.disneyplus.com/**', (route) => {
          if (route.request().resourceType() !== 'document') return route.abort();
          return route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><html><body></body></html>'
          });
        });
        await page.goto('https://www.disneyplus.com/browse', { waitUntil: 'domcontentloaded' });
        await page.addScriptTag({ content: 'globalThis.__name = fn => fn;\n' + compiled });
        const report = await page.evaluate(async (playId: string) => {
          const FALLBACK_MS = 250;
          const STALE_MS = 400;
          const intervals = new Map<number, number>();
          const timeouts = new Map<number, number>();
          const origSetInterval = window.setInterval.bind(window);
          const origClearInterval = window.clearInterval.bind(window);
          const origSetTimeout = window.setTimeout.bind(window);
          const origClearTimeout = window.clearTimeout.bind(window);
          window.setInterval = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
            const id = origSetInterval(fn as () => void, ms, ...args) as unknown as number;
            intervals.set(id, ms ?? 0);
            return id;
          }) as typeof window.setInterval;
          window.clearInterval = ((id?: number) => {
            if (typeof id === 'number') intervals.delete(id);
            return origClearInterval(id);
          }) as typeof window.clearInterval;
          window.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
            let id = 0;
            id = origSetTimeout(() => {
              timeouts.delete(id);
              if (typeof fn === 'function') fn(...args as []);
            }, ms) as unknown as number;
            timeouts.set(id, ms ?? 0);
            return id;
          }) as typeof window.setTimeout;
          window.clearTimeout = ((id?: number) => {
            if (typeof id === 'number') timeouts.delete(id);
            return origClearTimeout(id);
          }) as typeof window.clearTimeout;
          const clockOf = (delays: Map<number, number>, delay: number) => (
            [...delays.values()].filter((ms) => ms === delay).length
          );
          const snapshot = (every = false) => ({
            intervals: clockOf(intervals, FALLBACK_MS),
            watchdogs: clockOf(timeouts, STALE_MS),
            ...(every ? { any: intervals.size + timeouts.size } : {})
          });
          const wait = (ms: number) => new Promise((resolve) => { origSetTimeout(resolve, ms); });
          const api = (window as unknown as {
            DisneyMain: {
              installDisneyMain: () => void;
              handleDisneyMediaSeek: (
                detail: { time?: number; resumeAfterSeek?: boolean },
                video: Element | null
              ) => boolean;
            };
          }).DisneyMain;

          api.installDisneyMain();
          const catalog = snapshot(true);
          history.pushState({}, '', `/play/${playId}`);
          const afterPush = snapshot(true);

          const shell = document.createElement('disney-web-player');
          const video = document.createElement('video');
          video.className = 'hive-video';
          video.style.cssText = 'width:640px;height:360px';
          shell.append(video);
          document.body.append(shell);
          Object.defineProperty(video, 'currentSrc', { configurable: true, get: () => 'https://www.disneyplus.com/media.mp4' });
          let paused = true;
          Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
          video.play = () => {
            paused = false;
            return Promise.resolve();
          };
          video.pause = () => { paused = true; };
          window.dispatchEvent(new CustomEvent('theater-everywhere-disney-harvest'));
          const mounting = snapshot();

          const listeners: Record<string, () => void> = {};
          const player = {
            seek(_ms: number) {
              // The host seek lands later. The fallback interval has to notice.
            },
            play() { paused = false; },
            pause() { paused = true; },
            on(name: string, fn: () => void) { listeners[name] = fn; },
            timeline: { info: { playheadPositionMs: 5_000 } },
            getPlayheadTime() { return this.timeline.info.playheadPositionMs / 1000; }
          };
          (video as HTMLVideoElement & { mediaPlayer?: typeof player }).mediaPlayer = player;
          await wait(400);
          paused = false;
          video.dispatchEvent(new Event('play'));
          const emit = () => listeners['@EVENT/PLAYER/TIMECODE']?.();
          emit();
          const emitter = origSetInterval(emit, 200);
          await wait(900);
          const native = snapshot();
          origClearInterval(emitter);
          await wait(500);
          const silent = snapshot();

          let hidden = false;
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
          hidden = true;
          document.dispatchEvent(new Event('visibilitychange'));
          const hiddenReport = snapshot();

          hidden = false;
          document.dispatchEvent(new Event('visibilitychange'));
          document.documentElement.setAttribute('data-te-disney-integration-off', '');
          await wait(0);
          const disabled = snapshot();

          document.documentElement.removeAttribute('data-te-disney-integration-off');
          paused = true;
          video.dispatchEvent(new Event('pause'));
          player.timeline.info.playheadPositionMs = 5_000;
          const sought = api.handleDisneyMediaSeek({ time: 40, resumeAfterSeek: false }, video);
          await wait(300);
          const seeking = snapshot();
          player.timeline.info.playheadPositionMs = 40_000;
          await wait(600);
          const settled = snapshot();
          return {
            catalog,
            afterPush,
            mounting,
            native,
            silent,
            hidden: hiddenReport,
            disabled,
            seeking,
            settled: { ...settled, playhead: video.dataset.teDisneyPlayhead ?? null, sought }
          };
        }, PLAY_ID) as ClockReport;

        assert.deepEqual(report.catalog, { intervals: 0, watchdogs: 0, any: 0 });
        assert.deepEqual(report.afterPush, { intervals: 0, watchdogs: 0, any: 0 });
        assert.equal(report.mounting.intervals > 0, true);
        assert.equal(report.native.intervals, 0);
        assert.equal(report.silent.intervals > 0, true);
        assert.equal(report.hidden.intervals, 0);
        assert.equal(report.hidden.watchdogs, 0);
        assert.equal(report.disabled.intervals, 0);
        assert.equal(report.disabled.watchdogs, 0);
        assert.equal(report.seeking.intervals > 0, true);
        assert.equal(report.settled.sought, true);
        assert.equal(report.settled.playhead, '40');
        assert.equal(report.settled.intervals, 0);
      } finally {
        await browser.close();
      }
    });
  });
}
