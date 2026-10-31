import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PENDING_UPDATE_KEY } from '../../src/update-notice';

import { extensionWorker, fail, timeScenario, waitForPlayer, type BrowserContext, type ExtensionBackground, type Page } from './helpers';

const PENDING = { version: '2.1.0', since: '2.0' };
const MENU_LABEL = 'Version 2.1 – see what’s new';

/**
 * Where the stored announcement and the toolbar badge can be read: an extension page in Chromium, which
 * Playwright re-checks within its own timeout, or the Firefox background, which waits on storage events.
 */
type Probe = Page | ExtensionBackground;

/** Waits until the announcement is stored (or gone) and the badge says so too. */
async function settled(probe: Probe, announced: boolean, what: string): Promise<void> {
  const args = { key: PENDING_UPDATE_KEY, announced };
  if ('waitForFunction' in probe) {
    await probe.waitForFunction(async ({ key, announced }) => (key in await chrome.storage.local.get(key)) === announced
      && await chrome.action.getBadgeText({}) === (announced ? 'NEW' : ''), args).catch(() => fail(`${what}: the announcement or badge did not follow`));
    return;
  }
  // Callbacks stay anonymous: tsx names named ones through a `__name` helper the background does not have.
  await probe.evaluate(({ key, announced }) => new Promise<void>(resolve => {
    const listeners: Array<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void> = [];
    listeners.push((changes, area) => {
      if (area !== 'local' || !(key in changes) || ('newValue' in changes[key]) !== announced) return;
      chrome.storage.onChanged.removeListener(listeners[0]);
      resolve();
    });
    chrome.storage.onChanged.addListener(listeners[0]);
    void chrome.storage.local.get(key).then(data => {
      if ((key in data) !== announced) return;
      chrome.storage.onChanged.removeListener(listeners[0]);
      resolve();
    });
  }), args);
  // The background's own storage listener, registered first, has already set the badge.
  const badge = await probe.evaluate(() => chrome.action.getBadgeText({}));
  if (badge !== (announced ? 'NEW' : '')) fail(`${what}: the toolbar badge is "${badge}"`);
}

/** Stands in for the background's own write after an update, which background.test.ts covers. */
async function announce(worker: ExtensionBackground, probe: Probe): Promise<void> {
  await worker.evaluate(({ key, value }) => chrome.storage.local.set({ [key]: value }), { key: PENDING_UPDATE_KEY, value: PENDING });
  await settled(probe, true, 'An announced update');
}

async function openPlayerMenu(page: Page): Promise<void> {
  if (!await page.locator('.theater-controls-wrapper').count()) {
    await page.locator('video#player').click();
    await page.keyboard.press('t');
  }
  await page.locator('.player-settings-btn').click();
  await page.locator('.theater-settings-menu').waitFor();
}

/**
 * Every route to Update highlights acknowledges the update through the background, and every open surface follows:
 * the badge, the popup panel and the player menu label. Chromium drives each route; Firefox cannot open extension
 * pages, so it covers the badge, the content script's live label and the player menu route.
 */
