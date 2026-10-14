import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { Page } from 'playwright';
import { readStylesheet } from '../test-utils/styles';
import { ownTestBrowser } from '../test-utils/test-browser';

const require = createRequire(import.meta.url);
const SRC = new URL('../', import.meta.url).pathname;
const CSS = readStylesheet(path.join(SRC, 'content.css'));
const VOD = readFileSync(new URL('../../test/fixtures/vod.webm', import.meta.url)).toString('base64');
const esbuild = require('esbuild') as { buildSync(options: object): { outputFiles: Array<{ text: string }> } };
const BUNDLE = esbuild.buildSync({
  stdin: {
    contents: [
      "export { bootstrapPlayerRuntime } from './ui/player-runtime';",
      "export { setPlayerUiCss } from './ui/root';",
      "export { playbackWindow } from './playback-window';"
    ].join('\n'),
    resolveDir: SRC, loader: 'ts'
  },
  bundle: true, write: false, format: 'iife', globalName: 'PlaybackChromeTest',
  platform: 'browser', target: 'es2022', logLevel: 'silent'
}).outputFiles[0].text;

const FIXTURE = `<!doctype html><html><head><title>Playback chrome fixture</title>
  <style>body { margin:0; background:#111; } video { width:960px; height:540px; }</style>
  </head><body><video id="player" title="Playback chrome" muted playsinline src="data:video/webm;base64,${VOD}"></video>
  </body></html>`;

/** Boots theater on the paused VOD clip; `keepControlsVisible: false` lets the bar auto-hide. */
async function boot(page: Page, keepControlsVisible: boolean): Promise<void> {
  await page.evaluate(`window.chrome = { storage: {
    sync: {
      get: async () => ({ keepControlsVisible: ${keepControlsVisible}, shortcuts: { playPause: 'k' } }),
      set: async () => {}
    },
    onChanged: { addListener() {} }
  } };`);
  // tsx wraps named functions in __name(); the serialized page callbacks need it defined.
  await page.addScriptTag({ content: 'window.__name = (fn) => fn;' });
  await page.addStyleTag({ content: CSS });
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(`PlaybackChromeTest.setPlayerUiCss(${JSON.stringify(CSS)}); PlaybackChromeTest.bootstrapPlayerRuntime();`);
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return Boolean(video && video.readyState >= 2 && Number.isFinite(video.duration));
  });
  await page.evaluate(() => { document.querySelector('video')!.pause(); });
  await page.keyboard.press('t');
  await page.locator('.theater-controls-wrapper.visible').waitFor();
}

/** Counts `video.duration` reads; every playback snapshot reads it a fixed number of times. */
async function instrumentDurationReads(page: Page): Promise<number> {
  return page.evaluate(() => {
    const video = document.querySelector('video')!;
    const native = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration')!.get!;
    const w = window as unknown as {
      __reads: number;
      __duration: () => number;
      PlaybackChromeTest: { playbackWindow(video: HTMLVideoElement): unknown };
    };
    w.__reads = 0;
    w.__duration = () => native.call(video);
    Object.defineProperty(video, 'duration', { configurable: true, get: () => { w.__reads++; return w.__duration(); } });
    w.__reads = 0;
    w.PlaybackChromeTest.playbackWindow(video);
    const perSnapshot = w.__reads;
    w.__reads = 0;
    return perSnapshot;
  });
}

const reads = (page: Page) => page.evaluate(() => (window as unknown as { __reads: number }).__reads);
const resetReads = (page: Page) => page.evaluate(() => { (window as unknown as { __reads: number }).__reads = 0; });

/** The painted bar, read straight from the player's shadow root. */
const barState = (page: Page) => page.evaluate(() => {
  const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
  const clock = (selector: string) => [...root.querySelectorAll<HTMLElement>(`${selector} .theater-time-slot`)]
    .map(slot => slot.dataset.ch ?? '').join('');
  const elapsed = root.querySelector<HTMLElement>('.theater-time-elapsed')!;
  return {
    fill: root.querySelector<HTMLElement>('.theater-scrubber-fill')!.style.width,
    buffer: root.querySelector<HTMLElement>('.theater-scrubber-buffer')!.style.width,
    elapsed: elapsed.classList.contains('theater-time-live') ? 'LIVE' : clock('.theater-time-elapsed'),
    behindLive: elapsed.classList.contains('theater-time-live-behind'),
    edge: clock('.theater-time-end')
  };
});

