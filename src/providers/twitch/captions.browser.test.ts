import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it, type TestContext } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { bootPlayer, enterTheater } from '../../test-utils/player-boot';
import { sharedTestBrowser } from '../../test-utils/test-browser';
import { testEngines } from '../../test-utils/test-engines';
import { serveFixture } from '../../test-utils/video-fixtures';

const VOD_URL = 'https://www.twitch.tv/videos/123';
const VOD = readFileSync(new URL('../../../test/fixtures/vod.webm', import.meta.url)).toString('base64');
const CORS = { 'access-control-allow-origin': '*' };
const EARLY_SAMPLE_MS = 1500;

/**
 * The measured shape of a Twitch VOD player: the aspect box keeps a spacer in flow, the player sits on it, and the overlay
 * holds the closed captions Twitch draws itself. Twitch tells only its own controls that captions exist, seconds after
 * the video starts (`captions.available` in React state, then the Captions button), and remembers "on" across videos.
 */
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>Fixture VOD - Twitch</title><style>
body { margin: 0; background: #111; }
.persistent-player { position: relative; width: 960px; }
.tw-aspect { position: relative; }
.ScAspectSpacer-sc-test { padding-bottom: 56.25%; }
.video-player { position: absolute; inset: 0; }
.video-player__container { position: absolute; inset: 0; }
video { width: 100%; height: 100%; }
.video-player__overlay { position: absolute; inset: 0; }
.player-captions-container { position: absolute; left: 50%; width: 50%; transform: translateX(-50%); color: #fff; }
</style></head><body>
<div class="persistent-player"><div class="tw-aspect"><div class="ScAspectSpacer-sc-test"></div>
<div class="video-player"><div class="video-player__container"><div class="video-ref">
<video muted playsinline src="data:video/webm;base64,${VOD}"></video></div><div class="video-player__overlay"></div></div></div></div></div>
<script>
const root = document.querySelector('.persistent-player');
const overlay = document.querySelector('.video-player__overlay');
const state = { available: false, enabled: location.hash === '#remembered' };
const draw = () => {
  overlay.querySelector('.player-captions-container')?.remove();
  if (state.enabled) overlay.insertAdjacentHTML('beforeend', '<div class="player-captions-container" style="top:auto;bottom:10%"><p>Hello from Twitch</p></div>');
};
root['__reactFiber$fixture'] = { memoizedProps: { captions: state, setClosedCaptionsEnabled(enabled) { state.enabled = enabled; draw(); } } };
draw();
// The test calls this once the harvest's single early sample is behind it: the player learns of the captions later,
// as it does on a real VOD, and the button comes with them.
window.playerLearnsOfCaptions = () => {
  state.available = true;
  overlay.insertAdjacentHTML('beforeend', '<button type="button" aria-label="Captions (c)" aria-haspopup="menu"></button>');
};
</script></body></html>`;

const cue = (page: Page) => page.evaluate(() => {
  const element = document.querySelector<HTMLElement>('.player-captions-container');
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  // The cue lets pointer events through, which hit testing would skip; what is asked is its stacking against the picture.
  element.style.setProperty('pointer-events', 'auto', 'important');
  const stack = document.elementsFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
  element.style.removeProperty('pointer-events');
  const cueIndex = stack.findIndex(item => element.contains(item));
  const videoIndex = stack.findIndex(item => item instanceof HTMLVideoElement);
  return {
    shown: getComputedStyle(element).display !== 'none',
    position: getComputedStyle(element).position,
    inViewport: rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight,
    aboveVideo: cueIndex >= 0 && (videoIndex < 0 || cueIndex < videoIndex)
  };
});

describe('Twitch closed captions', () => {
  for (const engine of testEngines()) {
    const shared = sharedTestBrowser(({ chromium, firefox })[engine]);
    const newPage = async (t: TestContext, hash = '') => {
      const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      await page.route('https://gql.twitch.tv/**', route => route.fulfill({ contentType: 'application/json', headers: CORS,
        body: JSON.stringify({ data: { video: { id: '123', lengthSeconds: 1200, title: 'Fixture VOD' } } }) }));
      await page.clock.install();
      await serveFixture(page, FIXTURE, VOD_URL + hash);
      await bootPlayer(page, { mainWorld: true });
      await page.waitForFunction(() => {
        const video = document.querySelector('video');
        return Boolean(video && video.readyState >= 2 && Number.isFinite(video.duration));
      });
      await page.evaluate(() => { document.querySelector('video')!.pause(); });
      // The harvest samples the player once, 1.5 s after it starts; Twitch's player only knows later.
      await page.clock.runFor(EARLY_SAMPLE_MS + 100);
      await page.evaluate(() => (window as unknown as { playerLearnsOfCaptions(): void }).playerLearnsOfCaptions());
      return page;
    };
    /** The controls hide while the page waits for Twitch's player; wake them once the menu has something to offer. */
    const offer = async (page: Page) => {
      await page.waitForFunction(() => {
        const button = document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.cc-btn');
        return button instanceof HTMLElement && button.getAttribute('aria-disabled') !== 'true';
      }, undefined, { timeout: 10_000 });
      await page.mouse.move(600, 300);
      await page.mouse.move(640, 340);
      await page.locator('.cc-btn').click();
      await page.getByRole('button', { name: 'Closed Captions', exact: true }).waitFor();
    };
    const exitTheater = async (page: Page) => {
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
    };

    it(`offers Twitch's closed captions once its player reports them, draws them on screen and turns them off in ${engine}`, { timeout: 60_000 }, async t => {
      const page = await newPage(t);
      await enterTheater(page);
      await offer(page);
      assert.equal(await cue(page), null, 'Off at entry: Twitch draws nothing');
      await page.getByRole('button', { name: 'Closed Captions', exact: true }).click();
      await page.locator('.cc-btn.active').waitFor();
      assert.deepEqual(await cue(page), { shown: true, position: 'fixed', inViewport: true, aboveVideo: true }, 'the cue is on screen, above the picture');
      await page.locator('.cc-btn').click();
      await page.getByRole('button', { name: 'Off', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.player-captions-container'));
      assert.equal(await page.locator('.cc-btn.active').count(), 0);
      await exitTheater(page);
      assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-te-twitch-captions-hidden')), false);
    });

    it(`keeps the captions Twitch remembers off the picture while the menu says Off, and gives them back on exit in ${engine}`, { timeout: 60_000 }, async t => {
      const page = await newPage(t, '#remembered');
      await enterTheater(page);
      await offer(page);
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-te-twitch-captions-hidden'));
      assert.equal((await cue(page))?.shown, false, 'the menu owns the captions: Off shows none');
      await page.getByRole('button', { name: 'Closed Captions', exact: true }).click();
      await page.locator('.cc-btn.active').waitFor();
      assert.deepEqual(await cue(page), { shown: true, position: 'fixed', inViewport: true, aboveVideo: true });
      await page.locator('.cc-btn').click();
      await page.getByRole('button', { name: 'Off', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.player-captions-container'));
      await exitTheater(page);
      assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-te-twitch-captions-hidden')), false);
    });

    it(`leaves Twitch's own captions placement and visibility alone outside theater in ${engine}`, { timeout: 60_000 }, async t => {
      const page = await newPage(t, '#remembered');
      assert.deepEqual(await cue(page), { shown: true, position: 'absolute', inViewport: true, aboveVideo: true });
    });
  }
});
