import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { BrowserContext, Page, Route } from './helpers';
import { extensionWorker, ROOT } from './helpers';

/** Asks the MAIN-world watch bridge about the page's player; null means no provider answered. */
const watchBridgeQuery = (page: Page) => () => page.evaluate(() => {
  window.dispatchEvent(new CustomEvent('theater-everywhere-watch-replacement-query', { detail: 'pilot-query' }));
  const video = document.querySelector('video')!;
  const result = video.getAttribute('data-te-watch-replacement-response');
  video.removeAttribute('data-te-watch-replacement-response');
  return result;
});

const SOOP = 'https://vod.sooplive.com/player/211006561';
const fixture = `<!doctype html><html><head><title>Generic fixture title</title><script>
window.historyPublications = 0;
window.hostKeys = 0;
window.addEventListener('theater-everywhere-soop-navigate', () => window.historyPublications++);
history.replaceState(null, '', location.href);
window.earlyHistoryPublications = window.historyPublications;
window.addEventListener('keydown', event => {
  if (event.code === 'KeyT') { window.hostKeys++; event.stopImmediatePropagation(); event.preventDefault(); }
}, true);
</script></head><body>
<div id="webplayer" class="chat_open"><div id="player"><video id="video" muted style="width:640px;height:360px"></video>
<button class="play next" onclick="window.nextClicks=(window.nextClicks||0)+1">Next</button></div>
<div id="chatting_area"><div class="chatbox">Native chat<input></div></div></div>
<h1 class="broadcast_title">SOOP pilot recording</h1><div class="nickname">Pilot streamer</div>
<script>
fetch('/fixture.webm').then(response => response.blob()).then(blob => { document.querySelector('video').src = URL.createObjectURL(blob); });
</script></body></html>`;

