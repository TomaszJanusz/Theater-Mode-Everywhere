import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { bootPlayer, enterTheater } from '../test-utils/player-boot';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { testEngines } from '../test-utils/test-engines';
import { vodVideoFixture } from '../test-utils/video-fixtures';

const FIXTURE = vodVideoFixture({ title: 'Speed shortcuts', pageTitle: 'Speed shortcuts fixture' });

async function boot(page: Page): Promise<void> {
  await page.route('http://speed-shortcuts.test/**', route => route.fulfill({ contentType: 'text/html', body: FIXTURE }));
  await page.goto('http://speed-shortcuts.test/');
  await bootPlayer(page);
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return Boolean(video && video.readyState >= 2 && Number.isFinite(video.duration));
  });
  await page.evaluate(() => {
    const video = document.querySelector('video')!;
    video.pause();
    // The fixture clip is a few seconds long, so record each requested seek rather than the clamped position.
    const native = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')!;
    const seeks: number[] = [];
    (window as unknown as { __seeks: number[] }).__seeks = seeks;
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => native.get!.call(video),
      set: (value: number) => { seeks.push(value); native.set!.call(video, value); }
    });
  });
  await enterTheater(page);
}

const playback = (page: Page) => page.evaluate(() => ({
  seeks: (window as unknown as { __seeks: number[] }).__seeks.length,
  rate: document.querySelector('video')!.playbackRate
}));

describe('playback speed shortcuts', () => {
  for (const engine of testEngines()) {
    const shared = sharedTestBrowser(({ chromium, firefox })[engine]);

    it(`steps the speed with < and >, leaves , and . to frame step in ${engine}`, { timeout: 30_000 }, async t => {
      const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      await boot(page);
      const speedLabel = page.locator('.speed-label');

      await page.keyboard.press('Shift+Period');
      assert.deepEqual(await playback(page), { seeks: 0, rate: 1.25 });
      await speedLabel.filter({ hasText: '1.25x' }).waitFor();
      await page.keyboard.press('Shift+Comma');
      await page.keyboard.press('Shift+Comma');
      assert.equal((await playback(page)).rate, 0.75);

      await page.keyboard.press('Comma');
      await page.keyboard.press('Period');
      assert.deepEqual(await playback(page), { seeks: 2, rate: 0.75 }, ', and . step frames without touching the speed');

      // The speed button remembers the keyboard's speed: off to 1x, then back to 0.75x.
      await page.locator('.speed-btn').click();
      assert.equal((await playback(page)).rate, 1);
      await page.locator('.speed-btn').click();
      assert.equal((await playback(page)).rate, 0.75);
    });

    it(`ignores the speed shortcuts on live playback, like the speed button in ${engine}`, { timeout: 30_000 }, async t => {
      const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      await boot(page);
      // A DVR stream: unbounded duration with a sliding seekable window.
      await page.evaluate(() => {
        const video = document.querySelector('video')!;
        Object.defineProperty(video, 'duration', { configurable: true, get: () => Infinity });
        Object.defineProperty(video, 'seekable', { configurable: true, get: () => ({ length: 1, start: () => 1000, end: () => 1600 }) });
        video.dispatchEvent(new Event('durationchange'));
      });
      await page.mouse.move(640, 300);
      await page.locator('.theater-speed-container').waitFor({ state: 'hidden' });
      await page.keyboard.press('Shift+Period');
      assert.equal((await playback(page)).rate, 1);
    });
  }
});
