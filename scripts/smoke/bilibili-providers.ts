import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { BrowserContext, Page, Route } from './helpers';
import { extensionWorker, ROOT } from './helpers';
import { assertAutoTheaterEntry } from './provider-auto-theater';
import { watchBridgeQuery } from './providers';

const BILIBILI = 'https://www.bilibili.com/video/BV1xx411c7mu';
const BILIBILI_ZH = 'https://www.bilibili.com/zh-Hans/video/BV1xx411c7mu/';
const bilibiliFixture = `<!doctype html><html><head><title>Generic fixture title</title><script>
window.hostKeys = 0;
window.__INITIAL_STATE__ = { aid: 106, cid: 3635863, videoData: { title: 'Bilibili smoke video', duration: 600 } };
window.addEventListener('keydown', event => {
  if (event.code === 'KeyT') { window.hostKeys++; event.stopImmediatePropagation(); event.preventDefault(); }
}, true);
</script></head><body>
<div class="bpx-player-container" data-screen="normal"><div class="bpx-player-primary-area"><div class="bpx-player-video-wrap">
<video muted style="width:640px;height:360px"></video></div></div></div>
<script>
const container = document.querySelector('.bpx-player-container');
window.player = { hasValidAdv: () => false, mediaElement: () => document.querySelector('video'), getElements: () => ({ container }),
  getManifest: () => ({ bvid: window.bvid, p: 1, cid: 3635863, kind: 0 }) };
// The player follows the host's SPA routes: it reports the video the page was last sent to.
window.bvid = location.pathname.match(/BV[0-9A-Za-z]{10}/)?.[0] ?? 'BV1xx411c7mu';
window.spaTo = (path, bvid) => { window.bvid = bvid; history.pushState(null, '', path); const video = document.querySelector('video'); video.currentTime = 0; video.play(); };
fetch('/fixture.webm').then(response => response.blob()).then(blob => { document.querySelector('video').src = URL.createObjectURL(blob); });
</script></body></html>`;
const bilibiliPlayer = { code: 0, data: {
  subtitle: { subtitles: [{ id_str: '1', lan: 'en', lan_doc: 'English', subtitle_url: '//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/smoke1' }] },
  view_points: [{ from: 1, to: 300, content: 'Opening' }, { from: 300, to: 600, content: 'Second half' }]
} };

/**
 * Bilibili loads per host: installed-extension evidence on intercepted host URLs. The title and chapters cross from
 * MAIN through the asynchronous provider probe, and the cue file is admitted by the provider's own fetch policy.
 */