/** Installed-extension evidence on intercepted host URLs; no live service or diagnostic injection. */
export async function assertProviderScripts(page: Page, context: BrowserContext): Promise<void> {
  const worker = await extensionWorker(context);
  const saved = await worker.evaluate(() => chrome.storage.sync.get(['autoEnterTheater', 'soopIntegrationEnabled']));
  const media = readFileSync(path.join(ROOT, 'test/fixtures/vod.webm'));
  const handler = async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'stbbs.sooplive.com') {
      await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ result: 1, data: [{ title: 'Intro', time_sec: 0 }, { title: 'Later', time_sec: 1 }] }) });
    } else if (url.pathname === '/fixture.webm') {
      await route.fulfill({ contentType: 'video/webm', body: media });
    } else {
      await route.fulfill({ contentType: 'text/html', body: fixture });
    }
  };
  const hosts = /^https:\/\/(?:vod\.sooplive\.com\.?|stbbs\.sooplive\.com|player\.example\.test|sooplive\.com\.evil\.test)\//;
  await context.route(hosts, handler);
  try {
    await worker.evaluate(() => chrome.storage.sync.set({ autoEnterTheater: false, soopIntegrationEnabled: true }));
    // Admission is host-wide: a catalog -> recording SPA navigation must need no additional script.
    await page.goto('https://vod.sooplive.com/');
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
    assert.equal(await page.evaluate('window.earlyHistoryPublications'), 1, 'MAIN history hook must precede the first host script');
    await page.evaluate(`history.pushState(null, '', '/player/211006561')`);
    await page.waitForFunction(() => { const video = document.querySelector('video'); return video && video.readyState >= 2; });
    const bridge = await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('theater-everywhere-watch-replacement-query', { detail: 'pilot-query' }));
      const video = document.querySelector('video')!;
      const result = video.getAttribute('data-te-watch-replacement-response');
      video.removeAttribute('data-te-watch-replacement-response');
      return result;
    });
    assert.equal(bridge, 'pilot-query', 'MAIN provider must answer the validated watch bridge');
    const first = await page.evaluate(() => {
      const begin = performance.now();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true, cancelable: true }));
      return { entered: document.documentElement.classList.contains('theater-everywhere-html-active'), milliseconds: performance.now() - begin };
    });
    assert.equal(first.entered, true, 'first t enters synchronously, without loading or replaying the key');
    assert.equal(await page.evaluate('window.hostKeys'), 0, 'early key capture beats the host listener');
    await page.locator('.theater-title-hud-title').filter({ hasText: 'SOOP pilot recording' }).first().waitFor({ state: 'attached' });
    await page.locator('.theater-scrubber-chapter-mark').first().waitFor({ state: 'attached' });
    await page.locator('.playlist-next-btn:not([disabled])').waitFor({ state: 'attached' });
    await page.keyboard.press('Shift+N');
    assert.equal(await page.evaluate('window.nextClicks'), 1);
    await page.evaluate(`history.pushState(null, '', '/')`);
    await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));

    // Registration survives preference changes. MAIN identity stays available with RTE off.
    await worker.evaluate(() => chrome.storage.sync.set({ soopIntegrationEnabled: false }));
    await page.goto(SOOP);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-te-soop-integration-off') && document.querySelector('video')!.readyState >= 2);
    await page.keyboard.press('t');
    await page.locator('.theater-controls-wrapper').waitFor();
    await worker.evaluate(() => chrome.storage.sync.set({ soopIntegrationEnabled: true }));
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-te-soop-integration-off'));
    await page.locator('.theater-title-hud-title').filter({ hasText: 'SOOP pilot recording' }).first().waitFor({ state: 'attached' });
    await page.keyboard.press('Escape');

    for (const url of ['https://player.example.test/', 'https://sooplive.com.evil.test/']) {
      await page.goto(url);
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts') && document.querySelector('video')!.readyState >= 2);
      assert.equal(await page.evaluate('window.earlyHistoryPublications'), 0, url);
      await page.keyboard.press('t');
      await page.locator('.theater-controls-wrapper').waitFor();
      await page.keyboard.press('Escape');
    }
    await page.goto('https://vod.sooplive.com./');
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
    assert.equal(await page.evaluate('window.earlyHistoryPublications'), 1, 'terminal DNS dot keeps provider admission');
    await page.goto('https://player.example.test/');
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
    // Own-frame admission: generic parent, SOOP child; no top-level-only registration assumption.
    await page.evaluate(url => { const frame = document.createElement('iframe'); frame.src = url; document.body.append(frame); }, SOOP);
    const child = page.frameLocator('iframe');
    await child.locator('video').waitFor();
    const frame = page.frames().find(frame => frame.url() === SOOP)!;
    await frame.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
    assert.equal(await frame.evaluate('window.earlyHistoryPublications'), 1);
    assert.equal(await page.evaluate('window.earlyHistoryPublications'), 0);
    console.log(`smoke provider scripts: SOOP registration in both worlds, early history, first t synchronous (${first.milliseconds.toFixed(1)} ms; includes existing theater work), navigation, RTE off/on, generic/spoofed host, own-frame admission passed (installed fixture)`);
  } finally {
    await context.unroute(hosts, handler);
    await worker.evaluate(async saved => {
      await chrome.storage.sync.remove(['autoEnterTheater', 'soopIntegrationEnabled']);
      await chrome.storage.sync.set(saved);
    }, saved);
  }
}

const PATREON = 'https://www.patreon.com/posts/pilot-post-12345678';
const patreonFixture = `<!doctype html><html><head><title>Generic fixture title</title><script>
window.historyPublications = 0;
window.hostKeys = 0;
window.addEventListener('theater-everywhere-patreon-navigate', () => window.historyPublications++);
history.replaceState(null, '', location.href);
window.earlyHistoryPublications = window.historyPublications;
window.addEventListener('keydown', event => {
  if (event.code === 'KeyT') { window.hostKeys++; event.stopImmediatePropagation(); event.preventDefault(); }
}, true);
</script></head><body>
<h1 data-tag="post-title">Patreon pilot post</h1>
<video id="video" muted style="width:640px;height:360px"></video>
<script>
fetch('/fixture.webm').then(response => response.blob()).then(blob => { document.querySelector('video').src = URL.createObjectURL(blob); });
</script></body></html>`;

