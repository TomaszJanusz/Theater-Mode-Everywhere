import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { bootPlayer, enterTheater } from '../test-utils/player-boot';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { testEngines } from '../test-utils/test-engines';
import { serveFixture, vodVideoFixture } from '../test-utils/video-fixtures';

import { TOOLBAR_AUTO_HIDE_DELAY_MS } from './toolbar';

const FIXTURE = vodVideoFixture({ title: 'Ended curtain', pageTitle: 'Ended curtain fixture' });
const CURTAIN = '.theater-ended-curtain';

/** Plays the two-second clip out from just before its end. */
async function playToEnd(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const video = document.querySelector('video')!;
    video.currentTime = video.duration - 0.2;
    await video.play();
  });
  await page.waitForFunction(() => document.querySelector('video')!.ended);
}

/**
 * Holds the page's timers (the curtain's grace, the bar's idle hide) and runs them `ms` ahead; media keeps its own
 * clock. Only page.evaluate reads while held: Playwright's waits poll on frames, which the held clock stops too.
 */
async function runTimers(page: Page, ms: number): Promise<void> {
  // Wall time is fixed at zero while timer ticks flow. A Date.now() read followed by pauseAt(now + 100)
  // races the protocol round trip (especially in Firefox under load); freezing Date removes that race.
  await page.clock.pauseAt(0);
  await page.clock.runFor(ms);
}

const curtainCount = (page: Page) => page.evaluate(selector =>
  document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelectorAll(selector).length ?? 0, CURTAIN);

describe('ended curtain on a generic HTML5 player', () => {
  for (const engine of testEngines()) {
    const shared = sharedTestBrowser(({ chromium, firefox })[engine]);

    it(`covers the picture at the end and leaves on replay, a seek back, new media and exit in ${engine}`, { timeout: 60_000 }, async t => {
      const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      page.setDefaultTimeout(8000);
      // The clock flows in real time until a check holds it.
      await page.clock.install();
      await page.clock.setFixedTime(0);
      await serveFixture(page, FIXTURE);
      await bootPlayer(page, { settings: { keepControlsVisible: false } });
      await page.waitForFunction(() => Boolean(document.querySelector('video')?.readyState && document.querySelector('video')!.readyState >= 2));
      await enterTheater(page);

      // A pause a moment before the end is not an end.
      await page.evaluate(async () => {
        const video = document.querySelector('video')!;
        video.currentTime = video.duration - 0.1;
        await new Promise(done => video.addEventListener('seeked', done, { once: true }));
      });
      await runTimers(page, 2000);
      assert.equal(await curtainCount(page), 0, 'no curtain on a pause near the end');
      await page.clock.resume();

      await playToEnd(page);
      await page.locator(CURTAIN).waitFor();
      const geometry = await page.evaluate(selector => {
        const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
        const box = root.querySelector(selector)!.getBoundingClientRect();
        const video = document.querySelector('video')!.getBoundingClientRect();
        return { curtain: [box.left, box.top, box.width, box.height], video: [video.left, video.top, video.width, video.height],
          background: getComputedStyle(root.querySelector(selector)!).backgroundColor };
      }, CURTAIN);
      assert.deepEqual(geometry.curtain, geometry.video, 'the curtain covers the picture box and nothing else');
      assert.equal(geometry.background, 'rgb(0, 0, 0)');
      assert.equal(await page.locator(`${CURTAIN} button`).first().getAttribute('aria-label'), 'Replay');
      assert.equal(await page.locator('.theater-controls-wrapper .play-pause-btn').getAttribute('aria-label'), 'Replay');

      // The idle hide has its turn and leaves the title and controls up while the curtain shows.
      await page.mouse.move(640, 200);
      await runTimers(page, TOOLBAR_AUTO_HIDE_DELAY_MS * 3);
      assert.deepEqual(await page.evaluate(() => {
        const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
        return [root.querySelector('.theater-controls-wrapper')!.classList.contains('visible'),
          root.querySelector('.theater-everywhere-header-hud')?.classList.contains('visible')];
      }), [true, true], 'the title and controls outlast the idle hide');
      await page.clock.resume();

      // Replay restarts from the beginning and takes the curtain down.
      await page.locator(`${CURTAIN} button`).first().click();
      await page.waitForFunction(() => { const video = document.querySelector('video')!; return !video.paused && !video.ended && video.currentTime < 1.5; });
      await page.locator(CURTAIN).waitFor({ state: 'detached' });
      assert.equal(await page.locator('.theater-controls-wrapper .play-pause-btn').getAttribute('aria-label'), 'Pause');

      // A seek back.
      await playToEnd(page);
      await page.locator(CURTAIN).waitFor();
      await page.evaluate(() => { document.querySelector('video')!.currentTime = 0.5; });
      await page.locator(CURTAIN).waitFor({ state: 'detached' });

      // New media in the same element.
      await playToEnd(page);
      await page.locator(CURTAIN).waitFor();
      await page.evaluate(() => { const video = document.querySelector('video')!; video.src = video.currentSrc; video.load(); });
      await page.locator(CURTAIN).waitFor({ state: 'detached' });
      await page.waitForFunction(() => document.querySelector('video')!.readyState >= 1);

      // Exit tears it down; entering again on media that has ended shows it again.
      await playToEnd(page);
      await page.locator(CURTAIN).waitFor();
      await page.locator('.close-btn').click();
      await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
      assert.equal(await curtainCount(page), 0, 'exit leaves no curtain behind');
      await enterTheater(page);
      await page.locator(CURTAIN).waitFor();
    });
  }
});