export async function assertBilibiliProvider(page: Page, context: BrowserContext): Promise<void> {
  const worker = await extensionWorker(context);
  const saved = await worker.evaluate(() => chrome.storage.sync.get(['autoEnterTheater', 'bilibiliIntegrationEnabled']));
  const media = readFileSync(path.join(ROOT, 'test/fixtures/vod.webm'));
  const cors = { 'access-control-allow-origin': 'https://www.bilibili.com', 'access-control-allow-credentials': 'true' };
  const handler = async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/fixture.webm') await route.fulfill({ contentType: 'video/webm', body: media });
    else if (url.hostname === 'api.bilibili.com' && url.pathname === '/x/player/v2') await route.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify(bilibiliPlayer) });
    else if (url.hostname === 'aisubtitle.hdslb.com') await route.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify({ body: [{ from: 0, to: 600, content: 'Bilibili smoke cue' }] }) });
    else if (url.hostname !== 'www.bilibili.com' && !url.hostname.endsWith('.test')) await route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' });
    else await route.fulfill({ contentType: 'text/html', body: bilibiliFixture });
  };
  const hosts = /^https:\/\/(?:www\.bilibili\.com|api\.bilibili\.com|bvc\.bilivideo\.com|aisubtitle\.hdslb\.com|player\.example\.test|www\.bilibili\.com\.evil\.test)\//;
  await context.route(hosts, handler);
  const query = watchBridgeQuery(page);
  const ready = () => page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts') && document.querySelector('video')!.readyState >= 2);
  const title = () => page.locator('.theater-title-hud-head').filter({ hasText: 'Bilibili smoke video' }).first();
  try {
    await worker.evaluate(() => chrome.storage.sync.set({ autoEnterTheater: false, bilibiliIntegrationEnabled: true }));
    await page.goto(BILIBILI);
    await ready();
    assert.equal(await query(), 'pilot-query', 'MAIN provider must answer the validated watch bridge');
    const first = await page.evaluate(() => {
      const begin = performance.now();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true, cancelable: true }));
      return { entered: document.documentElement.classList.contains('theater-everywhere-html-active'), milliseconds: performance.now() - begin };
    });
    assert.equal(first.entered, true, 'first t enters synchronously, without loading or replaying the key');
    assert.equal(await page.evaluate('window.hostKeys'), 0, 'early key capture beats the host listener');
    await title().waitFor({ state: 'attached' });
    await page.locator('.theater-scrubber-chapter-mark').first().waitFor({ state: 'attached' });
    await page.keyboard.press('c');
    await page.locator('.theater-caption-overlay-text', { hasText: 'Bilibili smoke cue' }).waitFor({ state: 'attached' });
    await page.keyboard.press('Escape');

    await worker.evaluate(() => chrome.storage.sync.set({ bilibiliIntegrationEnabled: false }));
    await page.goto(BILIBILI);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-te-bilibili-integration-off'));
    await ready();
    assert.equal(await query(), 'pilot-query', 'MAIN identity stays available with RTE off');
    await page.keyboard.press('t');
    await page.locator('.theater-controls-wrapper').waitFor();
    assert.equal(await title().count(), 0, 'no service title with RTE off');
    await worker.evaluate(() => chrome.storage.sync.set({ bilibiliIntegrationEnabled: true }));
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-te-bilibili-integration-off'));
    await title().waitFor({ state: 'attached' });
    await page.keyboard.press('Escape');

    for (const url of ['https://player.example.test/video/BV1xx411c7mu', 'https://www.bilibili.com.evil.test/video/BV1xx411c7mu']) {
      await page.goto(url);
      await ready();
      assert.equal(await query(), null, `${url} must not load the Bilibili provider`);
      await page.keyboard.press('t');
      await page.locator('.theater-controls-wrapper').waitFor();
      assert.equal(await title().count(), 0, url);
      await page.keyboard.press('Escape');
    }
    // Bilibili's site also serves language routes (/zh-Hans/video/BV...): both name the same video.
    await assertAutoTheaterEntry(page, context, 'bilibili', { url: BILIBILI, navigate: page => page.evaluate('window.spaTo("/video/BV1xx411c7mv", "BV1xx411c7mv")') });
    await assertAutoTheaterEntry(page, context, 'bilibili', { url: BILIBILI_ZH, navigate: page => page.evaluate('window.spaTo("/zh-Hans/video/BV1xx411c7mv/", "BV1xx411c7mv")') });
    console.log(`smoke provider scripts: Bilibili registration in both worlds, first t synchronous (${first.milliseconds.toFixed(1)} ms; includes existing theater work), title and chapters through the async probe, cue through the provider's fetch policy, RTE off/on, generic/spoofed host passed`);
  } finally {
    await context.unroute(hosts, handler);
    await worker.evaluate(async saved => {
      await chrome.storage.sync.remove(['autoEnterTheater', 'bilibiliIntegrationEnabled']);
      await chrome.storage.sync.set(saved);
    }, saved);
  }
}

const BILIBILI_TV = 'https://www.bilibili.tv/en/video/4801285774384128';
const bilibiliTvFixture = `<!doctype html><html><head><title>Generic fixture title</title><script>
window.hostKeys = 0;
window.__initialState = { ugc: { aid: '4801285774384128' } };
window.addEventListener('keydown', event => {
  if (event.code === 'KeyT') { window.hostKeys++; event.stopImmediatePropagation(); event.preventDefault(); }
}, true);
</script></head><body>
<div class="bstar-player"><div id="bilibiliPlayer" data-ui-mode="0"><div class="player-mobile-video-wrap">
<video muted style="width:640px;height:360px"></video></div></div></div>
<script>
window.dashPlayer = { video: document.querySelector('video'), state: { manifest: { type: 'static', originalUrl: location.href } } };
fetch('/fixture.webm').then(response => response.blob()).then(blob => { document.querySelector('video').src = URL.createObjectURL(blob); });
</script></body></html>`;

