import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { netflixAudioHtml } from '../../src/providers/netflix/test-utils/audio-fixture';

import { extensionWorker, ROOT, type BrowserContext, type Page, type Route } from './helpers';
import { assertAutoTheaterEntry } from './provider-auto-theater';
import { watchBridgeQuery } from './providers';

const WATCH = 'https://www.netflix.com/watch/12345';
/** The MAIN snapshot publisher's video id, or null where no Netflix MAIN script runs. */
const snapshotVideoId = (page: Page) => page.evaluate(() => {
  const text = document.getElementById('theater-everywhere-netflix-snapshot')?.textContent;
  return text ? (JSON.parse(text) as { videoId?: string }).videoId ?? null : null;
});

/** Real installed isolated/MAIN scripts on synthetic Cadmium data. No authenticated Netflix claim. */
export async function assertNetflixProvider(page: Page, context: BrowserContext): Promise<void> {
  const worker = await extensionWorker(context);
  const keys = ['autoEnterTheater', 'netflixIntegrationEnabled', 'audioPreferenceByHost'];
  const saved = await worker.evaluate(keys => chrome.storage.sync.get(keys), keys);
  const media = readFileSync(path.join(ROOT, 'test/fixtures/vod.webm'));
  const html = netflixAudioHtml.replace('</body>', `<script>fetch('/fixture.webm').then(response => response.blob()).then(blob => { document.querySelector('video').src = URL.createObjectURL(blob); });</script></body>`);
  const hosts = /^https:\/\/(?:www\.netflix\.com\.?|netflix\.com\.evil\.test|generic\.example\.test)\//;
  const handler = async (route: Route) => {
    if (new URL(route.request().url()).pathname === '/fixture.webm') await route.fulfill({ contentType: 'video/webm', body: media });
    else await route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
  };
  const ready = () => page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts')
    && (document.querySelector('video')?.readyState ?? 0) >= 2);
  const openAudio = async () => {
    await page.locator('.player-settings-btn').click();
    await page.locator('.audio-track-btn').click();
    await page.locator('#theater-audio-track-list .theater-cc-menu-item').first().waitFor();
  };
  await context.route(hosts, handler);
  try {
    await worker.evaluate(() => chrome.storage.sync.set({ autoEnterTheater: false, netflixIntegrationEnabled: true, audioPreferenceByHost: {} }));
    await page.goto(WATCH);
    await ready();
    const query = watchBridgeQuery(page);
    assert.equal(await query(), 'pilot-query', 'the MAIN provider answers the validated watch bridge');
    await page.waitForFunction(() => document.getElementById('theater-everywhere-netflix-snapshot') !== null);
    assert.equal(await snapshotVideoId(page), '12345', 'the MAIN snapshot publisher runs from the host script');
    await page.keyboard.press('t');
    await page.locator('.theater-controls-wrapper').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('theater-everywhere-netflix-stage')), true, 'stage through the provider');
    await openAudio();
    assert.equal(await page.locator('#theater-audio-track-list .theater-cc-menu-item').count(), 13);
    await page.locator('#theater-audio-track-list .theater-cc-menu-item').filter({ hasText: /^polski$/ }).click();
    await page.locator('[data-language-line="audio"]').filter({ hasText: 'polski' }).waitFor();
    await page.waitForFunction('nf.current.trackId === "A:2:1;2;pl;0;0;0;"');
    assert.equal((await worker.evaluate(() => chrome.storage.sync.get('audioPreferenceByHost'))).audioPreferenceByHost?.['netflix.com'], 'pl');
    await page.keyboard.press('Escape');
    await page.locator('.theater-controls-wrapper').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate('nf.listenerCount()'), 0, 'exit removes Cadmium listeners');
    assert.equal(await page.evaluate('nf.current.trackId'), 'A:2:1;2;pl;0;0;0;', 'exit keeps the user choice');

    await worker.evaluate(() => chrome.storage.sync.set({ netflixIntegrationEnabled: false }));
    await page.reload();
    await ready();
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-te-netflix-integration-off'));
    assert.equal(await query(), 'pilot-query', 'MAIN identity stays available with RTE off');
    await page.keyboard.press('t');
    await page.locator('.theater-controls-wrapper').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('theater-everywhere-netflix-stage')), true, 'the native stage stays with RTE off');
    await page.locator('.player-settings-btn').click();
    assert.equal(await page.locator('.audio-track-btn').isHidden(), true);
    await page.keyboard.press('Escape');
    await worker.evaluate(() => chrome.storage.sync.set({ netflixIntegrationEnabled: true }));

    for (const host of ['generic.example.test', 'netflix.com.evil.test']) {
      await page.goto(`https://${host}/watch/12345`);
      await ready();
      assert.equal(await page.evaluate(() => {
        const video = document.querySelector('video')!;
        video.dispatchEvent(new CustomEvent('theater-everywhere-netflix-audio-query', { bubbles: true,
          detail: JSON.stringify({ requestId: 'smoke', clientId: 'smoke', mediaId: '12345', pageHref: location.href, observe: false }) }));
        return document.getElementById('theater-everywhere-netflix-audio')?.textContent ?? null;
      }), null, 'no Netflix audio bridge on a non-matching host');
      assert.equal(await snapshotVideoId(page), null, 'no Netflix MAIN script on a non-matching host');
      assert.equal(await query(), null, 'no Netflix watch bridge on a non-matching host');
      await page.keyboard.press('t');
      await page.locator('.theater-controls-wrapper').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('theater-everywhere-netflix-stage')), false, 'generic stage on a non-matching host');
      await page.keyboard.press('Escape');
    }
    await page.goto('https://www.netflix.com./watch/12345');
    await ready();
    await page.keyboard.press('t');
    await page.locator('.theater-controls-wrapper').waitFor();
    await openAudio();
    assert.equal(await page.locator('#theater-audio-track-list .theater-cc-menu-item').count(), 13, 'terminal DNS dot');
    await page.keyboard.press('Escape');

    await page.goto('https://generic.example.test/');
    await ready();
    const childUrl = 'https://www.netflix.com/watch/12345';
    await page.evaluate(url => { const frame = document.createElement('iframe'); frame.src = url; document.body.append(frame); }, childUrl);
    await page.frameLocator('iframe').locator('video').waitFor();
    const frame = page.frames().find(candidate => candidate.url() === childUrl)!;
    await frame.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
    assert.equal(await frame.evaluate(() => {
      document.querySelector('video')!.dispatchEvent(new CustomEvent('theater-everywhere-netflix-audio-query', { bubbles: true,
        detail: JSON.stringify({ requestId: 'frame', clientId: 'frame', mediaId: '12345', pageHref: location.href, observe: false }) }));
      return JSON.parse(document.getElementById('theater-everywhere-netflix-audio')?.textContent ?? 'null')?.list.tracks.length;
    }), 13, 'Netflix bridge registers in its own matching frame');
    assert.equal(await snapshotVideoId(page), null, 'the generic parent loads no Netflix script');
    // Netflix moves between episodes with pushState and a new player session on the same element.
    await assertAutoTheaterEntry(page, context, 'netflix', { url: WATCH, navigate: next => next.evaluate(() => {
      const scope = window as unknown as { nf: unknown; nfCreate(id: string, element: Element | null): unknown };
      scope.nf = scope.nfCreate('67890', document.querySelector('.watch-video video'));
      history.pushState({}, '', '/watch/67890');
    }) });
    console.log('smoke Netflix provider scripts: MAIN watch bridge and snapshot publisher, stage through the provider, installed isolated/MAIN audio JSON bridge, live-object setter, shared menu/HUD/preference, exit cleanup, RTE off, spoofed/generic hosts generic, DNS dot, matching frame registration and AutoTheater across an episode change passed (synthetic fixture)');
  } finally {
    await context.unroute(hosts, handler);
    await worker.evaluate(async ({ keys, saved }) => { await chrome.storage.sync.remove(keys); await chrome.storage.sync.set(saved); }, { keys, saved });
  }
}
