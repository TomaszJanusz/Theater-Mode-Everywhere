import { readFileSync } from 'node:fs';
import path from 'node:path';

import { type BrowserContext, type Page } from 'playwright';

import { shouldOfferVideoActivator } from '../../src/ui/video-activator-settings';

import { waitForPlayer, theaterEntered, ROOT, timeScenario } from './helpers';
import { declineVideoActivatorPrompt } from './helpers';
export async function assertAutoTheater(page: Page, context: BrowserContext): Promise<void> {
  return timeScenario('assertAutoTheater', { syncWrites: 7 }, async () => {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const fixture = readFileSync(path.join(ROOT, 'test/fixtures/youtube-watch.html'), 'utf8');
    await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
    await context.route('https://player.vimeo.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture
      .replace('class="html5-video-player"', 'class="player"')
      .replace("player.contentId = new URL(location.href).searchParams.get('v');", "window.playerConfig = { video: { id: 123456 } }; player.contentId = '123456';") }));
    const url = 'https://www.youtube.com/watch?v=abcdefghijk&state=3';
    const playEvent = async () => {
      await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('video#player')!.readyState > 2);
      await page.locator('video#player').evaluate((video: HTMLVideoElement) => {
        video.dispatchEvent(new Event('playing'));
      });
    };
    const assertIdle = async (reason: string) => {
      // MAIN query and entry are synchronous; a second evaluation observes the
      // mutation microtasks queued by the playing event.
      await playEvent();
      await page.evaluate(() => Promise.resolve());
      if (await theaterEntered(page)) throw new Error(`Auto theater entered for ${reason}`);
    };
    const waitEntered = () => page.waitForFunction(() => document.documentElement.classList.contains('theater-everywhere-html-active'));
    const waitIdle = () => page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
    try {
      // A fresh profile has no saved key: AutoTheater defaults to on in the options and the page.
      await worker.evaluate(() => chrome.storage.sync.remove('autoEnterTheater'));
      const defaults = await context.newPage();
      try {
        await defaults.goto(new URL('options/options.html', worker.url()).href);
        await defaults.locator('#tab-features').click();
        // The toggles are filled from storage after the page loads: on by default means waiting for it to read on.
        await defaults.waitForFunction(() => (document.getElementById('auto-enter-theater-toggle') as HTMLInputElement | null)?.checked);
      } finally {
        await defaults.close();
      }
      await page.goto(url);
      await waitForPlayer(page);
      await playEvent();
      await waitEntered();
      await page.keyboard.press('Escape');
      await waitIdle();
      // The installed countdown notice has now been proven once; the countdown itself is
      // covered by the AutoTheater browser suites, so later entries skip its 5 s minimum.
      await worker.evaluate(() => chrome.storage.sync.set({ autoTheaterSkipCountdown: true }));

      await worker.evaluate(() => chrome.storage.sync.set({ autoEnterTheater: false }));
      await page.goto(url);
      await waitForPlayer(page);
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
      await assertIdle('disabled setting');
      // The actual options toggle persists and live-enables an already playing video.
      const options = await context.newPage();
      try {
        await options.goto(new URL('options/options.html', worker.url()).href);
        await options.locator('#tab-features').click();
        const toggle = options.locator('#auto-enter-theater-toggle');
        // Off is also the unfilled state; the saved-on countdown toggle marks that storage has been read.
        await options.waitForFunction(() => (document.getElementById('auto-theater-skip-countdown-toggle') as HTMLInputElement | null)?.checked);
        if (await toggle.isChecked()) throw new Error('Saved AutoTheater off must stay off in the options');
        await options.locator('label.toggle-switch').filter({ has: toggle }).click();
        await options.waitForFunction(async () => (await chrome.storage.sync.get('autoEnterTheater')).autoEnterTheater === true);
        await waitEntered();
        const gear = page.locator('.player-settings-btn');
        await gear.press('Enter');
        const auto = page.locator('.auto-theater-btn');
        await auto.waitFor({ state: 'visible' });
        if (await auto.getAttribute('data-active') !== 'true') throw new Error('Player menu did not reflect the options preference');
        if (process.env.THEATER_SMOKE_SCREENSHOT) {
          await page.screenshot({ path: process.env.THEATER_SMOKE_SCREENSHOT.replace(/\.png$/, '-auto-entry.png') });
        }
        const offerLauncher = shouldOfferVideoActivator(await worker.evaluate(() =>
          chrome.storage.sync.get(['videoActivator', 'videoActivatorPromptAnswer'])));
        // The row is a two-option stepper: the lower arrow turns it off, the upper one back on.
        await auto.locator('[data-direction="-1"]').press('Enter');
        await options.waitForFunction(() => !(document.getElementById('auto-enter-theater-toggle') as HTMLInputElement).checked);
        await options.waitForFunction(async () => (await chrome.storage.sync.get('autoEnterTheater')).autoEnterTheater === false);
        // This path also runs alone with a fresh profile, before the controls smoke.
        if (offerLauncher) {
          await declineVideoActivatorPrompt(page);
          await options.waitForFunction(async () => (await chrome.storage.sync.get('videoActivatorPromptAnswer')).videoActivatorPromptAnswer === false);
        }
        await auto.locator('[data-direction="1"]').press('Space');
        await options.waitForFunction(() => (document.getElementById('auto-enter-theater-toggle') as HTMLInputElement).checked);
        await options.waitForFunction(async () => (await chrome.storage.sync.get('autoEnterTheater')).autoEnterTheater === true);
        if (await auto.getAttribute('data-active') !== 'true') throw new Error('Player menu did not retain the enabled preference');
        await page.keyboard.press('Escape'); // Close only the settings panel.
      } finally {
        await options.close();
      }
      await page.keyboard.press('Escape');
      await waitIdle();
      // New document rehydrates the saved setting through the installed MAIN/isolated bridge.
      await page.goto(url);
      await waitEntered();
      await page.keyboard.press('Escape');
      await waitIdle();

      // A supported provider in a child frame must not send FRAME_ENTER upwards.
      await page.goto('https://www.youtube.com/');
      await page.locator('video#player').evaluate(video => video.remove());
      await page.evaluate(() => {
        const child = document.createElement('iframe');
        child.id = 'auto-child'; child.src = '/watch?v=abcdefghijk';
        document.body.appendChild(child);
      });
      const child = page.frameLocator('#auto-child');
      await child.locator('video#player').waitFor();
      await child.locator('video#player').evaluate((video: HTMLVideoElement) => video.dispatchEvent(new Event('playing')));
      await child.locator('html[data-theater-everywhere-entry-shortcuts]').waitFor();
      if (await child.locator('video#player').evaluate(video => video.classList.contains('theater-everywhere-video-active'))
          || await theaterEntered(page)) throw new Error('Auto theater entered inside an iframe');

      await page.goto('https://player.vimeo.com/video/123456');
      await waitForPlayer(page);
      await waitEntered();
      await page.keyboard.press('Escape');
      await waitIdle();
      console.log('smoke:chromium installed auto theater: options/menu sync, saved setting, MAIN providers, iframe exclusion and exit passed');
    } finally {
      await worker.evaluate(() => chrome.storage.sync.remove(['autoEnterTheater', 'autoTheaterSkipCountdown', 'youtubeIntegrationEnabled', 'blacklist']));
      await context.unroute('https://www.youtube.com/**');
      await context.unroute('https://player.vimeo.com/**');
    }
  });
}
