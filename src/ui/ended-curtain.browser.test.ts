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
const NEXT = '.ip-next-episode';
/**
 * A Bilibili.tv episode whose player has the host's own next-episode control, which the provider offers as a service
 * action at the end. The episode attributes stand in for the MAIN-world snapshot.
 */
const HOST_FIXTURE = FIXTURE
  .replace('<video ', `<script>document.documentElement.setAttribute('data-te-bilibili-intl-episode', '11371243');
    document.documentElement.setAttribute('data-te-bilibili-intl-kind', 'ogv');</script><div class="bstar-player"><video `)
  .replace('</video>', '</video><div class="player-mobile-control-btn-next-episode"><div class="ip-next-episode">Next episode</div></div></div>');

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

/** The player's caption overlay: painted, and whether the caption choice still has it on. */
const captions = (page: Page) => page.evaluate(() => {
  const overlay = document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-caption-overlay')!;
  return { painted: getComputedStyle(overlay).visibility === 'visible', on: overlay.classList.contains('visible') };
});

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
      // One cue over the whole clip, so captions are on screen at its end.
      await page.route('http://player-boot.test/**', route => route.fulfill(new URL(route.request().url()).pathname === '/en.vtt'
        ? { contentType: 'text/vtt', body: 'WEBVTT\n\n00:00:00.000 --> 00:01:00.000\nThe last line\n' }
        : { contentType: 'text/html', body: FIXTURE.replace('</video>', '<track kind="subtitles" label="English" srclang="en" src="/en.vtt"></video>') }));
      await page.goto('http://player-boot.test/');
      await bootPlayer(page, { settings: { keepControlsVisible: false } });
      await page.waitForFunction(() => Boolean(document.querySelector('video')?.readyState && document.querySelector('video')!.readyState >= 2));
      await enterTheater(page);
      await page.keyboard.press('c');
      await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')!.shadowRoot!
        .querySelector('.theater-caption-overlay')!.classList.contains('visible'));

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
      assert.deepEqual(await captions(page), { painted: false, on: true }, 'the curtain hides the captions, which stay on');
      assert.equal(await page.locator('.cc-btn').getAttribute('aria-pressed'), 'true');

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
      assert.deepEqual(await captions(page), { painted: true, on: true }, 'captions come back with the picture');

      // A seek back.
      await playToEnd(page);
      await page.locator(CURTAIN).waitFor();
      await page.evaluate(() => { document.querySelector('video')!.currentTime = 0.5; });
      await page.locator(CURTAIN).waitFor({ state: 'detached' });
      assert.deepEqual(await captions(page), { painted: true, on: true }, 'a seek back brings the captions back');

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

describe('ended curtain on a service with its own post-play', () => {
  for (const engine of testEngines()) {
    const shared = sharedTestBrowser(({ chromium, firefox })[engine]);

    it(`yields only while the host offers its next episode, and covers a finale in ${engine}`, { timeout: 60_000 }, async t => {
      const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      page.setDefaultTimeout(8000);
      // The fixture is the only page; nothing reaches the real service.
      await page.route(url => url.hostname !== 'www.bilibili.tv', route => route.abort());
      await page.clock.install();
      await page.clock.setFixedTime(0);
      await serveFixture(page, HOST_FIXTURE, 'https://www.bilibili.tv/en/play/1053337/11371243');
      await bootPlayer(page, { settings: { keepControlsVisible: false } });
      await page.waitForFunction(() => Boolean(document.querySelector('video')?.readyState && document.querySelector('video')!.readyState >= 2));
      await enterTheater(page);
      const setNext = (offered: boolean) => page.evaluate(([selector, hidden]) => {
        document.querySelector<HTMLElement>(selector)!.hidden = hidden;
      }, [NEXT, !offered] as const);
      /** The curtain's absence has no event: run the grace and the host watch's frames ahead, then check. */
      const absent = async (message: string) => {
        await runTimers(page, 2000);
        assert.equal(await curtainCount(page), 0, message);
        await page.clock.resume();
      };

      await playToEnd(page);
      await absent('the host offers its next episode, so its post-play keeps the picture');

      // The host withdraws it (a cancelled countdown), then offers it again while the media stays ended.
      await setNext(false);
      await page.locator(CURTAIN).waitFor();
      await setNext(true);
      await page.locator(CURTAIN).waitFor({ state: 'detached' });

      // A finale: no next episode at the end.
      await setNext(false);
      await page.locator(CURTAIN).waitFor();
      assert.equal(await page.locator(`${CURTAIN} button`).first().getAttribute('aria-label'), 'Replay');
      await page.locator(`${CURTAIN} button`).first().click();
      await page.locator(CURTAIN).waitFor({ state: 'detached' });

      // Replay ended the watch: a next step that appears during playback does nothing until the next end.
      await setNext(true);
      await playToEnd(page);
      await absent('the next end yields again');
      await page.locator('.close-btn').click();
      await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
      assert.equal(await curtainCount(page), 0, 'exit leaves no curtain behind');
    });
  }
});
