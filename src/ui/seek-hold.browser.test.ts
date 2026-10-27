import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { bootPlayer, enterTheater } from '../test-utils/player-boot';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { testEngines } from '../test-utils/test-engines';
import { vodVideoFixture } from '../test-utils/video-fixtures';

import { SEEK_HOLD_DELAY_MS } from './seek-hold';

const FIXTURE = vodVideoFixture({ title: 'Seek hold', pageTitle: 'Seek hold fixture' });

async function boot(page: Page): Promise<void> {
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
  await page.clock.install();
}

const playback = (page: Page) => page.evaluate(() => ({
  seeks: (window as unknown as { __seeks: number[] }).__seeks.length,
  rate: document.querySelector('video')!.playbackRate
}));

describe('seek forward hold and speed shortcuts', () => {
  for (const engine of testEngines()) {
    const shared = sharedTestBrowser(({ chromium, firefox })[engine]);

    it(`taps seek forward on release, holds play at 2x until released in ${engine}`, { timeout: 30_000 }, async t => {
      const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      await page.route('http://seek-hold.test/**', route => route.fulfill({ contentType: 'text/html', body: FIXTURE }));
      await page.goto('http://seek-hold.test/');
      await boot(page);
      await page.keyboard.down('ArrowRight');
      assert.deepEqual(await playback(page), { seeks: 0, rate: 1 }, 'a press does not seek before the key comes up');
      await page.keyboard.up('ArrowRight');
      assert.deepEqual(await playback(page), { seeks: 1, rate: 1 }, 'a tap seeks once, on release, at normal speed');

      await page.keyboard.down('ArrowRight');
      await page.clock.runFor(SEEK_HOLD_DELAY_MS);
      // Auto-repeats while held neither seek nor stack further changes.
      await page.keyboard.down('ArrowRight');
      await page.keyboard.down('ArrowRight');
      assert.deepEqual(await playback(page), { seeks: 1, rate: 2 });
      await page.keyboard.up('ArrowRight');
      assert.deepEqual(await playback(page), { seeks: 1, rate: 1 }, 'release restores the speed without seeking');

      // Losing focus mid-hold ends it: the keyup will never arrive.
      await page.keyboard.down('ArrowRight');
      await page.clock.runFor(SEEK_HOLD_DELAY_MS);
      assert.equal((await playback(page)).rate, 2);
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      assert.equal((await playback(page)).rate, 1);
      await page.keyboard.up('ArrowRight');
      assert.equal((await playback(page)).seeks, 1, 'the release after a cancelled hold does not seek');
    });

    it(`steps the speed with , and . and keeps a speed chosen during a hold in ${engine}`, { timeout: 30_000 }, async t => {
      const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      await page.route('http://seek-hold.test/**', route => route.fulfill({ contentType: 'text/html', body: FIXTURE }));
      await page.goto('http://seek-hold.test/');
      await boot(page);
      const speedLabel = page.locator('.speed-label');

      await page.keyboard.press('.');
      assert.equal((await playback(page)).rate, 1.25);
      await speedLabel.filter({ hasText: '1.25x' }).waitFor();
      await page.keyboard.press(',');
      await page.keyboard.press(',');
      assert.equal((await playback(page)).rate, 0.75);
      // Shift+, types <, which stays frame step.
      await page.keyboard.press('Shift+Comma');
      assert.equal((await playback(page)).rate, 0.75);

      await page.keyboard.down('ArrowRight');
      await page.clock.runFor(SEEK_HOLD_DELAY_MS);
      assert.equal((await playback(page)).rate, 2);
      await page.keyboard.press(',');
      assert.equal((await playback(page)).rate, 1.75);
      await page.keyboard.up('ArrowRight');
      assert.equal((await playback(page)).rate, 1.75, 'a speed picked during the hold is kept on release');

      await page.keyboard.down('ArrowRight');
      await page.clock.runFor(SEEK_HOLD_DELAY_MS);
      await page.keyboard.press('Escape');
      await page.locator('.theater-controls-wrapper').waitFor({ state: 'detached' });
      assert.equal((await playback(page)).rate, 1.75, 'leaving theater mid-hold restores the speed');
    });
  }
});