/** Patreon loads per host: installed-extension evidence on intercepted host URLs, as for SOOP. */
export async function assertPatreonProvider(page: Page, context: BrowserContext): Promise<void> {
  const worker = await extensionWorker(context);
  const saved = await worker.evaluate(() => chrome.storage.sync.get(['autoEnterTheater', 'patreonIntegrationEnabled']));
  const media = readFileSync(path.join(ROOT, 'test/fixtures/vod.webm'));
  const handler = async (route: Route) => {
    if (new URL(route.request().url()).pathname === '/fixture.webm') await route.fulfill({ contentType: 'video/webm', body: media });
    else await route.fulfill({ contentType: 'text/html', body: patreonFixture });
  };
  const hosts = /^https:\/\/(?:www\.patreon\.com\.?|patreon\.com\.evil\.test|player\.example\.test)\//;
  await context.route(hosts, handler);
  try {
    await worker.evaluate(() => chrome.storage.sync.set({ autoEnterTheater: false, patreonIntegrationEnabled: true }));
    await page.goto('https://www.patreon.com/home');
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
    assert.equal(await page.evaluate('window.earlyHistoryPublications'), 1, 'MAIN history hook must precede the first host script');
    await page.evaluate(`history.pushState(null, '', '/posts/pilot-post-12345678')`);
    await page.waitForFunction(() => { const video = document.querySelector('video'); return video && video.readyState >= 2; });
    assert.equal(await page.evaluate('window.historyPublications'), 2, 'a pushState navigation is published to the isolated world');
    const first = await page.evaluate(() => {
      const begin = performance.now();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true, cancelable: true }));
      return { entered: document.documentElement.classList.contains('theater-everywhere-html-active'), milliseconds: performance.now() - begin };
    });
    assert.equal(first.entered, true, 'first t enters synchronously, without loading or replaying the key');
    assert.equal(await page.evaluate('window.hostKeys'), 0, 'early key capture beats the host listener');
    await page.locator('.theater-title-hud-head').filter({ hasText: 'Patreon pilot post' }).first().waitFor({ state: 'attached' });
    await page.keyboard.press('Escape');

    // Registration survives preference changes.
    await worker.evaluate(() => chrome.storage.sync.set({ patreonIntegrationEnabled: false }));
    await page.goto(PATREON);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-te-patreon-integration-off') && document.querySelector('video')!.readyState >= 2);
    await page.keyboard.press('t');
    await page.locator('.theater-controls-wrapper').waitFor();
    await worker.evaluate(() => chrome.storage.sync.set({ patreonIntegrationEnabled: true }));
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-te-patreon-integration-off'));
    await page.locator('.theater-title-hud-head').filter({ hasText: 'Patreon pilot post' }).first().waitFor({ state: 'attached' });
    await page.keyboard.press('Escape');

    for (const url of ['https://player.example.test/', 'https://patreon.com.evil.test/']) {
      await page.goto(url);
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts') && document.querySelector('video')!.readyState >= 2);
      assert.equal(await page.evaluate('window.earlyHistoryPublications'), 0, url);
      await page.keyboard.press('t');
      await page.locator('.theater-controls-wrapper').waitFor();
      await page.keyboard.press('Escape');
    }
    await page.goto('https://www.patreon.com./home');
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
    assert.equal(await page.evaluate('window.earlyHistoryPublications'), 1, 'terminal DNS dot keeps provider admission');
    await page.goto('https://player.example.test/');
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
    // Own-frame admission: generic parent, Patreon child.
    await page.evaluate(url => { const frame = document.createElement('iframe'); frame.src = url; document.body.append(frame); }, PATREON);
    await page.frameLocator('iframe').locator('video').waitFor();
    const frame = page.frames().find(frame => frame.url() === PATREON)!;
    await frame.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
    assert.equal(await frame.evaluate('window.earlyHistoryPublications'), 1);
    assert.equal(await page.evaluate('window.earlyHistoryPublications'), 0);
    console.log(`smoke provider scripts: Patreon registration in both worlds, early history, first t synchronous (${first.milliseconds.toFixed(1)} ms; includes existing theater work), navigation, RTE off/on, generic/spoofed host, own-frame admission passed (installed fixture)`);
  } finally {
    await context.unroute(hosts, handler);
    await worker.evaluate(async saved => {
      await chrome.storage.sync.remove(['autoEnterTheater', 'patreonIntegrationEnabled']);
      await chrome.storage.sync.set(saved);
    }, saved);
  }
}

