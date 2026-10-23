import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';

import type { Page } from 'playwright';
import { chromium, firefox } from 'playwright';

import { bootPlayer, bundleModules } from '../test-utils/player-boot';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { testEngines } from '../test-utils/test-engines';

const BUNDLE = bundleModules([
  "import { installWatchPlaybackQueries } from './providers/watch-playback';",
  'installWatchPlaybackQueries();',
  "export { bootstrapPlayerRuntime } from './ui/player-runtime';",
  "export { setPlayerUiCss } from './ui/root';"
]);
const MEDIA = `data:video/webm;base64,${readFileSync(new URL('../../test/fixtures/vod.webm', import.meta.url)).toString('base64')}`;

const ID_A = 'aaaaaaaaaaa';
const ID_B = 'bbbbbbbbbbb';

/** A single-page site that keeps one visible player through every route, as a host that never hides or removes it. */
async function openSinglePageSite(page: Page): Promise<void> {
  await page.route('https://www.youtube.com/**', route => route.fulfill({
    contentType: 'text/html',
    body: `<style>body{margin:0}video{display:block;width:640px;height:360px}</style><div id="host"><video id="player" muted loop src="${MEDIA}"></video></div>`
  }));
  await page.goto('https://www.youtube.com/results?search_query=x');
  await bootPlayer(page, { bundle: BUNDLE });
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
  await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('#player')!.readyState >= 2);
}

const route = (page: Page, url: string) => page.evaluate(url => history.pushState({}, '', url), url);
const theaterOn = (page: Page) => page.evaluate(() => document.documentElement.classList.contains('theater-everywhere-html-active'));
async function enterTheater(page: Page): Promise<void> {
  await page.keyboard.press('t');
  await page.waitForFunction(() => document.documentElement.classList.contains('theater-everywhere-html-active'));
}
// Wait for the host and runtime popstate listeners before inspecting their synchronous result.
const goBack = (page: Page) => page.evaluate(() => new Promise<void>(resolve => {
  addEventListener('popstate', () => resolve(), { once: true });
  history.back();
}));
const goForward = (page: Page) => page.evaluate(() => new Promise<void>(resolve => {
  addEventListener('popstate', () => resolve(), { once: true });
  history.forward();
}));

/** Stand-in host routing: the ended watch player survives, while a feed video autoplays. */
async function openFeedSite(page: Page): Promise<void> {
  await page.route('https://www.youtube.com/**', request => request.fulfill({
    contentType: 'text/html',
    body: `<style>video{width:640px;height:360px} [hidden]{display:none!important}</style>
      <a id="home" href="/">Home</a>
      <ytd-watch-flexy id="watch"><div id="movie_player"><video id="player" class="html5-main-video" muted src="${MEDIA}"></video></div></ytd-watch-flexy>
      <div id="feed" hidden><video id="ad" title="ADVERTISEMENT" muted loop src="${MEDIA}"></video></div>`
  }));
  await page.goto('https://www.youtube.com/');
  // The host fixture runs before bootPlayer installs its serialized callback shim.
  await page.addScriptTag({ content: 'window.__name = target => target;' });
  await page.evaluate(() => {
    const player = document.querySelector('#movie_player') as HTMLElement & { getVideoData(): object };
    player.getVideoData = () => ({ video_id: new URL(location.href).searchParams.get('v') });
    const render = () => {
      const watching = location.pathname === '/watch';
      document.querySelector<HTMLElement>('#watch')!.hidden = !watching;
      document.querySelector<HTMLElement>('#feed')!.hidden = watching;
      if (!watching) void document.querySelector<HTMLVideoElement>('#ad')!.play();
      document.dispatchEvent(new Event('yt-page-data-updated'));
    };
    addEventListener('popstate', render);
    document.querySelector('#home')!.addEventListener('click', event => {
      event.preventDefault();
      history.pushState({}, '', '/');
      render();
    });
    render();
  });
  await bootPlayer(page, { bundle: BUNDLE });
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
  await route(page, `/watch?v=${ID_A}`);
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('#watch')!.hidden = false;
    document.querySelector<HTMLElement>('#feed')!.hidden = true;
    document.querySelector<HTMLVideoElement>('#ad')!.pause();
  });
  await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('#player')!.readyState >= 2);
}

async function endWatchMedia(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const video = document.querySelector<HTMLVideoElement>('#player')!;
    await video.play();
    video.currentTime = video.duration;
  });
  await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('#player')!.ended);
}

async function expectFeedExit(page: Page): Promise<void> {
  await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'), undefined, { timeout: 5_000 });
  await page.waitForFunction(() => {
    const ad = document.querySelector<HTMLVideoElement>('#ad')!;
    return !ad.paused && ad.readyState >= 2;
  });
  assert.equal(await page.locator('video[data-theater-everywhere]').count(), 0);
  assert.equal(await page.locator('.theater-controls-wrapper, .theater-everywhere-title-hud').count(), 0);
}