export async function assertUpdateNotice(page: Page, origin: string, context: BrowserContext, browser: 'chromium' | 'firefox'): Promise<void> {
  return timeScenario('assertUpdateNotice', { syncWrites: 0 }, async () => {
    const worker = await extensionWorker(context);
    const row = page.locator('.theater-settings-menu .extension-settings-btn');
    const opened: Page[] = [];
    try {
      const popup = browser === 'chromium' ? await context.newPage() : undefined;
      if (popup) {
        opened.push(popup);
        await popup.goto(new URL('popup/popup.html', worker.url()).href);
      }
      const probe = popup ?? worker;
      await page.bringToFront();
      await page.goto(origin);
      await waitForPlayer(page);
      await announce(worker, probe);
      await openPlayerMenu(page);
      await row.getByText(MENU_LABEL, { exact: true }).waitFor();
      if (await row.getAttribute('aria-label') !== MENU_LABEL) fail('The menu row names another update than it shows');
      const settingsOpened = popup ? context.waitForEvent('page') : undefined;
      await row.click();
      const settings = await settingsOpened;
      await settled(probe, false, 'Opening Update highlights from the player menu');
      await openPlayerMenu(page);
      await row.getByText('Extension settings', { exact: true }).waitFor();
      await page.keyboard.press('Escape');
      if (!popup || !settings) {
        console.log('smoke:firefox update notice: badge, live menu label and acknowledgement from the player menu passed');
        return;
      }
      opened.push(settings);
      await settings.getByRole('dialog', { name: 'Update highlights', exact: true }).waitFor();
      if (!settings.url().endsWith('#appearance')) fail(`Settings kept the highlights request in its address: ${settings.url()}`);
      await settings.locator('.te-dialog-btn-primary').click();

      await announce(worker, probe);
      await popup.locator('#update-title').filter({ hasText: 'Updated to 2.1' }).waitFor();
      const screenshots = process.env.SMOKE_SCREENSHOT_DIR;
      if (screenshots) {
        mkdirSync(screenshots, { recursive: true });
        await popup.setViewportSize({ width: 300, height: 360 });
        await popup.locator('.popup-container').screenshot({ path: path.join(screenshots, 'update-popup.png') });
      }
      await popup.getByRole('button', { name: 'See what’s new', exact: true }).click();
      // The open Settings tab is reused and moved to the highlights.
      await settings.getByRole('dialog', { name: 'Update highlights', exact: true }).waitFor();
      await settled(probe, false, 'Opening Update highlights from the popup');
      await popup.locator('#update-card').waitFor({ state: 'hidden' });
      await settings.locator('.te-dialog-btn-primary').click();

      await announce(worker, probe);
      await popup.locator('#update-card').waitFor();
      await settings.getByRole('button', { name: 'Update highlights', exact: true }).click();
      await settled(probe, false, 'Opening Update highlights in Settings');
      await popup.locator('#update-card').waitFor({ state: 'hidden' });
      console.log('smoke:chromium update notice: badge, popup panel, menu label and acknowledgement from the player menu, popup and Settings passed');
    } finally {
      await worker.evaluate(key => chrome.storage.local.remove(key), PENDING_UPDATE_KEY);
      for (const extensionPage of opened) await extensionPage.close();
      // Firefox's Settings tab is outside Playwright's reach; the background closes what the scenario opened.
      await worker.evaluate(async () => {
        const settings = (await chrome.tabs.query({})).filter(tab => tab.url?.includes('/options/options.html') && tab.id !== undefined);
        if (settings.length) await chrome.tabs.remove(settings.map(tab => tab.id!));
      });
    }
  });
}

/**
 * The badge after a browser restart, in a profile of its own. Browsers do not keep badge text across a restart;
 * the background applies the stored announcement again when it starts. Chromium reports a command-line extension
 * as installed on every launch and cannot reload one to a new version here, so the update itself is the unit test's
 * (background.test.ts) and a real store update stays a live check.
 */
export async function assertBadgeAfterRestart(
  unpackedDir: string, launchExtension: (userDataDir: string, unpackedDir: string) => Promise<BrowserContext>
): Promise<void> {
  return timeScenario('assertBadgeAfterRestart', { syncWrites: 0 }, async () => {
    const profile = mkdtempSync(path.join(tmpdir(), 'te-smoke-restart-'));
    const probe = async (context: BrowserContext) => {
      const page = await context.newPage();
      await page.goto(new URL('popup/popup.html', (await extensionWorker(context)).url()).href);
      return page;
    };
    let context: BrowserContext | null = null;
    try {
      context = await launchExtension(profile, unpackedDir);
      await (await extensionWorker(context)).evaluate(({ key, value }) => chrome.storage.local.set({ [key]: value }), { key: PENDING_UPDATE_KEY, value: PENDING });
      await settled(await probe(context), true, 'An announced update');
      await context.close();
      context = await launchExtension(profile, unpackedDir);
      await settled(await probe(context), true, 'After a browser restart');
      const tabs = context.pages().map(page => page.url());
      if (tabs.some(url => url.includes('options/options.html'))) fail('Starting the browser opened Settings');
      console.log('smoke:chromium update badge restored after a browser restart, without opening Settings, passed');
    } finally {
      await context?.close();
      rmSync(profile, { recursive: true, force: true });
    }
  });
}
