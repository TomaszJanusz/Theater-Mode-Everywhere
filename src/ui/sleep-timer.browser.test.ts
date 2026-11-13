import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { chromium, type BrowserContext, type Page } from 'playwright';

import type { SleepTimerBroadcast } from '../core/sleep-timer';
import { createSleepTimerOwner } from '../platform/sleep-timer-owner';
import { sharedEngineBrowsers } from '../test-utils/engine-browsers';
import { CHROMIUM_BUILD, installedBuildReady } from '../test-utils/installed-build';
import { bootPlayer, enterTheater } from '../test-utils/player-boot';
import { skipUnlessEngine, testEngines } from '../test-utils/test-engines';
import { canvasVideoFixture, serveFixture } from '../test-utils/video-fixtures';

const browsers = sharedEngineBrowsers();
const FIXTURE = canvasVideoFixture({ title: 'Sleep timer fixture' });
const MINUTE = 60_000;

// The extension messaging a fixture page lacks: requests go to `__sleepTimerRequest` (the test's background), and
// `__deliverSleepTimer` plays the background's broadcast to this frame's listeners. A string, like the storage stub.
const MESSAGING = `(() => {
  const listeners = new Set();
  Object.assign(window.chrome.runtime, {
    sendMessage: message => window.__sleepTimerRequest(message.minutes ?? null),
    onMessage: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) }
  });
  window.__deliverSleepTimer = message => { for (const fn of [...listeners]) fn(message); };
})()`;

const playing = (page: Page) => page.evaluate('(() => { const v = document.querySelector("video"); return v.readyState >= 2 && !v.paused; })()');
const waitPlaying = (page: Page) => page.waitForFunction('(() => { const v = document.querySelector("video"); return v.readyState >= 2 && !v.paused; })()');
const chip = (page: Page) => page.locator('.sleep-timer-chip');

/** Text and accessible name of a shown chip, once it shows `text`. */
async function chipShows(page: Page, text: string): Promise<{ text: string; label: string | null }> {
  await page.locator('.sleep-timer-chip:not([hidden])', { hasText: text }).waitFor();
  return { text: (await chip(page).textContent()) ?? '', label: await chip(page).getAttribute('aria-label') };
}

/** Steps the Sleep timer row of `page`'s settings menu. */
async function step(page: Page, direction: 1 | -1): Promise<void> {
  if (await page.locator('.player-settings-btn').getAttribute('aria-expanded') !== 'true') await page.locator('.player-settings-btn').click();
  await page.locator(`.sleep-timer-btn .theater-stepper-btn[data-direction="${direction}"]`).click();
}

