import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { BrowserContext, Page, Route } from './helpers';
import { extensionWorker, ROOT } from './helpers';

const POST = 'https://www.reddit.com/r/fixture/comments/1fx7rec/recorded_post/';
// The recorded player (test/host-fixtures/reddit-post-player.json): shadow roots as declarative shadow DOM.
const player = readFileSync(path.join(ROOT, 'test/host-fixtures/reddit-post-player.html'), 'utf8').replace(/^<!--[\s\S]*?-->\n/, '')
  .replace('<video aria-label="video player"></video>', '<style>video { width: 100%; height: 100%; }</style><video aria-label="video player" muted playsinline></video>');
const fixture = `<!doctype html><html><head><title>Recorded post title for fixture : r/fixture</title>
<style>shreddit-player { display: block; width: 640px; height: 360px; }</style></head><body>${player}<script>
const video = document.querySelector('shreddit-player').shadowRoot.querySelector('video');
video.addTextTrack('subtitles', 'English', 'en');
fetch('/fixture.webm').then(response => response.blob()).then(blob => { video.src = URL.createObjectURL(blob); });
</script></body></html>`;

type Target = Page | ReturnType<Page['mainFrame']>;

const ready = (target: Target) => target.waitForFunction(() => {
  const video = document.querySelector('shreddit-player')?.shadowRoot?.querySelector('video');
  return document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts') && Boolean(video && video.readyState >= 2);
});
/** Whether the provider's stage hid Reddit's own caption box. */
const overlayHidden = (target: Target) => target.evaluate(() => document.querySelector('shreddit-player')!.shadowRoot!.querySelector('shreddit-media-ui')!
  .shadowRoot!.querySelector<HTMLElement>('shreddit-caption-overlay')!.style.getPropertyValue('display') === 'none');
const key = (target: Target, code: 'KeyT' | 'Escape') => target.evaluate(code => document.dispatchEvent(new KeyboardEvent('keydown',
  { key: code === 'KeyT' ? 't' : 'Escape', code, bubbles: true, cancelable: true })), code);
const inTheater = (target: Target, on: boolean) => target.waitForFunction(on => document.documentElement.classList.contains('theater-everywhere-html-active') === on, on);

/** Installed extension on intercepted URLs with the recorded player; never real-host evidence. */
export async function assertRedditProvider(page: Page, context: BrowserContext): Promise<void> {
  const worker = await extensionWorker(context);
  const saved = await worker.evaluate(() => chrome.storage.sync.get(['autoEnterTheater', 'redditIntegrationEnabled']));
  const media = readFileSync(path.join(ROOT, 'test/fixtures/vod.webm'));
  const hosts = /^https:\/\/(?:www\.reddit\.com\.?|embed\.reddit\.com|v\.redd\.it|reddit\.com\.evil\.test|player\.example\.test)\//;
  const handler = async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/fixture.webm') await route.fulfill({ contentType: 'video/webm', body: media });
    else if (url.hostname === 'v.redd.it') await route.fulfill({ contentType: 'text/vtt', headers: { 'access-control-allow-origin': '*' }, body: 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nFixture cue\n' });
    else if (url.hostname === 'player.example.test' && url.pathname === '/frame') await route.fulfill({ contentType: 'text/html', body: `<!doctype html><iframe src="https://embed.reddit.com/r/fixture/comments/1fx7rec/recorded_post/" width="700" height="400"></iframe>` });
    else await route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture });
  };
  await context.route(hosts, handler);
  try {
    await worker.evaluate(() => chrome.storage.sync.set({ autoEnterTheater: false, redditIntegrationEnabled: true }));
    await page.goto(POST);
    await ready(page);
    await key(page, 'KeyT');
    await inTheater(page, true);
    await page.locator('.theater-title-hud-text', { hasText: 'Recorded post title for fixture' }).first().waitFor({ state: 'attached' });
    await page.locator('.cc-btn.active').waitFor({ state: 'attached' });
    assert.equal(await overlayHidden(page), true, 'Reddit\'s caption box steps aside in theater');
    await key(page, 'Escape');
    await inTheater(page, false);
    assert.equal(await overlayHidden(page), false, 'exit hands the box back');
    // RTE off: the stage still hides the unseen box, but no Reddit data: no post title, no caption file.
    await worker.evaluate(() => chrome.storage.sync.set({ redditIntegrationEnabled: false }));
    await page.goto('https://www.reddit.com./r/fixture/comments/1fx7rec/recorded_post/');
    await ready(page);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-te-reddit-integration-off'));
    await key(page, 'KeyT');
    await inTheater(page, true);
    assert.equal(await overlayHidden(page), true, 'the terminal-dot host loads the provider too');
    assert.equal(await page.locator('.cc-btn.active').count(), 0, 'with the integration off Reddit\'s caption file is not used');
    await key(page, 'Escape');
    await inTheater(page, false);
    await worker.evaluate(() => chrome.storage.sync.set({ redditIntegrationEnabled: true }));
    for (const url of ['https://player.example.test/', 'https://reddit.com.evil.test/r/fixture/comments/1fx7rec/recorded_post/']) {
      await page.goto(url);
      await ready(page);
      await key(page, 'KeyT');
      await inTheater(page, true);
      assert.equal(await overlayHidden(page), false, `${url} must not load the Reddit provider`);
      await key(page, 'Escape');
      await inTheater(page, false);
    }
    // Reddit's embed in a third-party page: the provider loads in the Reddit frame only.
    await page.goto('https://player.example.test/frame');
    const frame = await (await page.waitForSelector('iframe')).contentFrame();
    assert.ok(frame);
    await ready(frame);
    await key(frame, 'KeyT');
    await inTheater(frame, true);
    assert.equal(await overlayHidden(frame), true, 'the Reddit frame loads the provider');
    await key(frame, 'Escape');
    await inTheater(frame, false);
    console.log('smoke Reddit provider: shadow-DOM entry, post title, Reddit\'s caption setting, caption box hidden and restored, RTE off, terminal dot, generic/spoofed hosts and own-frame admission passed (installed fixture; real host verified separately)');
  } finally {
    await context.unroute(hosts, handler);
    await worker.evaluate(async saved => {
      await chrome.storage.sync.remove(['autoEnterTheater', 'redditIntegrationEnabled']);
      await chrome.storage.sync.set(saved);
    }, saved);
  }
}
