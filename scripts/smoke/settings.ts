import { defaultMediaProviderFlags, mediaProviderFlagStorageKeys, mediaProviderFlagStorageUpdate } from '../../src/media-features/provider-flags';
import { WHATS_NEW_ACK_STORAGE_KEY, WHATS_NEW_RELEASE } from '../../src/whatsNew-release';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { type BrowserContext, type Page } from 'playwright';

import { fail, extensionWorker, timeScenario } from './helpers';
export async function assertRteSettings(context: BrowserContext): Promise<void> {
  return timeScenario('assertRteSettings', async () => {
    const worker = await extensionWorker(context);
    const page = await context.newPage();
    const keys = [...mediaProviderFlagStorageKeys(), 'language'];
    const original = await worker.evaluate(keys => chrome.storage.sync.get(keys), keys);
    const captureDir = process.env.THEATER_RTE_SCREENSHOT_DIR;
    const capture = async (name: string, fullPage = true) => {
      if (captureDir) {
        mkdirSync(captureDir, { recursive: true });
        if (fullPage) {
          await page.evaluate(() => scrollTo(0, 0));
          await page.waitForFunction(() => scrollY === 0);
        }
        await page.screenshot({ path: path.join(captureDir, name), fullPage });
      }
    };
    try {
      await worker.evaluate(async ({ key, id }) => { await chrome.storage.local.set({ [key]: id }); }, { key: WHATS_NEW_ACK_STORAGE_KEY, id: WHATS_NEW_RELEASE.id });
      await worker.evaluate(update => chrome.storage.sync.set(update), { ...mediaProviderFlagStorageUpdate(defaultMediaProviderFlags()), language: 'en' });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(new URL('options/options.html#features', worker.url()).href);
      await page.waitForFunction(() => document.querySelectorAll('.rte-tile').length === 10 && [...document.querySelectorAll<HTMLInputElement>('.rte-tile input')].every(input => input.checked));
      await capture('tme60-section.png');
      // Only what needs the installed extension stays here: real chrome.storage defaults, writes and live updates
      // across contexts. Hover, filters, master scoping, details, narrow and sticky layouts, and RTL are covered by
      // options/rte-settings.browser.test.ts.
      const netflix = page.locator('[data-provider="netflix"]');
      await netflix.locator('.rte-control').click();
      await page.waitForFunction(() => (document.getElementById('rte-all') as HTMLInputElement).indeterminate);
      const saved = await worker.evaluate(async () => chrome.storage.sync.get(['netflixIntegrationEnabled', 'youtubeIntegrationEnabled']));
      if (saved.netflixIntegrationEnabled !== false || saved.youtubeIntegrationEnabled !== true) fail('RTE tile changed an unrelated provider flag.');
      await capture('tme47-rte-partial.png');
      await worker.evaluate(() => chrome.storage.sync.set({ netflixIntegrationEnabled: true }));
      await page.waitForFunction(() => (document.getElementById('rte-netflix') as HTMLInputElement).checked);
      console.log('smoke RTE settings: installed tiles, default flags, one-provider write and live storage update passed');
    } finally {
      await worker.evaluate(async ({ keys, original }) => {
        await chrome.storage.sync.remove(keys);
        await chrome.storage.sync.set(original);
      }, { keys, original });
      await page.close();
    }
  });
}

export async function assertPictureLayout(page: Page, context: BrowserContext): Promise<void> {
  return timeScenario('assertPictureLayout', async () => {
    const video = page.locator('video#player');
    const gear = page.locator('.player-settings-btn');
    const row = page.locator('.picture-layout-btn');
    await page.setViewportSize({ width: 1280, height: 900 });
    await gear.click();
    await row.waitFor();
    if (await row.getAttribute('aria-keyshortcuts') !== 'Shift+L') fail('Layout shortcut is missing from player settings.');
    const waitPosition = async (position: string) => {
      await page.waitForFunction(position => getComputedStyle(document.querySelector('video#player')!).objectPosition === position, position, { timeout: 5000 });
    };
    // A fresh profile defaults to Raised only with subtitles, which sits centered until subtitles are on.
    if (await row.locator('.theater-settings-detail').innerText() !== 'Raised') fail('Layout did not default to Raised.');
    await waitPosition('50% 50%');
    const layoutWorker = await extensionWorker(context);
    const fresh = await context.newPage();
    try {
      await fresh.goto(new URL('options/options.html', layoutWorker.url()).href);
      await fresh.waitForSelector('[data-picture-align="top"][aria-checked="true"]');
      if (!await fresh.locator('#picture-align-subtitles-toggle').isChecked()) fail('Settings did not default to Raised only with subtitles.');
    } finally { await fresh.close(); }
    await page.bringToFront();
    await layoutWorker.evaluate(() => chrome.storage.sync.set({ pictureAlign: 'center', raiseOnlyWithSubtitles: false }));
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.picture-layout-btn .theater-settings-detail')?.textContent === 'Centered');
    await row.click();
    await waitPosition('50% 0%');
    if (context) {
      const worker = await extensionWorker(context);
      const options = await context.newPage();
      try {
        await options.goto(new URL('options/options.html', worker.url()).href);
        await options.waitForSelector('[data-picture-align="top"][aria-checked="true"]');
        await options.locator('#tab-shortcuts').click();
        await options.waitForSelector('.options-body[aria-busy="false"]');
        await options.locator('#shortcut-cycle-layout').press('Shift+K');
        await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.picture-layout-btn')?.getAttribute('aria-keyshortcuts') === 'Shift+K');
        await page.bringToFront();
        await page.keyboard.press('Shift+L');
        if (await video.evaluate(video => getComputedStyle(video).objectPosition) !== '50% 0%') fail('Old layout shortcut remained active after customization.');
        await page.keyboard.press('Shift+K');
        await waitPosition('50% 50%');
        await options.locator('#tab-appearance').click();
        await options.waitForSelector('[data-picture-align="center"][aria-checked="true"]');
        await options.locator('[data-picture-align="center"]').focus();
        await page.keyboard.press('Shift+K');
        await waitPosition('50% 0%');
        await options.waitForFunction(() => document.activeElement?.matches('[data-picture-align="top"][aria-checked="true"][tabindex="0"]'));
        await options.bringToFront();
        await options.keyboard.press('Enter');
        await waitPosition('50% 0%');
        await options.locator('[data-picture-align="center"]').click();
        await waitPosition('50% 50%');
        await options.locator('[data-picture-align="top"]').click();
        await waitPosition('50% 0%');
        await options.locator('#tab-shortcuts').click();
        await options.locator('[data-shortcut="cycleLayout"]').click();
        await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.picture-layout-btn')?.getAttribute('aria-keyshortcuts') === 'Shift+L');
      } finally { await options.close(); }
      await page.bringToFront();
      if (!await row.isVisible()) await gear.click();
    }
    if (process.env.THEATER_SMOKE_SCREENSHOT) {
      await page.mouse.move(640, 300);
      await row.focus();
      await page.locator('.theater-everywhere-volume-overlay.status-hud').waitFor({ state: 'detached' });
      await page.screenshot({ path: process.env.THEATER_SMOKE_SCREENSHOT.replace(/\.png$/, '-layout.png') });
    }
    await row.click(); // Restore Centered for the remaining smoke scenarios.
    await waitPosition('50% 50%');
    await page.keyboard.press('Escape'); // Close settings while keeping the session active.
    await page.setViewportSize({ width: 1280, height: 720 });
    console.log('smoke layout: installed defaults, saved preference and live options/shortcut sharing passed');
  });
}