describe('sleep timer across tabs', () => {
  for (const engine of testEngines()) {
    it(`a timer set in one tab shows in both and pauses only the media still playing when it fires in ${engine}`, { timeout: 60_000 }, async t => {
      const context = await browsers[engine].newContext(t, { viewport: { width: 1280, height: 720 } });
      const pages: Page[] = [];
      // The production background logic, on a clock the test moves; its broadcast reaches every open tab.
      let now = Date.now();
      let stored: unknown;
      const owner = createSleepTimerOwner({
        now: () => now,
        read: async () => stored,
        write: async timer => { stored = timer; },
        schedule: async () => {},
        broadcast: async (message: SleepTimerBroadcast) => {
          await Promise.all(pages.map(page => page.evaluate(`window.__deliverSleepTimer(${JSON.stringify(message)})`)));
        }
      });
      const open = async (url: string) => {
        const page = await context.newPage();
        await serveFixture(page, FIXTURE, url);
        await bootPlayer(page, { settings: { keepControlsVisible: true } });
        await page.exposeFunction('__sleepTimerRequest', (minutes: number | null) => owner.request(minutes ?? undefined));
        await page.evaluate(MESSAGING);
        await waitPlaying(page);
        await enterTheater(page);
        pages.push(page);
        return page;
      };
      const tabA = await open('http://sleep-a.test/');
      await chip(tabA).waitFor({ state: 'attached' });
      assert.equal(await chip(tabA).isHidden(), true, 'no timer, no chip');

      await step(tabA, 1);
      // A tab opened after the timer started asks for it and shows the same countdown.
      const tabB = await open('http://sleep-b.test/');
      const shownA = await chipShows(tabA, '15 min');
      assert.deepEqual(await chipShows(tabB, '15 min'), shownA);
      assert.equal(shownA.label, 'Sleep timer: pauses in 15 min');
      assert.equal(await tabA.locator('.sleep-timer-btn .theater-stepper-value').textContent(), '15 min');

      // Off from tab B clears both chips; a new timer from tab A shows in both again.
      await step(tabB, -1);
      await chip(tabA).waitFor({ state: 'hidden' });
      await chip(tabB).waitFor({ state: 'hidden' });
      assert.equal(await tabB.locator('.sleep-timer-btn .theater-stepper-value').textContent(), 'Off');
      await step(tabA, 1);
      await step(tabA, 1);
      await chipShows(tabB, '30 min');

      // Tab A was paused by hand; when the timer fires only tab B pauses, and tab A is not started.
      await tabA.evaluate('document.querySelector("video").pause()');
      now += 30 * MINUTE;
      await owner.reconcile();
      await tabB.waitForFunction('document.querySelector("video").paused');
      assert.equal(await playing(tabA), false);
      const notice = tabB.locator('.theater-everywhere-volume-overlay .volume-hud-text');
      assert.equal(await notice.textContent(), 'Paused by sleep timer');
      assert.equal(await tabA.locator('.theater-everywhere-volume-overlay .volume-hud-text', { hasText: 'Paused by sleep timer' }).count(), 0);
      for (const page of pages) await chip(page).waitFor({ state: 'hidden' });
    });

    it(`the chip opens the settings menu at the Sleep timer row, focusing it only from the keyboard in ${engine}`, { timeout: 60_000 }, async t => {
      const page = await (await browsers[engine].newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      let stored: unknown;
      const owner = createSleepTimerOwner({
        now: () => Date.now(), read: async () => stored, write: async timer => { stored = timer; },
        schedule: async () => {}, broadcast: async message => { await page.evaluate(`window.__deliverSleepTimer(${JSON.stringify(message)})`); }
      });
      await serveFixture(page, FIXTURE, 'http://sleep-keys.test/');
      await bootPlayer(page, { settings: { keepControlsVisible: true } });
      await page.exposeFunction('__sleepTimerRequest', (minutes: number | null) => owner.request(minutes ?? undefined));
      await page.evaluate(MESSAGING);
      await waitPlaying(page);
      await enterTheater(page);
      await step(page, 1);
      await page.keyboard.press('Escape');
      await page.locator('.player-settings-btn[aria-expanded="false"]').waitFor({ state: 'attached' });

      const focusedRow = '(() => document.querySelector("#theater-everywhere-ui").shadowRoot.activeElement?.closest(".sleep-timer-btn") != null)()';
      await chip(page).click();
      await page.locator('.player-settings-btn[aria-expanded="true"]').waitFor({ state: 'attached' });
      assert.equal(await page.evaluate(focusedRow), false, 'a pointer opening leaves focus alone');
      await page.keyboard.press('Escape');
      await page.locator('.player-settings-btn[aria-expanded="false"]').waitFor({ state: 'attached' });

      await chip(page).focus();
      await page.keyboard.press('Enter');
      await page.locator('.player-settings-btn[aria-expanded="true"]').waitFor({ state: 'attached' });
      assert.equal(await page.evaluate(focusedRow), true, 'a keyboard opening lands on the Sleep timer row');
    });
  }
});

/** Theater mode on the fixture in a tab of the installed extension. */
async function installedTab(context: BrowserContext, url: string): Promise<Page> {
  const page = await context.newPage();
  await serveFixture(page, FIXTURE, url);
  await waitPlaying(page);
  await page.keyboard.press('t');
  await page.locator('.theater-controls-wrapper.visible').waitFor();
  return page;
}

// The real background: session storage, the alarm and the broadcast to every tab of the profile.
it('chromium: installed extension pauses another tab when the timer set in the first runs out', { skip: skipUnlessEngine('chromium'), timeout: 90_000 }, async t => {
  if (!installedBuildReady(t, ['manifest.json', 'content.js', 'background.js'])) return;
  if (!existsSync(chromium.executablePath())) { t.skip('Browser not installed'); return; }
  const profile = mkdtempSync(path.join(tmpdir(), 'te-sleep-timer-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 720 },
    args: [`--disable-extensions-except=${CHROMIUM_BUILD}`, `--load-extension=${CHROMIUM_BUILD}`, '--mute-audio']
  });
  t.after(async () => { await context.close(); rmSync(profile, { recursive: true, force: true }); }, { timeout: 10_000 });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const tabA = await installedTab(context, 'http://sleep-a.test/');
  const tabB = await installedTab(context, 'http://sleep-b.test/');

  await step(tabA, 1);
  assert.deepEqual(await chipShows(tabB, '15 min'), await chipShows(tabA, '15 min'));
  const stored = await worker.evaluate(async () => (await chrome.storage.session.get('sleepTimer')).sleepTimer as { minutes: number; deadline: number });
  assert.equal(stored.minutes, 15);
  assert.equal((await worker.evaluate(() => chrome.alarms.get('sleep-timer')))?.scheduledTime, stored.deadline);

  // Fifteen minutes pass: the stored deadline moves into the past and the alarm wakes the worker.
  await tabA.evaluate('document.querySelector("video").pause()');
  await worker.evaluate(async () => {
    const timer = (await chrome.storage.session.get('sleepTimer')).sleepTimer as { minutes: number; deadline: number };
    await chrome.storage.session.set({ sleepTimer: { ...timer, deadline: Date.now() - 1 } });
    await chrome.alarms.create('sleep-timer', { when: Date.now() + 1 });
  });
  await tabB.waitForFunction('document.querySelector("video").paused', undefined, { timeout: 60_000 });
  assert.equal(await playing(tabA), false);
  await chip(tabA).waitFor({ state: 'hidden' });
  await chip(tabB).waitFor({ state: 'hidden' });
  assert.equal(await worker.evaluate(async () => Object.keys(await chrome.storage.session.get(null)).length), 0);
});
