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
// The host's own metadata and thumbnail requests, harvested by the provider's MAIN script.
fetch('https://disney.api.edge.bamgrid.com/explore/v1.21/playerExperience/smoke').then(response => response.json());
const bif = new XMLHttpRequest();
bif.open('GET', 'https://vod-bgc-eu-west-1.media.dssott.com/thumbnails/smoke/BIF/smoke.bif');
bif.responseType = 'blob';
bif.send();
fetch('/fixture.webm').then(response => response.blob()).then(blob => { document.querySelector('video').src = URL.createObjectURL(blob); });
</script></body></html>`;

/** A Roku BIF of eight one-byte frames: the shape the provider accepts as a timeline thumbnail set. */
function smokeBif(): Buffer {
  const count = 8;
  const bytes = Buffer.alloc(64 + (count + 1) * 8 + count);
  Buffer.from([0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32LE(count, 12);
  bytes.writeUInt32LE(1000, 16);
  for (let index = 0; index <= count; index++) {
    bytes.writeUInt32LE(index < count ? index * 10 : 0xffffffff, 64 + index * 8);
    bytes.writeUInt32LE(64 + (count + 1) * 8 + index, 68 + index * 8);
  }
  return bytes;
}

/** What the provider's MAIN script publishes for the page, or null where it does not run. */
const snapshot = (page: Page) => page.evaluate(() => {
  const text = document.getElementById('theater-everywhere-disney-snapshot')?.textContent;
  return text ? JSON.parse(text) as { title?: string; bifBlobUrl?: string } | null : null;
});

/** Disney+ loads per host: installed-extension evidence on intercepted host URLs. */
export async function assertDisneyProvider(page: Page, context: BrowserContext): Promise<void> {
  const worker = await extensionWorker(context);
  // Three sync writes (its declared budget): the pick's own save, RTE off, and one restore of both keys, so a later
  // scenario's own restore does not count this case's leftovers. AutoTheater stays as it is: the fixture never plays.
  const keys = ['disneyIntegrationEnabled', 'audioPreferenceByHost'];
  const saved = await worker.evaluate(keys => chrome.storage.sync.get(keys), keys);
  const media = readFileSync(path.join(ROOT, 'test/fixtures/vod.webm'));
  const handler = async (route: Route) => {
    if (new URL(route.request().url()).pathname === '/fixture.webm') await route.fulfill({ contentType: 'video/webm', body: media });
    else await route.fulfill({ contentType: 'text/html', body: disneyFixture });
  };
  const hosts = /^https:\/\/(?:www\.disneyplus\.com|www\.disneyplus\.com\.evil\.test|player\.example\.test)\//;
  const assets = /^https:\/\/(?:disney\.api\.edge\.bamgrid\.com|vod-bgc-eu-west-1\.media\.dssott\.com)\//;
  const assetHandler = async (route: Route) => {
    const headers = { 'access-control-allow-origin': '*' };
    if (route.request().url().endsWith('.bif')) await route.fulfill({ contentType: 'application/octet-stream', headers, body: smokeBif() });
    else await route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify({ data: { playerExperience: { title: 'Smoke Title', subtitle: 'S1:E1' } } }) });
  };
  await context.route(hosts, handler);
  await context.route(assets, assetHandler);
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
    // JSON through the registered harvest, the BIF Blob through its binary target.
    await page.waitForFunction(() => {
      const text = document.getElementById('theater-everywhere-disney-snapshot')?.textContent;
      const published = text ? JSON.parse(text) as { title?: string; bifBlobUrl?: string } | null : null;
      return published?.title === 'Smoke Title' && published.bifBlobUrl?.startsWith('blob:');
    });
    await openSettings();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('theater-everywhere-disney-stage')), true, 'stage through the provider');
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
      assert.equal(await snapshot(page), null, `${url} must not harvest for Disney+`);
    }

    // Last, so the restore below also switches it back on.
    await worker.evaluate(() => chrome.storage.sync.set({ disneyIntegrationEnabled: false }));
    await page.goto(DISNEY);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-te-disney-integration-off'));
    await ready();
    assert.equal(await tracks(), null, 'MAIN stays silent with RTE off, so the adapter lists nothing');
    console.log('smoke provider scripts: Disney+ per-host provider: JSON and BIF harvest, stage, audio pick confirmed by Hive and saved, RTE off, spoofed/generic host passed (installed fixture)');
  } finally {
    await context.unroute(hosts, handler);
    await context.unroute(assets, assetHandler);
    // One write: the keys were absent in the fresh profile; a set is needed only for keys that existed.
    await worker.evaluate(async ({ keys, saved }) => {
      const absent = keys.filter(key => !(key in saved));
      if (absent.length) await chrome.storage.sync.remove(absent);
      if (Object.keys(saved).length) await chrome.storage.sync.set(saved);
    }, { keys, saved });
  }
}
