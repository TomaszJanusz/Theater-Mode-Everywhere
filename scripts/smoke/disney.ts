import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { BrowserContext, Page, Route } from './helpers';
import { extensionWorker, ROOT } from './helpers';

const DISNEY = 'https://www.disneyplus.com/pl-pl/play/86e14fdb-3841-4282-ad38-07c8c4aab4b6';
/** Hive's audio API in its measured shape, on the element as an expando; a pick lands at once here. */
const disneyFixture = `<!doctype html><html><head><title>Disney+</title></head><body>
<disney-web-player><video class="hive-video" muted style="width:640px;height:360px"></video></disney-web-player>
<script>
const web = document.querySelector('disney-web-player');
const track = (id, name, language, title) => ({ id, name, language, hasDescribesVideo: false, hasDialogueEnhancement: false, isSelected: false, displayName: { title } });
const tracks = [track(1, 'English', 'en', 'English'), track(14, 'Polish', 'pl', 'Polski')];
const listeners = new Set();
let selected = tracks[0];
let state = { player: { extensions: { audio: { tracks } } } };
web.mediaPlayer = { audio: { get availableTracks() { return tracks; }, get selectedTrack() { return selected; },
  setTrack(next) { selected = next; state = { player: { extensions: { audio: { tracks, selected: next.id } } } }; listeners.forEach(listener => listener()); } } };
web.stateStore = { getState: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
window.selectedAudio = () => selected.id;
fetch('/fixture.webm').then(response => response.blob()).then(blob => { document.querySelector('video').src = URL.createObjectURL(blob); });
</script></body></html>`;

/** Disney+ audio loads per host beside the legacy integration: installed-extension evidence on intercepted host URLs. */
export async function assertDisneyProvider(page: Page, context: BrowserContext): Promise<void> {
  const worker = await extensionWorker(context);
  // chrome.storage.sync allows 120 writes a minute and CI runs the whole Chromium smoke inside one, so this case
  // spends two: the pick's own save and RTE off. It restores nothing: no later case visits Disney+, the throwaway
  // profile keeps only Disney+ keys, and a restore would be a third write. AutoTheater stays: the fixture never plays.
  const saved = await worker.evaluate(() => chrome.storage.sync.get('audioPreferenceByHost'));
  const media = readFileSync(path.join(ROOT, 'test/fixtures/vod.webm'));
  const handler = async (route: Route) => {
    if (new URL(route.request().url()).pathname === '/fixture.webm') await route.fulfill({ contentType: 'video/webm', body: media });
    else await route.fulfill({ contentType: 'text/html', body: disneyFixture });
  };
  const hosts = /^https:\/\/(?:www\.disneyplus\.com|www\.disneyplus\.com\.evil\.test|player\.example\.test)\//;
  await context.route(hosts, handler);
  // The MAIN entry answers the provider's own query; nothing answers where it is not loaded.
  const tracks = () => page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('theater-everywhere-disney-audio-query', { detail: 'smoke-query' }));
    const text = document.getElementById('theater-everywhere-disney-audio')?.textContent;
    return text ? (JSON.parse(text) as { tracks: unknown[] }).tracks.length : null;
  });
  const ready = () => page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts') && document.querySelector('video')!.readyState >= 2);
  const row = page.locator('.theater-settings-menu .audio-track-btn');
  const controls = page.locator('.theater-controls-wrapper');
  const exitTheater = async () => {
    await page.keyboard.press('Escape');
    await controls.waitFor({ state: 'detached' });
  };
  const openSettings = async () => {
    await page.keyboard.press('t');
    await controls.waitFor();
    await page.locator('.player-settings-btn').click();
    await row.waitFor({ state: 'attached' });
  };
  try {
    await page.goto(DISNEY);
    await ready();
    assert.equal(await tracks(), 2, 'MAIN reads Hive in the page world');
    await openSettings();
    await row.click();
    await page.locator('#theater-audio-track-list .theater-cc-menu-item').filter({ hasText: 'Polski' }).click();
    await page.waitForFunction(() => (window as unknown as { selectedAudio(): number }).selectedAudio() === 14);
    // The isolated adapter confirms by reading Hive back, after its debounce; the notice follows the accepted pick,
    // whose preference write is already queued, so one read after it sees the write.
    await page.locator('.theater-everywhere-caption-hud [data-language-line="audio"]').filter({ hasText: 'Polski' }).waitFor();
    await exitTheater();
    const before = (saved.audioPreferenceByHost ?? {}) as Record<string, string>;
    assert.deepEqual((await worker.evaluate(() => chrome.storage.sync.get('audioPreferenceByHost'))).audioPreferenceByHost,
      { ...before, 'disneyplus.com': 'pl' }, 'only this service\'s preference changes');

    for (const url of ['https://www.disneyplus.com.evil.test/play/86e14fdb-3841-4282-ad38-07c8c4aab4b6', 'https://player.example.test/play/86e14fdb-3841-4282-ad38-07c8c4aab4b6']) {
      await page.goto(url);
      await ready();
      assert.equal(await tracks(), null, `${url} must not load the Disney+ provider`);
    }

    // Last: Disney+ stays off for the rest of this profile.
    await worker.evaluate(() => chrome.storage.sync.set({ disneyIntegrationEnabled: false }));
    await page.goto(DISNEY);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-te-disney-integration-off'));
    await ready();
    assert.equal(await tracks(), null, 'MAIN stays silent with RTE off, so the adapter lists nothing');
    console.log('smoke provider scripts: Disney+ audio registration in both worlds, pick confirmed by Hive and saved, RTE off, spoofed/generic host passed (installed fixture)');
  } finally {
    await context.unroute(hosts, handler);
  }
}