const VIMEO = 'https://vimeo.com/123456';
const vimeoFixture = `<!doctype html><html><head><title>Generic fixture title</title><script>
window.hostKeys = 0;
window.playerConfig = { video: { id: 123456, title: 'Vimeo pilot clip', duration: 1 } };
window.addEventListener('keydown', event => {
  if (event.code === 'KeyT') { window.hostKeys++; event.stopImmediatePropagation(); event.preventDefault(); }
}, true);
</script></head><body>
<div class="player"><video id="video" muted style="width:640px;height:360px"></video></div>
<script>
fetch('/fixture.webm').then(response => response.blob()).then(blob => { document.querySelector('video').src = URL.createObjectURL(blob); });
</script></body></html>`;

/** Vimeo loads per host: installed-extension evidence on intercepted host URLs, as for SOOP and Patreon. */
export async function assertVimeoProvider(page: Page, context: BrowserContext): Promise<void> {
  const worker = await extensionWorker(context);
  const saved = await worker.evaluate(() => chrome.storage.sync.get(['autoEnterTheater', 'vimeoIntegrationEnabled']));
  const media = readFileSync(path.join(ROOT, 'test/fixtures/vod.webm'));
  const handler = async (route: Route) => {
    if (new URL(route.request().url()).pathname === '/fixture.webm') await route.fulfill({ contentType: 'video/webm', body: media });
    else await route.fulfill({ contentType: 'text/html', body: vimeoFixture });
  };
  const hosts = /^https:\/\/(?:vimeo\.com\.?|player\.vimeo\.com|player\.example\.test|vimeo\.com\.evil\.test)\//;
  await context.route(hosts, handler);
  const query = watchBridgeQuery(page);
  try {
    await worker.evaluate(() => chrome.storage.sync.set({ autoEnterTheater: false, vimeoIntegrationEnabled: true }));
    await page.goto(VIMEO);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts') && document.querySelector('video')!.readyState >= 2);
    assert.equal(await query(), 'pilot-query', 'MAIN provider must answer the validated watch bridge');
    const first = await page.evaluate(() => {
      const begin = performance.now();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true, cancelable: true }));
      return { entered: document.documentElement.classList.contains('theater-everywhere-html-active'), milliseconds: performance.now() - begin };
    });
    assert.equal(first.entered, true, 'first t enters synchronously, without loading or replaying the key');
    assert.equal(await page.evaluate('window.hostKeys'), 0, 'early key capture beats the host listener');
    // The title comes from the provider: MAIN reads the player config, the isolated adapter validates it.
    await page.locator('.theater-title-hud-head').filter({ hasText: 'Vimeo pilot clip' }).first().waitFor({ state: 'attached' });
    await page.keyboard.press('Escape');

    // Registration survives preference changes.
    await worker.evaluate(() => chrome.storage.sync.set({ vimeoIntegrationEnabled: false }));
    await page.goto(VIMEO);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-te-vimeo-integration-off') && document.querySelector('video')!.readyState >= 2);
    assert.equal(await query(), 'pilot-query', 'MAIN identity stays available with RTE off');
    await page.keyboard.press('t');
    await page.locator('.theater-controls-wrapper').waitFor();
    await worker.evaluate(() => chrome.storage.sync.set({ vimeoIntegrationEnabled: true }));
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-te-vimeo-integration-off'));
    await page.locator('.theater-title-hud-head').filter({ hasText: 'Vimeo pilot clip' }).first().waitFor({ state: 'attached' });
    await page.keyboard.press('Escape');

    // Subdomains and the terminal DNS dot keep admission; look-alike hosts stay generic.
    for (const url of ['https://player.vimeo.com/video/123456', 'https://vimeo.com./123456']) {
      await page.goto(url);
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts') && document.querySelector('video')!.readyState >= 2);
      assert.equal(await query(), 'pilot-query', url);
    }
    for (const url of ['https://player.example.test/', 'https://vimeo.com.evil.test/123456']) {
      await page.goto(url);
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts') && document.querySelector('video')!.readyState >= 2);
      assert.equal(await query(), null, `${url} must not load the Vimeo provider`);
      await page.keyboard.press('t');
      await page.locator('.theater-controls-wrapper').waitFor();
      assert.equal(await page.locator('.theater-title-hud-head').filter({ hasText: 'Vimeo pilot clip' }).count(), 0, url);
      await page.keyboard.press('Escape');
    }
    console.log(`smoke provider scripts: Vimeo registration in both worlds, first t synchronous (${first.milliseconds.toFixed(1)} ms; includes existing theater work), title through the provider, RTE off/on, subdomain and DNS dot, generic/spoofed host passed`);
  } finally {
    await context.unroute(hosts, handler);
    await worker.evaluate(async saved => {
      await chrome.storage.sync.remove(['autoEnterTheater', 'vimeoIntegrationEnabled']);
      await chrome.storage.sync.set(saved);
    }, saved);
  }
}