async function snapshot(page: Page, name: string): Promise<void> {
  const dir = process.env.THEATER_CHROME_SCREENSHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

describe('playback chrome updates', () => {
  for (const engine of ['chromium', 'firefox'] as const) {
    it(`reads one playback snapshot per update and defers a hidden bar in ${engine}`, { timeout: 90_000 }, async t => {
      const browserType = (await import('playwright'))[engine];
      assert.ok(existsSync(browserType.executablePath()), `${engine} must be installed`);
      const browser = await browserType.launch({ headless: true });
      ownTestBrowser(t, browser);
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('http://playback-chrome.test/**', route => route.fulfill({ contentType: 'text/html', body: FIXTURE }));
      await page.goto('http://playback-chrome.test/');
      await boot(page, false);
      const perSnapshot = await instrumentDurationReads(page);
      assert.ok(perSnapshot > 0, 'a playback window must read the element duration');

      // Visible: every chrome event shares one snapshot instead of four.
      await page.mouse.move(640, 300);
      await page.locator('.theater-controls-wrapper.visible').waitFor();
      for (const type of ['timeupdate', 'progress', 'seeked']) {
        await resetReads(page);
        await page.evaluate(name => document.querySelector('video')!.dispatchEvent(new Event(name)), type);
        assert.equal(await reads(page), perSnapshot, `${type} must read the playback window once`);
      }
      await snapshot(page, `${engine}-vod-visible`);

      // Hidden: the cosmetic writes wait, and so do their reads.
      await page.mouse.move(640, 300);
      await page.locator('.theater-controls-wrapper:not(.visible)').waitFor({ timeout: 8_000 });
      const hiddenBefore = await barState(page);
      await page.evaluate(() => {
        const video = document.querySelector('video')!;
        video.currentTime = 1;
      });
      await page.waitForFunction(() => Math.abs(document.querySelector('video')!.currentTime - 1) < 0.2);
      await resetReads(page);
      await page.evaluate(() => {
        const video = document.querySelector('video')!;
        for (const name of ['timeupdate', 'progress', 'seeked']) video.dispatchEvent(new Event(name));
      });
      assert.equal(await reads(page), 0, 'a hidden bar must not read the playback window');
      assert.deepEqual(await barState(page), hiddenBefore, 'a hidden bar must not be repainted');

      // Showing it presents the current state in the same task, before the fade starts.
      const shown = await page.evaluate(() => new Promise<{ fill: string; elapsed: string }>(resolve => {
        const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
        const wrapper = root.querySelector<HTMLElement>('.theater-controls-wrapper')!;
        const observer = new MutationObserver(() => {
          if (!wrapper.classList.contains('visible')) return;
          observer.disconnect();
          const slots = [...root.querySelectorAll<HTMLElement>('.theater-time-elapsed .theater-time-slot')];
          resolve({
            fill: root.querySelector<HTMLElement>('.theater-scrubber-fill')!.style.width,
            elapsed: slots.map(slot => slot.dataset.ch ?? '').join('')
          });
        });
        observer.observe(wrapper, { attributes: true, attributeFilter: ['class'] });
        document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
      }));
      assert.equal(shown.elapsed, '0:01');
      assert.ok(Number.parseFloat(shown.fill) > 30, `scrubber must show the current time, got ${shown.fill}`);
      assert.notEqual(shown.fill, hiddenBefore.fill);
      await snapshot(page, `${engine}-vod-hidden-then-shown`);

      assert.deepEqual(errors, []);
    });

    it(`presents the current live DVR window when a hidden bar is shown in ${engine}`, { timeout: 90_000 }, async t => {
      const browserType = (await import('playwright'))[engine];
      assert.ok(existsSync(browserType.executablePath()), `${engine} must be installed`);
      const browser = await browserType.launch({ headless: true });
      ownTestBrowser(t, browser);
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('http://playback-chrome.test/**', route => route.fulfill({ contentType: 'text/html', body: FIXTURE }));
      await page.goto('http://playback-chrome.test/');
      await boot(page, false);
      // A DVR stream: unbounded duration with a sliding seekable window.
      await page.evaluate(() => {
        const video = document.querySelector('video')!;
        const w = window as unknown as { __dvr: { start: number; end: number } };
        w.__dvr = { start: 1000, end: 1600 };
        Object.defineProperty(video, 'duration', { configurable: true, get: () => Infinity });
        Object.defineProperty(video, 'currentTime', { configurable: true, get: () => 1599, set: () => {} });
        Object.defineProperty(video, 'seekable', {
          configurable: true,
          get: () => ({ length: 1, start: () => w.__dvr.start, end: () => w.__dvr.end })
        });
        video.dispatchEvent(new Event('durationchange'));
      });
      await page.mouse.move(640, 300);
      await page.locator('.theater-controls-wrapper.visible').waitFor();
      await snapshot(page, `${engine}-live-dvr-visible`);
      assert.equal((await barState(page)).elapsed, 'LIVE');

      await page.mouse.move(640, 300);
      await page.locator('.theater-controls-wrapper:not(.visible)').waitFor({ timeout: 8_000 });
      // The window slides away while the bar is hidden; the playhead is now far behind.
      await page.evaluate(() => {
        (window as unknown as { __dvr: { start: number; end: number } }).__dvr = { start: 1400, end: 2000 };
        document.querySelector('video')!.dispatchEvent(new Event('timeupdate'));
      });
      assert.equal((await barState(page)).behindLive, false, 'hidden bar must not repaint');
      await page.mouse.move(640, 320);
      await page.locator('.theater-controls-wrapper.visible').waitFor();
      const state = await barState(page);
      assert.equal(state.behindLive, true, 'showing the bar must present the current live state');
      assert.ok(Math.abs(Number.parseFloat(state.fill) - 33.2) < 1, `playhead must sit in the slid window, got ${state.fill}`);
      await snapshot(page, `${engine}-live-dvr-hidden-then-shown`);
      assert.deepEqual(errors, []);
    });
  }
});