for (const engine of testEngines()) {
  const shared = sharedTestBrowser(({ chromium, firefox })[engine]);

  for (const navigation of ['back', 'forward', 'click'] as const) {
    it(`${engine}: ${navigation} to an autoplaying feed ends the session with ended watch media`, { timeout: 30_000 }, async t => {
      const page = await (await shared.newContext(t)).newPage();
      await openFeedSite(page);
      if (navigation === 'forward') {
        await route(page, '/');
        await goBack(page);
      }
      await enterTheater(page);
      await endWatchMedia(page);
      if (navigation === 'back') await goBack(page);
      else if (navigation === 'forward') await goForward(page);
      else await page.locator('#home').evaluate((link: HTMLAnchorElement) => link.click());
      await expectFeedExit(page);
      if (navigation === 'back') {
        await goForward(page);
        await goBack(page);
      } else {
        await goBack(page);
        await goForward(page);
      }
      assert.equal(await theaterOn(page), false);
    });
  }

  it(`${engine}: a published in-app route change exits even if the host keeps the watch player visible`, { timeout: 30_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
    await openSinglePageSite(page);
    await route(page, `/watch?v=${ID_A}`);
    await enterTheater(page);
    await page.evaluate(() => {
      history.pushState({}, '', '/');
      document.dispatchEvent(new Event('yt-page-data-updated'));
    });
    await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
    assert.equal(await page.locator('video[data-theater-everywhere]').count(), 0);
  });

  it(`${engine}: a watch navigation publication does not treat the host's temporary hidden player as departure`, { timeout: 30_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
    await openFeedSite(page);
    await enterTheater(page);
    const active = await page.evaluate(() => {
      const watch = document.querySelector<HTMLElement>('#watch')!;
      watch.hidden = true;
      history.pushState({}, '', '/watch?v=bbbbbbbbbbb');
      document.dispatchEvent(new Event('yt-page-data-updated'));
      watch.hidden = false;
      return document.documentElement.classList.contains('theater-everywhere-html-active');
    });
    assert.equal(active, true);
    assert.equal(await page.locator('#player[data-theater-everywhere]').count(), 1);
  });

  for (const integrationOff of [false, true]) {
    it(`${engine}: integration off=${integrationOff}: a watch replacement must match the route rather than an unrelated feed video`, { timeout: 30_000 }, async t => {
      const page = await (await shared.newContext(t)).newPage();
      await openFeedSite(page);
      if (integrationOff) await page.evaluate(() => document.documentElement.setAttribute('data-te-youtube-integration-off', ''));
      await enterTheater(page);
      const reboundToFeed = await page.evaluate(() => {
        document.querySelector<HTMLElement>('#feed')!.hidden = false;
        document.querySelector('#player')!.remove();
        const ad = document.querySelector<HTMLVideoElement>('#ad')!;
        ad.dispatchEvent(new Event('loadedmetadata'));
        const reboundToFeed = ad.hasAttribute('data-theater-everywhere');
        const replacement = document.createElement('video');
        replacement.id = 'replacement';
        replacement.className = 'html5-main-video';
        replacement.muted = true;
        replacement.src = document.querySelector<HTMLVideoElement>('#ad')!.src;
        history.pushState({}, '', '/watch?v=bbbbbbbbbbb&list=playlist&index=2');
        document.querySelector('#movie_player')!.append(replacement);
        void ad.play();
        return reboundToFeed;
      });
      assert.equal(reboundToFeed, false);
      await page.waitForFunction(() => document.querySelector('#replacement')!.hasAttribute('data-theater-everywhere'));
      assert.equal(await theaterOn(page), true);
      assert.equal(await page.locator('#ad[data-theater-everywhere]').count(), 0);
    });
  }

  it(`${engine}: back to a non-watch route exits theater though the player stays in the page`, { timeout: 30_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
    await openSinglePageSite(page);
    await route(page, `/watch?v=${ID_A}`);
    await enterTheater(page);
    await goBack(page);
    await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
    assert.equal(await page.locator('video[data-theater-everywhere]').count(), 0);
    assert.equal(await page.locator('#player').evaluate(video => video.isConnected), true);
  });

  it(`${engine}: forward to a non-watch route exits theater and back to the watch page does not re-enter by itself`, { timeout: 30_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
    await openSinglePageSite(page);
    await route(page, `/watch?v=${ID_A}`);
    await route(page, '/results?search_query=y');
    await goBack(page);
    await enterTheater(page);
    await goForward(page);
    await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
    // Rapid traversal must not revive the disposed session.
    await goBack(page);
    await goForward(page);
    assert.equal(await theaterOn(page), false);
  });

  it(`${engine}: back between two watch pages keeps theater on the persistent player`, { timeout: 30_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
    await openSinglePageSite(page);
    await route(page, `/watch?v=${ID_A}`);
    await route(page, `/watch?v=${ID_B}`);
    await enterTheater(page);
    await goBack(page);
    assert.equal(await theaterOn(page), true);
    assert.equal(await page.locator('video#player[data-theater-everywhere]').count(), 1);
  });

  it(`${engine}: theater entered on a non-watch route is not ended by history traversal`, { timeout: 30_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
    await openSinglePageSite(page);
    await route(page, '/results?search_query=y');
    await enterTheater(page);
    await goBack(page);
    assert.equal(await theaterOn(page), true);
  });
}