const YOUTUBE = 'https://www.youtube.com/watch?v=abcdefghijk';
const youtubeFixture = `<!doctype html><html><head><title>Generic fixture title</title><script>
// The page's first script: YouTube's MAIN hooks must already observe responses, and the entry key must beat this listener.
window.earlyWrapped = !/\\[native code\\]/.test(Function.prototype.toString.call(window.fetch))
  && !/\\[native code\\]/.test(Function.prototype.toString.call(Response.prototype.json));
window.hostKeys = 0;
window.addEventListener('keydown', event => {
  if (event.code === 'KeyT') { window.hostKeys++; event.stopImmediatePropagation(); event.preventDefault(); }
}, true);
window.ytInitialPlayerResponse = { videoDetails: { videoId: 'abcdefghijk', title: 'YouTube pilot video', lengthSeconds: '2' } };
</script></head><body>
<ytd-watch-flexy video-id="abcdefghijk"><div id="movie_player" class="html5-video-player">
<video class="html5-main-video" muted style="width:640px;height:360px"></video></div></ytd-watch-flexy>
<script>
fetch('/fixture.webm').then(response => response.blob()).then(blob => { document.querySelector('video').src = URL.createObjectURL(blob); });
</script></body></html>`;

/** YouTube loads per host: installed-extension evidence on intercepted host URLs, as for SOOP. */
export async function assertYoutubeProvider(page: Page, context: BrowserContext): Promise<void> {
  const worker = await extensionWorker(context);
  const saved = await worker.evaluate(() => chrome.storage.sync.get(['autoEnterTheater', 'youtubeIntegrationEnabled']));
  const media = readFileSync(path.join(ROOT, 'test/fixtures/vod.webm'));
  const handler = async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/fixture.webm') await route.fulfill({ contentType: 'video/webm', body: media });
    else await route.fulfill({ contentType: 'text/html; charset=utf-8', body: youtubeFixture });
  };
  const hosts = /^https:\/\/(?:www\.youtube\.com\.?|www\.youtube-nocookie\.com|www\.youtube\.com\.evil\.test|player\.example\.test)\//;
  const ready = () => page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts')
    && (document.querySelector('video')?.readyState ?? 0) >= 2);
  await context.route(hosts, handler);
  try {
    await worker.evaluate(() => chrome.storage.sync.set({ autoEnterTheater: false, youtubeIntegrationEnabled: true }));
    await page.goto(YOUTUBE);
    await ready();
    assert.equal(await page.evaluate('window.earlyWrapped'), true, 'YouTube harvest must observe responses before the first host script');
    const first = await page.evaluate(() => {
      const begin = performance.now();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true, cancelable: true }));
      return { entered: document.documentElement.classList.contains('theater-everywhere-html-active'), milliseconds: performance.now() - begin };
    });
    assert.equal(first.entered, true, 'first t enters synchronously on YouTube');
    assert.equal(await page.evaluate('window.hostKeys'), 0, 'early key capture beats the host listener');
    // Isolated adapter, MAIN probe and snapshot all come from YouTube's own scripts now.
    await page.locator('.theater-everywhere-title-hud').filter({ hasText: 'YouTube pilot video' }).first().waitFor({ state: 'attached' });
    // Leaving the watch route through YouTube's SPA events ends a session that began there.
    await page.evaluate(() => {
      history.pushState(null, '', '/feed/subscriptions');
      for (const name of ['yt-navigate-start', 'yt-navigate-finish', 'yt-page-data-updated']) document.dispatchEvent(new Event(name));
    });
    await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));

    // RTE off keeps generic entry; switching it on without a reload brings YouTube's data back.
    await worker.evaluate(() => chrome.storage.sync.set({ youtubeIntegrationEnabled: false }));
    await page.goto(YOUTUBE);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-te-youtube-integration-off'));
    await ready();
    await page.keyboard.press('t');
    await page.locator('.theater-controls-wrapper').waitFor();
    await worker.evaluate(() => chrome.storage.sync.set({ youtubeIntegrationEnabled: true }));
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-te-youtube-integration-off'));
    await page.locator('.theater-everywhere-title-hud').filter({ hasText: 'YouTube pilot video' }).first().waitFor({ state: 'attached' });
    await page.keyboard.press('Escape');

    // A spoofed host stays generic; the terminal DNS dot keeps admission.
    await page.goto('https://www.youtube.com.evil.test/watch?v=abcdefghijk');
    await ready();
    assert.equal(await page.evaluate('window.earlyWrapped'), false, 'no YouTube script on a look-alike host');
    await page.keyboard.press('t');
    await page.locator('.theater-controls-wrapper').waitFor();
    await page.keyboard.press('Escape');
    await page.goto('https://www.youtube.com./watch?v=abcdefghijk');
    await ready();
    assert.equal(await page.evaluate('window.earlyWrapped'), true, 'terminal DNS dot keeps YouTube admission');

    // A third-party page embedding YouTube: the embed frame gets YouTube, the generic parent does not.
    await page.goto('https://player.example.test/');
    await ready();
    const embed = 'https://www.youtube-nocookie.com/embed/abcdefghijk';
    await page.evaluate(url => { const frame = document.createElement('iframe'); frame.src = url; frame.width = '640'; frame.height = '360'; document.body.append(frame); }, embed);
    await page.frameLocator('iframe').locator('video').waitFor();
    const frame = page.frames().find(candidate => candidate.url() === embed)!;
    await frame.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
    assert.equal(await frame.evaluate('window.earlyWrapped'), true, 'the embed frame registers YouTube');
    assert.equal(await page.evaluate('window.earlyWrapped'), false, 'the generic parent loads no YouTube script');
    console.log(`smoke YouTube provider scripts: MAIN hooks before the first host script, first t synchronous (${first.milliseconds.toFixed(1)} ms; includes existing theater work), title through the provider, SPA exit, RTE off/on, spoofed host, terminal dot, embed in a generic page passed (installed fixture)`);
  } finally {
    await context.unroute(hosts, handler);
    await worker.evaluate(async saved => {
      await chrome.storage.sync.remove(['autoEnterTheater', 'youtubeIntegrationEnabled']);
      await chrome.storage.sync.set(saved);
    }, saved);
  }
}

