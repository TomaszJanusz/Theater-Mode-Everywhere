import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chromium, firefox, type Frame, type Page } from 'playwright';

import { emitStorageChange } from '../test-utils/chrome-stub';
import { bootPlayer, enterTheater } from '../test-utils/player-boot';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { testEngines } from '../test-utils/test-engines';
import { vodVideoFixture } from '../test-utils/video-fixtures';

import { HUD_FADE_OUT_MS } from './hud-plate';
import { SEEK_HOLD_DELAY_MS } from './seek-hold';

const FIXTURE = vodVideoFixture({ title: 'Seek hold', pageTitle: 'Seek hold fixture' });

/** Pauses the fixture clip and records each requested seek: the clip is a few seconds long, so positions clamp. */
async function recordSeeks(frame: Page | Frame): Promise<void> {
  await frame.waitForFunction(() => {
    const video = document.querySelector('video');
    return Boolean(video && video.readyState >= 2 && Number.isFinite(video.duration));
  });
  await frame.evaluate(() => {
    const video = document.querySelector('video')!;
    video.pause();
    const native = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')!;
    const seeks: number[] = [];
    (window as unknown as { __seeks: number[] }).__seeks = seeks;
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => native.get!.call(video),
      set: (value: number) => { seeks.push(value); native.set!.call(video, value); }
    });
  });
}

/** The fixture in theater mode on a fake clock, so the hold delay passes only when a test runs it. */
async function boot(page: Page, settings: Record<string, unknown> = {}): Promise<void> {
  await page.route('http://seek-hold.test/**', route => route.fulfill({ contentType: 'text/html', body: FIXTURE }));
  await page.goto('http://seek-hold.test/');
  await bootPlayer(page, { settings });
  await recordSeeks(page);
  await enterTheater(page);
  // Paused: real time between two test steps must not count towards the hold delay.
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
}

const playback = (frame: Page | Frame) => frame.evaluate(() => ({
  seeks: (window as unknown as { __seeks: number[] }).__seeks.length,
  rate: document.querySelector('video')!.playbackRate
}));

const statusHud = (page: Page) => page.locator('.status-hud');

/** The status HUD's text, and whether it is on its way out; null without one. */
const hud = async (page: Page) => await statusHud(page).count()
  ? statusHud(page).evaluate(el => ({ text: el.textContent?.trim(), fading: el.classList.contains('fade-out') }))
  : null;

/** A keydown the browser sends without a keyup before it, as after a release the page never saw. */
const pressAgain = (page: Page, init: { key: string; code: string }) => page.evaluate(init => {
  (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true, composed: true }));
}, init);

const makeLive = (page: Page) => page.evaluate(() => {
  // A DVR stream: unbounded duration with a sliding seekable window.
  const video = document.querySelector('video')!;
  Object.defineProperty(video, 'duration', { configurable: true, get: () => Infinity });
  Object.defineProperty(video, 'seekable', { configurable: true, get: () => ({ length: 1, start: () => 1000, end: () => 1600 }) });
  video.dispatchEvent(new Event('durationchange'));
});

const playbackHint = (page: Page) => page.locator('.theater-help-group[data-group="playback"] .theater-help-hint');

