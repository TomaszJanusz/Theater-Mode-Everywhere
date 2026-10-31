import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { chromium, firefox } from 'playwright';

import { bootPlayer, bundlePlayer, enterTheater } from '../../test-utils/player-boot';
import { sharedTestBrowser } from '../../test-utils/test-browser';
import { testEngines } from '../../test-utils/test-engines';
import { serveFixture, vodVideoFixture } from '../../test-utils/video-fixtures';

const countdown = readFileSync(new URL('../../../test/host-fixtures/youtube-autonav.html', import.meta.url), 'utf8');
const tiles = readFileSync(new URL('../../../test/host-fixtures/youtube-end-screen.html', import.meta.url), 'utf8');
const url = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const fixture = vodVideoFixture({ title: 'YouTube post-roll and autonav fixture' }).replace('<body>',
  '<body><ytd-watch-flexy video-id="jNQXAC9IVRw">' + countdown).replace('</body>', '</ytd-watch-flexy></body>');

describe('YouTube post-roll and autoplay (recorded DOM fixtures, not live extension evidence)', () => {
  for (const engine of testEngines()) {
    const browser = sharedTestBrowser(({ chromium, firefox })[engine]);
    it(`provider end, native countdown/cancel/navigation, identity and cleanup in ${engine}`, { timeout: 60_000 }, async t => {
      const page = await (await browser.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      page.setDefaultTimeout(8000);
      await serveFixture(page, fixture, url);
      await page.route('https://*.ytimg.com/**', route => route.fulfill({ status: 204, body: '' }));
      await page.evaluate(tileHtml => {
        const root = document.querySelector('#movie_player')!;
        root.prepend(document.querySelector('video')!);
        root.className = 'html5-video-player';
        const parsed = new DOMParser().parseFromString(tileHtml, 'text/html');
        root.append(parsed.querySelector('.ytp-fullscreen-grid')!);
        const panel = root.querySelector<HTMLElement>('.ytp-autonav-endscreen-countdown-overlay')!;
        panel.hidden = true;
        root.querySelector('.ytp-autonav-endscreen-upnext-cancel-button')!.addEventListener('click', () => {
          root.classList.remove('countdown-running');
          root.classList.add('ytp-autonav-endscreen-cancelled-state');
          panel.hidden = true;
        });
        root.querySelector('a.ytp-autonav-endscreen-upnext-play-button')!.addEventListener('click', event => {
          event.preventDefault();
          document.body.dataset.navigations = String(Number(document.body.dataset.navigations ?? 0) + 1);
          document.dispatchEvent(new Event('yt-navigate-start'));
          const anchor = event.currentTarget as HTMLAnchorElement;
          history.pushState({}, '', anchor.href);
          document.querySelector('ytd-watch-flexy')!.setAttribute('video-id', new URL(anchor.href).searchParams.get('v')!);
          root.classList.remove('ended-mode', 'countdown-running');
          panel.hidden = true;
          document.dispatchEvent(new Event('yt-navigate-finish'));
        });
      }, tiles);
      await bootPlayer(page, { mainWorld: true, bundle: bundlePlayer([
        "export { createYouTubePlaybackEnd } from './providers/youtube/playback-end';",
        "export { createYouTubeServiceActions } from './providers/youtube/service-actions';",
        "export { serviceElementToken } from './providers/native-service-actions';",
        "export { observeProviderDom } from './providers/dom-watch';"
      ]) });
      await page.waitForFunction(() => document.querySelector('video')!.readyState >= 2);
      await enterTheater(page);
      assert.equal(await page.locator('.theater-ended-curtain').count(), 0);
      // A post-roll emptied the element: no content ended event and no finite duration.
      await page.evaluate(() => {
        const video = document.querySelector('video')!;
        video.pause(); video.currentTime = 0;
        Object.defineProperty(video, 'duration', { configurable: true, get: () => NaN });
        document.querySelector('#movie_player')!.classList.add('ended-mode');
        video.dispatchEvent(new Event('emptied'));
      });
      await page.locator('.theater-ended-curtain').waitFor();
      assert.equal(await page.evaluate(() => document.querySelector('video')!.ended), false);
      await page.locator('.theater-end-screen-tile').first().waitFor();
      // Ads temporarily own the picture; a native skip restores the provider end signal.
      await page.evaluate(() => {
        const root = document.querySelector('#movie_player')!;
        root.classList.add('ad-showing');
        const skip = document.createElement('button');
        skip.className = 'ytp-skip-ad-button'; skip.textContent = 'Skip ad';
        skip.onclick = () => { root.classList.remove('ad-showing'); skip.remove(); };
        root.append(skip);
      });
      await page.locator('.theater-ended-curtain').waitFor({ state: 'detached' });
      await page.locator('.theater-service-action').filter({ hasText: 'Skip ad' }).click();
      await page.locator('.theater-ended-curtain').waitFor();
      // A resumed content item leaves the end state even with the same surface.
      await page.evaluate(() => document.querySelector('#movie_player')!.classList.remove('ended-mode'));
      await page.locator('.theater-ended-curtain').waitFor({ state: 'detached' });
      const startCountdown = async () => {
        await page.evaluate(() => {
          const root = document.querySelector('#movie_player')!;
          root.classList.remove('ytp-autonav-endscreen-cancelled-state');
          root.classList.add('ended-mode', 'countdown-running');
          root.querySelector<HTMLElement>('.ytp-autonav-endscreen-countdown-overlay')!.hidden = false;
          root.querySelector('.ytp-autonav-endscreen-upnext-header-countdown-number')!.textContent = '8';
        });
        await page.locator('.theater-service-action').filter({ hasText: 'Play Now' }).waitFor();
      };
      await startCountdown();
      const play = page.locator('.theater-service-action').filter({ hasText: 'Play Now' });
      const cancel = page.locator('.theater-service-action').filter({ hasText: 'Cancel' });
      assert.equal(await page.locator('.theater-ended-curtain').count(), 0);
      const id = await play.getAttribute('data-service-action-id');
      await page.evaluate(() => { document.querySelector('.ytp-autonav-endscreen-upnext-header-countdown-number')!.textContent = '4'; });
      await page.waitForFunction(() => document.querySelector('#theater-everywhere-ui')!.shadowRoot!
        .querySelector<HTMLElement>('.theater-service-action-progress')?.style.transform === 'scaleX(0.5)');
      await page.locator('.player-settings-btn').click();
      await page.setViewportSize({ width: 1000, height: 600 });
      await page.evaluate(() => document.querySelector('video')!.dispatchEvent(new Event('pause')));
      await page.locator('.player-settings-btn').click();
      assert.equal(await play.getAttribute('data-service-action-id'), id, 'menu/pause/resize preserve native countdown identity');
      assert.equal(await play.locator('.theater-service-action-progress').evaluate(node => (node as HTMLElement).style.transform), 'scaleX(0.5)');
      await cancel.click();
      await page.locator('.theater-ended-curtain').waitFor();
      await page.locator('.theater-end-screen-tile').first().waitFor();
      assert.equal(page.url(), url);
      // Recommendations off is independent of autoplay; the next countdown still appears.
      await page.locator('.theater-recommendations-setting input').click();
      await page.locator('.theater-end-screen').waitFor({ state: 'detached' });
      await startCountdown();
      await play.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
      await page.waitForURL('**v=jo2IvYrSuOw');
      assert.equal(await page.locator('body').getAttribute('data-navigations'), '1');
      assert.equal(await page.locator('html.theater-everywhere-html-active').count(), 1);
      await page.locator('.theater-service-action').waitFor({ state: 'detached' });
      // Direct sources prove A -> B -> A invalidates old actions, and disposed callbacks do no work.
      const guards = await page.evaluate(`(() => {
        const video = document.querySelector('video'); const root = document.querySelector('#movie_player');
        root.classList.add('ended-mode', 'countdown-running');
        root.querySelector('.ytp-autonav-endscreen-countdown-overlay').hidden = false;
        const source = TheaterTest.createYouTubeServiceActions({ element: video,
          elementToken: TheaterTest.serviceElementToken, observe: TheaterTest.observeProviderDom });
        const stop = source.subscribe(() => {}); const old = source.read()[0].id;
        document.dispatchEvent(new Event('yt-navigate-start')); document.dispatchEvent(new Event('yt-navigate-finish'));
        const stale = !source.activate(old); stop(); stop();
        const end = TheaterTest.createYouTubePlaybackEnd(video); let changes = 0;
        const off = end.observe(() => changes++);
        video.loop = true; const loop = end.ended(); video.loop = false;
        root.classList.add('ytp-live'); const live = end.ended(); root.classList.remove('ytp-live');
        const current = location.href;
        history.replaceState({}, '', '/shorts/jo2IvYrSuOw'); const shorts = end.ended();
        history.replaceState({}, '', '/embed/jo2IvYrSuOw'); const embed = end.ended();
        history.replaceState({}, '', current);
        off(); off(); root.classList.remove('ended-mode');
        return { stale, changes, loop, live, shorts, embed };
      })()`);
      assert.deepEqual(guards, { stale: true, changes: 0, loop: false, live: false, shorts: false, embed: null });
      await page.locator('.close-btn').click();
      assert.equal(await page.locator('.theater-ended-curtain, .theater-service-action').count(), 0);
    });
  }
});
