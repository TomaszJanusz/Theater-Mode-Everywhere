import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import type { Page } from 'playwright';

import { sharedEngineBrowsers } from '../test-utils/engine-browsers';
import { bootPlayer, enterTheater } from '../test-utils/player-boot';
import { testEngines } from '../test-utils/test-engines';
import { canvasVideoFixture, serveFixture } from '../test-utils/video-fixtures';

const browsers = sharedEngineBrowsers();
const HOST = 'player-boot.test';

/**
 * Gives the fixture video the `HTMLMediaElement.audioTracks` list that Safari ships and Chromium
 * and Firefox keep behind a flag: the generic path through the shared contract, menu and preference.
 */
const installAudioTracks = (tracks: Array<{ id: string; language: string; label: string; kind: string; enabled: boolean }>) => {
  const video = document.querySelector('video')!;
  const list = new EventTarget() as EventTarget & Record<number, unknown> & { length: number };
  const changes: string[] = [];
  tracks.forEach((track, index) => {
    let enabled = track.enabled;
    list[index] = {
      ...track,
      get enabled() { return enabled; },
      set enabled(value: boolean) {
        if (value === enabled) return;
        enabled = value;
        if (value) changes.push(track.id);
        queueMicrotask(() => list.dispatchEvent(new Event('change')));
      }
    };
  });
  list.length = tracks.length;
  Object.defineProperty(video, 'audioTracks', { value: list });
  Object.assign(window, { __audioChanges: changes, __enabled: () => tracks.map((_, index) => (list[index] as { enabled: boolean }).enabled) });
};

const DUBBED = [
  { id: 'en', language: 'en', label: 'English', kind: 'main', enabled: true },
  { id: 'fr', language: 'fr', label: 'Français', kind: 'translation', enabled: false },
  { id: 'de', language: 'de', label: 'Deutsch', kind: 'translation', enabled: false },
  { id: 'ad', language: 'en', label: 'English AD', kind: 'description', enabled: false }
];

async function open(test: TestContext, engine: 'chromium' | 'firefox', settings: Record<string, unknown>, tracks = DUBBED): Promise<Page> {
  const page = await (await browsers[engine].newContext(test, { viewport: { width: 1280, height: 720 } })).newPage();
  await serveFixture(page, canvasVideoFixture({ title: 'Dubbed' }), `http://${HOST}/`);
  // tsx wraps named functions in __name(); the serialized fixture needs it before bootPlayer defines it.
  await page.addScriptTag({ content: 'window.__name = (fn) => fn;' });
  await page.evaluate(installAudioTracks, tracks);
  await bootPlayer(page, { settings });
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2);
  await enterTheater(page);
  return page;
}

const enabled = (page: Page) => page.evaluate(() => (window as unknown as { __enabled(): boolean[] }).__enabled());
const changes = (page: Page) => page.evaluate(() => (window as unknown as { __audioChanges: string[] }).__audioChanges);
const saved = (page: Page) => page.evaluate(async () => (await chrome.storage.sync.get('audioPreferenceByHost')).audioPreferenceByHost);
const row = (page: Page) => page.locator('.theater-settings-menu .audio-track-btn');
const rows = (page: Page) => page.locator('#theater-audio-track-list .theater-cc-menu-item');

async function openAudioMenu(page: Page): Promise<void> {
  await page.locator('.player-settings-btn').click();
  await row(page).click();
  await rows(page).first().waitFor();
}

describe('audio track menu and per-service preference', () => {
  for (const engine of testEngines()) {
    it(`applies this service's saved language once, and only this service's, in ${engine}`, async t => {
      const page = await open(t, engine, { audioPreferenceByHost: { [HOST]: 'fr', 'other.test': 'de' } });
      await page.waitForFunction(() => (window as unknown as { __audioChanges: string[] }).__audioChanges.length > 0);
      assert.deepEqual(await changes(page), ['fr']);
      assert.deepEqual(await enabled(page), [false, true, false, false]);

      const isolated = await open(t, engine, { audioPreferenceByHost: { 'other.test': 'de', 'youtube.com': 'original' } });
      await row(isolated).waitFor({ state: 'attached' });
      assert.deepEqual(await changes(isolated), [], 'another service\'s preference never applies');
    });

    it(`lists tracks, saves a pick for this service and resets it to the service default in ${engine}`, async t => {
      const page = await open(t, engine, {});
      await page.locator('.player-settings-btn').click();
      await assert.doesNotReject(row(page).waitFor());
      assert.equal(await row(page).getAttribute('aria-label'), 'Audio track: English');
      await row(page).click();
      assert.deepEqual(await rows(page).evaluateAll(items => items.map(item => [item.textContent?.replace('✓', ''), item.getAttribute('aria-pressed')])),
        [['English', 'true'], ['Français', 'false'], ['Deutsch', 'false'], ['English AD', 'false']]);
      assert.equal(await page.locator('.theater-audio-track-reset').isHidden(), true, 'nothing saved, nothing to reset');

      // Keyboard and pointer share one path: arrows move, Enter picks, Escape goes back.
      await rows(page).first().focus();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.theater-settings-subview').isHidden(), true);
      assert.equal(await row(page).evaluate(element => element.matches(':focus')), true, 'Escape returns to the Audio track row');
      await page.keyboard.press('Enter');
      await rows(page).nth(2).focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => (window as unknown as { __audioChanges: string[] }).__audioChanges.includes('de'));
      assert.deepEqual(await enabled(page), [false, false, true, false]);
      await page.waitForFunction(async () => (await chrome.storage.sync.get('audioPreferenceByHost')).audioPreferenceByHost?.['player-boot.test'] === 'de');

      await openAudioMenu(page);
      await rows(page).nth(3).click();
      await page.waitForFunction(() => (window as unknown as { __audioChanges: string[] }).__audioChanges.includes('ad'));
      assert.deepEqual(await saved(page), { [HOST]: 'de' }, 'an audio description pick is not saved as the language');

      await openAudioMenu(page);
      const reset = page.locator('.theater-audio-track-reset');
      assert.equal(await reset.textContent(), 'Service default');
      await reset.click();
      await page.waitForFunction(async () => !(await chrome.storage.sync.get('audioPreferenceByHost')).audioPreferenceByHost?.['player-boot.test']);
      assert.equal(await reset.isHidden(), true);
      assert.deepEqual(await enabled(page), [false, false, false, true], 'resetting keeps the current track');
    });

    it(`hides the row with fewer than two tracks in ${engine}`, async t => {
      const page = await open(t, engine, { audioPreferenceByHost: { [HOST]: 'fr' } }, DUBBED.slice(0, 1));
      await page.locator('.player-settings-btn').click();
      await page.locator('.theater-settings-menu .help-btn').waitFor();
      assert.equal(await row(page).isHidden(), true);
      assert.deepEqual(await changes(page), []);
    });
  }
});
