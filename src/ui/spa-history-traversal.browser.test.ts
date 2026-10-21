import { testEngines } from '../test-utils/test-engines';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { it } from 'node:test';
import type { Page } from 'playwright';
import { chromium, firefox } from 'playwright';
import { sharedTestBrowser } from '../test-utils/test-browser';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild') as { buildSync(options: object): { outputFiles: Array<{ text: string }> } };
const BUNDLE = esbuild.buildSync({
  stdin: {
    contents: "import { bootstrapPlayerRuntime } from './ui/player-runtime'; import { installWatchPlaybackQueries } from './providers/watch-playback'; installWatchPlaybackQueries(); bootstrapPlayerRuntime();",
    resolveDir: new URL('../', import.meta.url).pathname, loader: 'ts'
  },
  bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent'
}).outputFiles[0].text;
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
  await page.addScriptTag({ content: 'window.__name = target => target;' });
  await page.addScriptTag({ content: BUNDLE });
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
  await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('#player')!.readyState >= 2);
}

const route = (page: Page, url: string) => page.evaluate(url => history.pushState({}, '', url), url);
const theaterOn = (page: Page) => page.evaluate(() => document.documentElement.classList.contains('theater-everywhere-html-active'));
async function enterTheater(page: Page): Promise<void> {
  await page.keyboard.press('t');
  await page.waitForFunction(() => document.documentElement.classList.contains('theater-everywhere-html-active'));
}
// The runtime's popstate listener is registered first and exits synchronously, so state read after this resolves is final.
const goBack = (page: Page) => page.evaluate(() => new Promise<void>(resolve => {
  addEventListener('popstate', () => resolve(), { once: true });
  history.back();
}));
const goForward = (page: Page) => page.evaluate(() => new Promise<void>(resolve => {
  addEventListener('popstate', () => resolve(), { once: true });
  history.forward();
}));

for (const engine of testEngines()) {
  const shared = sharedTestBrowser(({ chromium, firefox })[engine]);

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
    // Rapid back/forward lands on the watch page with the stage already cleaned up.
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
