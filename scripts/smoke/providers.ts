import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { BrowserContext, Page, Route } from './helpers';
import { extensionWorker, ROOT } from './helpers';

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
  const hosts = /^https:\/\/(?:vod\.sooplive\.com\.?|stbbs\.sooplive\.com|www\.youtube\.com|sooplive\.com\.evil\.test)\//;
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

    for (const url of ['https://www.youtube.com/', 'https://sooplive.com.evil.test/']) {
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
    await page.goto('https://www.youtube.com/');
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
    // Own-frame admission: generic parent, SOOP child; no top-level-only registration assumption.
    await page.evaluate(url => { const frame = document.createElement('iframe'); frame.src = url; document.body.append(frame); }, SOOP);
    const child = page.frameLocator('iframe');
    await child.locator('video').waitFor();
    const frame = page.frames().find(frame => frame.url() === SOOP)!;
    await frame.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
    assert.equal(await frame.evaluate('window.earlyHistoryPublications'), 1);
    assert.equal(await page.evaluate('window.earlyHistoryPublications'), 0);
    console.log(`smoke provider scripts: SOOP registration in both worlds, early history, first t synchronous (${first.milliseconds.toFixed(1)} ms; includes existing theater work), navigation, RTE off/on, generic YouTube/spoofed host, own-frame admission passed (installed fixture)`);
  } finally {
    await context.unroute(hosts, handler);
    await worker.evaluate(async saved => {
      await chrome.storage.sync.remove(['autoEnterTheater', 'soopIntegrationEnabled']);
      await chrome.storage.sync.set(saved);
    }, saved);
  }
}
