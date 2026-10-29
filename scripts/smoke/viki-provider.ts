import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { BrowserContext, Page, Route } from './helpers';
import { extensionWorker, ROOT } from './helpers';

const EPISODE = 'https://www.viki.com/videos/1263131v';
const PREVIEW = 'https://manifest-viki.viki.io/v1/streams/1263131v/preview.vtt';
const MANIFEST = 'https://manifest-viki.viki.io/v1/1263131v/akamai/manifest.mpd';
const fixture = `<!doctype html><html><head><title>Viki pilot - Episode 1 | Rakuten Viki</title><script>
window.earlyWrapped = !/\\[native code\\]/.test(Function.prototype.toString.call(window.fetch));
window.hostKeys = 0;
window.addEventListener('keydown', event => {
  if (event.code === 'KeyT') { window.hostKeys++; event.stopImmediatePropagation(); event.preventDefault(); }
}, true);
</script><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: {
  videoPlaybackStreamJson: { previewUrl: PREVIEW, video: { id: '1263131v', duration: 2, credits_marker: 1 },
    streamSubtitles: { dash: [{ srclang: 'en', label: 'English', src: 'https://api.viki.io/v4/videos/1263131v/subtitles/en.vtt' }] } }
} } })}</script></head><body>
<div id="vmplayer_id" class="video-js" tabindex="-1" style="width:640px;height:360px">
<video class="vjs-tech" muted style="width:640px;height:360px"></video>
<div class="vjs-text-track-display"><div class="vjs-text-track-cue">Native cue</div></div>
<button class="vjs-control"><span class="vjs-icon-next-item"></span><span>Next episode</span></button>
</div><script>
fetch('${MANIFEST}').then(response => response.text());
fetch('/fixture.webm').then(response => response.blob()).then(blob => { document.querySelector('video').src = URL.createObjectURL(blob); });
</script></body></html>`;