const IQIYI = 'https://www.iq.com/play/spring-of-the-blade-episode-1-198yzaqjce8?lang=en_us';
const iqiyiFixture = `<!doctype html><html><head><title>Generic fixture title</title><script>
window.hostKeys = 0;
window.__playerdata__ = { __dash: { data: { tvid: 4546375215960300, program: { video: [{ duration: 1 }] }, p: { bt: 0.2, et: 0.6, ete: 0.9 } } } };
window.addEventListener('keydown', event => {
  if (event.code === 'KeyT') { window.hostKeys++; event.stopImmediatePropagation(); event.preventDefault(); }
}, true);
</script></head><body>
<h1 class="intl-play-title"><a class="intl-album-title" href="//www.iq.com/album/spring-of-the-blade-2026-1nby7voujqx"><span class="intl-album-title-word-wrap"><span>Spring of The Blade </span></span></a>Episode 1</h1>
<div id="flashbox"><iqpdiv class="iqp-player"><video id="video" muted style="width:640px;height:360px"></video></iqpdiv></div>
<ul class="intl-episodes-list"><li class="selected"><a href="//www.iq.com/play/spring-of-the-blade-episode-1-198yzaqjce8">1</a></li></ul>
<script>
fetch('/fixture.webm').then(response => response.blob()).then(blob => { document.querySelector('video').src = URL.createObjectURL(blob); });
</script></body></html>`;