describe('holding seek forward plays at 2x', () => {
  for (const engine of testEngines()) {
    const shared = sharedTestBrowser(({ chromium, firefox })[engine]);
    const newPage = async (t: Parameters<typeof shared.newContext>[0]) =>
      (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();

    it(`seeks on key down for a tap, and plays at 2x only while the key is held in ${engine}`, { timeout: 30_000 }, async t => {
      const page = await newPage(t);
      await boot(page);

      await page.keyboard.down('ArrowRight');
      assert.deepEqual(await playback(page), { seeks: 1, rate: 1 }, 'a press seeks at once');
      await page.clock.runFor(SEEK_HOLD_DELAY_MS - 20);
      await page.keyboard.up('ArrowRight');
      await page.clock.runFor(1000);
      assert.deepEqual(await playback(page), { seeks: 1, rate: 1 }, 'a tap never reaches 2x');
      assert.equal(await hud(page), null, 'a tap shows no 2x notice');

      await page.evaluate(() => { document.querySelector('video')!.playbackRate = 1.25; });
      await page.keyboard.down('ArrowRight');
      await page.clock.runFor(SEEK_HOLD_DELAY_MS);
      assert.deepEqual(await playback(page), { seeks: 2, rate: 2 });
      assert.deepEqual(await hud(page), { text: '2x', fading: false });
      // Auto-repeats while held neither seek nor change the speed, and the notice outlasts its usual time.
      await page.keyboard.down('ArrowRight');
      await page.keyboard.down('ArrowRight');
      await page.clock.runFor(5000);
      assert.deepEqual(await playback(page), { seeks: 2, rate: 2 });
      assert.deepEqual(await hud(page), { text: '2x', fading: false });
      await page.keyboard.up('ArrowRight');
      assert.deepEqual(await playback(page), { seeks: 2, rate: 1.25 }, 'release restores the speed without seeking');
      assert.deepEqual(await hud(page), { text: '2x', fading: true }, 'the notice fades rather than vanishing');
      await page.clock.runFor(HUD_FADE_OUT_MS);
      assert.equal(await hud(page), null);
    });

    it(`keeps a speed chosen during the hold, and the speed button forgets the hold's 2x in ${engine}`, { timeout: 30_000 }, async t => {
      const page = await newPage(t);
      await boot(page);

      await page.keyboard.down('ArrowRight');
      await page.clock.runFor(SEEK_HOLD_DELAY_MS);
      await page.keyboard.up('ArrowRight');
      assert.equal((await playback(page)).rate, 1);
      // The button toggles between 1x and the last speed the user chose; the hold's 2x is not one.
      await page.locator('.speed-btn').click();
      assert.equal((await playback(page)).rate, 1.5);
      await page.locator('.speed-btn').click();
      assert.equal((await playback(page)).rate, 1);

      await page.keyboard.down('ArrowRight');
      await page.clock.runFor(SEEK_HOLD_DELAY_MS);
      await page.keyboard.press('Shift+Comma');
      assert.equal((await playback(page)).rate, 1.75);
      await page.keyboard.up('ArrowRight');
      assert.equal((await playback(page)).rate, 1.75, 'a speed picked during the hold is kept on release');
    });

    it(`ends a hold without seeking on blur, a lost keyup and exit in ${engine}`, { timeout: 30_000 }, async t => {
      const page = await newPage(t);
      await boot(page);

      await page.keyboard.down('ArrowRight');
      await page.clock.runFor(SEEK_HOLD_DELAY_MS);
      assert.equal((await playback(page)).rate, 2);
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      assert.deepEqual(await playback(page), { seeks: 1, rate: 1 }, 'without focus the release never comes');
      await page.keyboard.up('ArrowRight');
      assert.deepEqual(await playback(page), { seeks: 1, rate: 1 });

      await page.keyboard.down('ArrowRight');
      await page.clock.runFor(SEEK_HOLD_DELAY_MS);
      // The keyup went missing: the next press ends the hold, then seeks as a fresh press.
      await pressAgain(page, { key: 'ArrowRight', code: 'ArrowRight' });
      assert.deepEqual(await playback(page), { seeks: 3, rate: 1 });
      await page.clock.runFor(SEEK_HOLD_DELAY_MS);
      assert.equal((await playback(page)).rate, 2, 'the fresh press can hold again');

      await page.keyboard.press('Escape');
      await page.locator('.theater-controls-wrapper').waitFor({ state: 'detached' });
      assert.deepEqual(await playback(page), { seeks: 3, rate: 1 }, 'leaving theater mid-hold restores the speed');
      await page.keyboard.up('ArrowRight');
    });

    it(`keeps auto-repeat seeking on live playback and with the setting off in ${engine}`, { timeout: 30_000 }, async t => {
      const live = await newPage(t);
      await boot(live);
      await makeLive(live);
      await live.mouse.move(640, 300);
      await live.locator('.theater-speed-container').waitFor({ state: 'hidden' });
      await live.keyboard.down('ArrowRight');
      await live.keyboard.down('ArrowRight');
      await live.clock.runFor(SEEK_HOLD_DELAY_MS);
      assert.equal((await playback(live)).rate, 1, 'live speed stays fixed');
      assert.equal(await hud(live), null);
      await live.keyboard.up('ArrowRight');

      const off = await newPage(t);
      await boot(off, { seekForwardHold: false });
      await off.keyboard.down('ArrowRight');
      await off.keyboard.down('ArrowRight');
      await off.clock.runFor(SEEK_HOLD_DELAY_MS);
      await off.keyboard.down('ArrowRight');
      assert.deepEqual(await playback(off), { seeks: 3, rate: 1 }, 'off restores the old repeat seeking');
      await off.keyboard.up('ArrowRight');
      await off.keyboard.press('h');
      await off.locator('.theater-help-overlay').waitFor();
      assert.equal(await playbackHint(off).count(), 0, 'the help mentions the hold only while it is on');
      await off.keyboard.press('Escape');

      // Turning the setting off mid-hold ends that hold.
      await emitStorageChange(off, { seekForwardHold: { oldValue: false, newValue: true } });
      await off.keyboard.down('ArrowRight');
      await off.clock.runFor(SEEK_HOLD_DELAY_MS);
      assert.equal((await playback(off)).rate, 2);
      await emitStorageChange(off, { seekForwardHold: { oldValue: true, newValue: false } });
      await off.waitForFunction(() => document.querySelector('video')!.playbackRate === 1);
      await off.keyboard.up('ArrowRight');
    });

    it(`holds whatever key Seek Forward is bound to, combinations included in ${engine}`, { timeout: 30_000 }, async t => {
      const page = await newPage(t);
      await boot(page, { shortcuts: { seekForward: 'J' } });

      await page.keyboard.down('ArrowRight');
      await page.clock.runFor(SEEK_HOLD_DELAY_MS);
      await page.keyboard.up('ArrowRight');
      assert.deepEqual(await playback(page), { seeks: 0, rate: 1 }, 'the old default no longer seeks or holds');

      await page.keyboard.down('j');
      assert.equal((await playback(page)).seeks, 1);
      await page.clock.runFor(SEEK_HOLD_DELAY_MS);
      assert.equal((await playback(page)).rate, 2);
      await page.keyboard.up('j');
      assert.deepEqual(await playback(page), { seeks: 1, rate: 1 });

      await page.keyboard.press('h');
      await page.locator('.theater-help-overlay').waitFor();
      assert.match((await playbackHint(page).textContent()) ?? '', /J/, 'the help names the bound key');
      await page.keyboard.press('Escape');
      await page.locator('.theater-help-overlay').waitFor({ state: 'detached' });

      // Rebinding while the old key is held ends the hold; that key's release then does nothing.
      await page.keyboard.down('j');
      await page.clock.runFor(SEEK_HOLD_DELAY_MS);
      assert.equal((await playback(page)).rate, 2);
      await emitStorageChange(page, { shortcuts: { oldValue: { seekForward: 'J' }, newValue: { seekForward: 'Shift+J' } } });
      await page.waitForFunction(() => document.querySelector('video')!.playbackRate === 1);
      await page.keyboard.up('j');
      assert.deepEqual(await playback(page), { seeks: 2, rate: 1 });

      // A combination: the hold belongs to the key that started it, so letting Shift go first keeps it.
      await page.keyboard.down('Shift');
      await page.keyboard.down('J');
      await page.clock.runFor(SEEK_HOLD_DELAY_MS);
      assert.deepEqual(await playback(page), { seeks: 3, rate: 2 });
      await page.keyboard.up('Shift');
      assert.equal((await playback(page)).rate, 2);
      await page.keyboard.up('j');
      assert.deepEqual(await playback(page), { seeks: 3, rate: 1 });
    });

    it(`passes the release of a held key to the theater iframe in ${engine}`, { timeout: 45_000 }, async t => {
      const page = await newPage(t);
      await page.route('http://embedder.test/**', route => route.fulfill({ contentType: 'text/html',
        body: '<body style="margin:0"><iframe src="http://seek-hold.test/" style="width:1200px;height:650px;border:0"></iframe></body>' }));
      await page.route('http://seek-hold.test/**', route => route.fulfill({ contentType: 'text/html', body: FIXTURE }));
      await page.goto('http://embedder.test/');
      const child = page.frames().find(frame => frame !== page.mainFrame())!;
      await child.waitForLoadState();
      await bootPlayer(page);
      await bootPlayer(child);
      await recordSeeks(child);
      await page.keyboard.press('t');
      await page.locator('iframe[data-theater-everywhere]').waitFor({ state: 'attached' });
      await child.locator('video[data-theater-everywhere]').waitFor({ state: 'attached' });
      // The embedding page keeps the keyboard and forwards the claimed keys to the iframe.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      assert.equal(await page.evaluate(() => document.hasFocus() && document.activeElement?.tagName !== 'IFRAME'), true);

      // The child runs on real timers here; the observable rate is what the test waits for.
      await page.keyboard.down('ArrowRight');
      await child.waitForFunction(() => document.querySelector('video')!.playbackRate === 2);
      await page.keyboard.up('ArrowRight');
      await child.waitForFunction(() => document.querySelector('video')!.playbackRate === 1);
      assert.deepEqual(await playback(child), { seeks: 1, rate: 1 }, 'the release ends the hold without seeking');

      await page.keyboard.down('ArrowRight');
      await child.waitForFunction(() => document.querySelector('video')!.playbackRate === 2);
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await child.waitForFunction(() => document.querySelector('video')!.playbackRate === 1);
      await page.keyboard.up('ArrowRight');
      assert.deepEqual(await playback(child), { seeks: 2, rate: 1 }, 'the embedding page losing focus ends it too');
    });
  }
});