/** Installed extension on intercepted URLs; DRM-free fixture media, never real-host/Widevine evidence. */
export async function assertVikiProvider(page: Page, context: BrowserContext): Promise<void> {
  const worker = await extensionWorker(context);
  const saved = await worker.evaluate(() => chrome.storage.sync.get(['autoEnterTheater', 'vikiIntegrationEnabled']));
  const media = readFileSync(path.join(ROOT, 'test/fixtures/vod.webm'));
  const hosts = /^https:\/\/(?:www\.viki\.com\.?|embed\.viki\.com|api\.viki\.io|manifest-viki\.viki\.io|viki\.com\.evil\.test|player\.example\.test)\//;
  const handler = async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/fixture.webm') await route.fulfill({ contentType: 'video/webm', body: media });
    else if (url.hostname.endsWith('.viki.io')) await route.fulfill({ contentType: 'text/vtt', headers: { 'access-control-allow-origin': '*' }, body: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nFixture cue\n' });
    else await route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture });
  };
  // Viki confirms identity from a completed resource entry, not merely fetch response headers.
  const ready = () => page.waitForFunction(manifest => {
    const video = document.querySelector('video');
    return document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts')
      && video && video.readyState >= 2 && Number.isFinite(video.duration)
      && performance.getEntriesByType('resource').some(entry => entry.name === manifest);
  }, MANIFEST);
  const active = () => page.waitForFunction(() => document.documentElement.classList.contains('theater-everywhere-viki-stage'));
  const restored = () => page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active') && document.getElementById('vmplayer_id')?.getAttribute('tabindex') === '-1');
  await context.route(hosts, handler);
  try {
    await worker.evaluate(() => chrome.storage.sync.set({ autoEnterTheater: false, vikiIntegrationEnabled: true }));
    await page.goto(EPISODE);
    await ready();
    assert.equal(await page.evaluate('window.earlyWrapped'), false, 'Viki must keep the native fetch transport');
    const bridge = await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('theater-everywhere-watch-replacement-query', { detail: 'viki-smoke' }));
      const video = document.querySelector('video')!;
      const response = video.getAttribute('data-te-watch-replacement-response');
      video.removeAttribute('data-te-watch-replacement-response');
      return response;
    });
    assert.equal(bridge, 'viki-smoke', 'MAIN registration owns native watch identity');
    const first = await page.evaluate(() => {
      const begin = performance.now();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true, cancelable: true }));
      return { entered: document.documentElement.classList.contains('theater-everywhere-html-active'), milliseconds: performance.now() - begin };
    });
    assert.equal(first.entered, true, 'first t must enter synchronously');
    assert.equal(await page.evaluate('window.hostKeys'), 0, 'entry capture beats the host listener');
    await active();
    assert.equal(await page.locator('#vmplayer_id').getAttribute('tabindex'), null);
    await page.locator('.theater-title-hud-text', { hasText: 'Viki pilot - Episode 1' }).first().waitFor({ state: 'attached' });
    await page.locator('.theater-scrubber-chapter-mark').first().waitFor({ state: 'attached' });
    await page.keyboard.press('Escape');
    await restored();
    await worker.evaluate(() => chrome.storage.sync.set({ vikiIntegrationEnabled: false }));
    await page.goto(EPISODE);
    await ready();
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-te-viki-integration-off'));
    await page.keyboard.press('t');
    await active();
    await page.locator('.theater-title-hud-text', { hasText: 'Viki pilot - Episode 1' }).first().waitFor({ state: 'attached' });
    await worker.evaluate(() => chrome.storage.sync.set({ vikiIntegrationEnabled: true }));
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-te-viki-integration-off'));
    await page.locator('.theater-scrubber-chapter-mark').first().waitFor({ state: 'attached' });
    await page.keyboard.press('Escape');
    await restored();
    for (const url of ['https://player.example.test/', 'https://viki.com.evil.test/videos/1263131v']) {
      await page.goto(url);
      await ready();
      await page.keyboard.press('t');
      await page.locator('.theater-controls-wrapper').waitFor();
      assert.equal(await page.locator('#vmplayer_id').getAttribute('tabindex'), '-1', 'generic host must not mount Viki');
      assert.equal(await page.locator('html').evaluate(html => html.classList.contains('theater-everywhere-viki-stage')), false);
      await page.keyboard.press('Escape');
    }
    await page.goto('https://www.viki.com./videos/1263131v');
    await ready();
    await page.keyboard.press('t');
    await active();
    await page.keyboard.press('Escape');
    await restored();
    await page.goto('https://player.example.test/');
    await ready();
    const embed = 'https://embed.viki.com/player/1263131v';
    const navigation = page.waitForEvent('framenavigated', { predicate: frame => frame.url() === embed });
    await page.evaluate(url => { const frame = document.createElement('iframe'); frame.src = url; document.body.append(frame); }, embed);
    const child = await navigation;
    await child.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts') && (document.querySelector('video')?.readyState ?? 0) >= 2);
    await child.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true, cancelable: true })));
    await child.waitForFunction(() => document.documentElement.classList.contains('theater-everywhere-viki-stage'));
    assert.equal(await page.locator('html').evaluate(html => html.classList.contains('theater-everywhere-viki-stage')), false);
    await child.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })));
    await child.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-viki-stage'));
    console.log(`smoke Viki provider: both worlds, native fetch, synchronous first t (${first.milliseconds.toFixed(1)} ms including theater work), page title, chapters, RTE off/on, stage cleanup, generic/spoofed hosts, terminal dot and own-frame admission passed (installed fixture; DRM unverified)`);
  } finally {
    await context.unroute(hosts, handler);
    await worker.evaluate(async saved => {
      await chrome.storage.sync.remove(['autoEnterTheater', 'vikiIntegrationEnabled']);
      await chrome.storage.sync.set(saved);
    }, saved);
  }
}