/**
 * Bilibili.tv loads per host: installed-extension evidence on intercepted host URLs. Its metadata, captions and
 * episode navigation through the asynchronous probe are covered by bilibiliIntl/runtime.browser.test.ts.
 */
export async function assertBilibiliTvProvider(page: Page, context: BrowserContext): Promise<void> {
  const worker = await extensionWorker(context);
  const saved = await worker.evaluate(() => chrome.storage.sync.get(['autoEnterTheater', 'bilibiliIntlIntegrationEnabled']));
  const media = readFileSync(path.join(ROOT, 'test/fixtures/vod.webm'));
  const handler = async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/fixture.webm') await route.fulfill({ contentType: 'video/webm', body: media });
    else if (url.hostname.endsWith('.bilibili.tv') && url.hostname !== 'www.bilibili.tv') await route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' });
    else await route.fulfill({ contentType: 'text/html', body: bilibiliTvFixture });
  };
  const hosts = /^https:\/\/(?:[a-z0-9-]+\.bilibili\.tv|player\.example\.test|www\.bilibili\.tv\.evil\.test)\//;
  await context.route(hosts, handler);
  const query = watchBridgeQuery(page);
  const ready = () => page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts') && document.querySelector('video')!.readyState >= 2);
  try {
    await worker.evaluate(() => chrome.storage.sync.set({ autoEnterTheater: false, bilibiliIntlIntegrationEnabled: true }));
    await page.goto(BILIBILI_TV);
    await ready();
    assert.equal(await query(), 'pilot-query', 'MAIN provider must answer the validated watch bridge');
    const first = await page.evaluate(() => {
      const begin = performance.now();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true, cancelable: true }));
      return { entered: document.documentElement.classList.contains('theater-everywhere-html-active'), milliseconds: performance.now() - begin };
    });
    assert.equal(first.entered, true, 'first t enters synchronously, without loading or replaying the key');
    assert.equal(await page.evaluate('window.hostKeys'), 0, 'early key capture beats the host listener');
    // MAIN publishes the upload it read for the isolated adapter.
    await page.waitForFunction(() => document.documentElement.getAttribute('data-te-bilibili-intl-episode') === '4801285774384128');
    await page.keyboard.press('Escape');

    await worker.evaluate(() => chrome.storage.sync.set({ bilibiliIntlIntegrationEnabled: false }));
    await page.goto(BILIBILI_TV);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-te-bilibili-intl-integration-off'));
    await ready();
    assert.equal(await query(), 'pilot-query', 'MAIN identity stays available with RTE off');
    await page.keyboard.press('t');
    await page.locator('.theater-controls-wrapper').waitFor();
    await page.keyboard.press('Escape');
    await worker.evaluate(() => chrome.storage.sync.set({ bilibiliIntlIntegrationEnabled: true }));
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-te-bilibili-intl-integration-off'));

    for (const url of ['https://player.example.test/en/video/4801285774384128', 'https://www.bilibili.tv.evil.test/en/video/4801285774384128']) {
      await page.goto(url);
      await ready();
      assert.equal(await query(), null, `${url} must not load the Bilibili.tv provider`);
      await page.keyboard.press('t');
      await page.locator('.theater-controls-wrapper').waitFor();
      await page.keyboard.press('Escape');
    }
    await assertAutoTheaterEntry(page, context, 'bilibiliIntl', { url: BILIBILI_TV });
    console.log(`smoke provider scripts: Bilibili.tv registration in both worlds, first t synchronous (${first.milliseconds.toFixed(1)} ms; includes existing theater work), MAIN snapshot reader on the page, RTE off/on, generic/spoofed host passed`);
  } finally {
    await context.unroute(hosts, handler);
    await worker.evaluate(async saved => {
      await chrome.storage.sync.remove(['autoEnterTheater', 'bilibiliIntlIntegrationEnabled']);
      await chrome.storage.sync.set(saved);
    }, saved);
  }
}