/** iQIYI loads per host: installed-extension evidence on intercepted host URLs, as for Vimeo and Patreon. */
export async function assertIqiyiProvider(page: Page, context: BrowserContext): Promise<void> {
  const worker = await extensionWorker(context);
  const saved = await worker.evaluate(() => chrome.storage.sync.get(['autoEnterTheater', 'iqiyiIntegrationEnabled']));
  const media = readFileSync(path.join(ROOT, 'test/fixtures/vod.webm'));
  const handler = async (route: Route) => {
    if (new URL(route.request().url()).pathname === '/fixture.webm') await route.fulfill({ contentType: 'video/webm', body: media });
    else await route.fulfill({ contentType: 'text/html', body: iqiyiFixture });
  };
  const hosts = /^https:\/\/(?:www\.iq\.com|player\.example\.test|www\.iq\.com\.evil\.test|www\.iqiyi\.com)\//;
  await context.route(hosts, handler);
  const query = watchBridgeQuery(page);
  const title = () => page.locator('.theater-title-hud-head').filter({ hasText: 'Spring of The Blade' }).first();
  try {
    await worker.evaluate(() => chrome.storage.sync.set({ autoEnterTheater: false, iqiyiIntegrationEnabled: true }));
    await page.goto(IQIYI);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts') && document.querySelector('video')!.readyState >= 2);
    assert.equal(await query(), 'pilot-query', 'MAIN provider must answer the validated watch bridge');
    const first = await page.evaluate(() => {
      const begin = performance.now();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true, cancelable: true }));
      return { entered: document.documentElement.classList.contains('theater-everywhere-html-active'), milliseconds: performance.now() - begin };
    });
    assert.equal(first.entered, true, 'first t enters synchronously, without loading or replaying the key');
    assert.equal(await page.evaluate('window.hostKeys'), 0, 'early key capture beats the host listener');
    // The title comes from the provider's adapter reading the play heading.
    await title().waitFor({ state: 'attached' });
    await page.keyboard.press('Escape');

    // Registration survives preference changes.
    await worker.evaluate(() => chrome.storage.sync.set({ iqiyiIntegrationEnabled: false }));
    await page.goto(IQIYI);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-te-iqiyi-integration-off') && document.querySelector('video')!.readyState >= 2);
    assert.equal(await query(), 'pilot-query', 'MAIN identity stays available with RTE off');
    await page.keyboard.press('t');
    await page.locator('.theater-controls-wrapper').waitFor();
    assert.equal(await title().count(), 0, 'no service title with RTE off');
    await worker.evaluate(() => chrome.storage.sync.set({ iqiyiIntegrationEnabled: true }));
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-te-iqiyi-integration-off'));
    await title().waitFor({ state: 'attached' });
    await page.keyboard.press('Escape');

    // Look-alike hosts and the domestic iqiyi.com stay generic.
    for (const url of ['https://player.example.test/play/x-198yzaqjce8', 'https://www.iq.com.evil.test/play/x-198yzaqjce8', 'https://www.iqiyi.com/play/x-198yzaqjce8']) {
      await page.goto(url);
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts') && document.querySelector('video')!.readyState >= 2);
      assert.equal(await query(), null, `${url} must not load the iQIYI provider`);
      await page.keyboard.press('t');
      await page.locator('.theater-controls-wrapper').waitFor();
      assert.equal(await title().count(), 0, url);
      await page.keyboard.press('Escape');
    }
    console.log(`smoke provider scripts: iQIYI registration in both worlds, first t synchronous (${first.milliseconds.toFixed(1)} ms; includes existing theater work), title through the provider, RTE off/on, generic/spoofed/domestic host passed`);
  } finally {
    await context.unroute(hosts, handler);
    await worker.evaluate(async saved => {
      await chrome.storage.sync.remove(['autoEnterTheater', 'iqiyiIntegrationEnabled']);
      await chrome.storage.sync.set(saved);
    }, saved);
  }
}
