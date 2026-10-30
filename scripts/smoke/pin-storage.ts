import { type BrowserContext, type Page } from 'playwright';

import { SEEN_ITEMS_STORAGE_KEY } from '../../src/feature-highlights';
import { WHATS_NEW_ACK_STORAGE_KEY } from '../../src/whatsNew-release';

import { fail, extensionWorker, waitForPlayer, timeScenario } from './helpers';
export async function assertPinStorage(page: Page, context: BrowserContext): Promise<void> {
  return timeScenario('assertPinStorage', async () => {
    const gear = page.locator('.player-settings-btn');
    const menu = page.locator('.theater-settings-menu');
    const waitForPin = (pinned: boolean) => page.locator(`.controls-visibility-toggle[data-active="${pinned}"]`).waitFor({ state: 'attached' });
    await page.locator('video#player').click();
    await page.keyboard.press('t');
    await page.locator('.theater-controls-wrapper').waitFor();
    await page.keyboard.press('Shift+H');
    await page.mouse.move(640, 300);
    await waitForPin(true);
    await gear.click();
    await menu.waitFor({ state: 'visible' });
    const openedOptions = context.waitForEvent('page', { timeout: 10_000 });
    await menu.locator('.extension-settings-btn').click();
    const opened = await openedOptions;
    await opened.waitForLoadState('domcontentloaded');
    if (!opened.url().includes('options/options.html')) fail(`Extension settings opened ${opened.url()}`);
    await opened.close();
    await page.bringToFront();

    // Actual extension storage, reload, and the settings page share the same preference.
    const worker = await extensionWorker(context);
    const saved = await worker.evaluate(async () => (await chrome.storage.sync.get('keepControlsVisible')).keepControlsVisible);
    if (saved !== true) fail('Pin preference was not persisted.');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await page.locator('video#player').click();
    await page.keyboard.press('t');
    await waitForPin(true);
    // Release installs start seen, while date-version builds have unseen development items.
    // Seed the same unacknowledged state in both builds so this page must auto-open highlights.
    const highlightKeys = [WHATS_NEW_ACK_STORAGE_KEY, 'newFeaturesSeenThrough', SEEN_ITEMS_STORAGE_KEY];
    const originalHighlights = await worker.evaluate(keys => chrome.storage.local.get(keys), highlightKeys);
    await worker.evaluate(key => chrome.storage.local.set({
      [key]: 'smoke:unacknowledged', newFeaturesSeenThrough: '0.0', newFeaturesSeenItems: []
    }), WHATS_NEW_ACK_STORAGE_KEY);
    const options = await context.newPage();
    try {
      await options.goto(new URL('options/options.html', worker.url()).href);
      const highlights = options.getByRole('dialog', { name: 'Update highlights', exact: true });
      await highlights.waitFor();
      await highlights.locator('.te-dialog-btn-primary').click();
      await highlights.waitFor({ state: 'detached' });
      await options.locator('#tab-appearance').click();
      const toggle = options.locator('#keep-controls-visible-toggle');
      await toggle.waitFor({ state: 'attached' });
      await options.waitForFunction(() => (document.getElementById('keep-controls-visible-toggle') as HTMLInputElement)?.checked);
      await options.locator('label.toggle-switch').filter({ has: toggle }).click();
      await waitForPin(false);
      await page.keyboard.press('Shift+H');
      await options.waitForFunction(() => (document.getElementById('keep-controls-visible-toggle') as HTMLInputElement)?.checked);
      await waitForPin(true);
      await options.locator('#tab-shortcuts').click();
      await options.locator('.options-body[aria-busy="false"]').waitFor();
      await options.locator('#shortcut-controls-pin').press('Shift+U');
      await options.waitForFunction(async () => (await chrome.storage.sync.get('shortcuts')).shortcuts?.toggleControlsPin === 'Shift+U');
      // A storage write can finish before the editor accepts the next recording.
      await options.locator('.options-body[aria-busy="false"]').waitFor();
      await options.locator('#shortcut-toggle-mute').press('Control+M');
      await options.waitForFunction(async () => (await chrome.storage.sync.get('shortcuts')).shortcuts?.toggleMute === 'Ctrl+M');
      await options.locator('.options-body[aria-busy="false"]').waitFor();
      await options.waitForFunction(() => (document.getElementById('shortcut-controls-pin') as HTMLInputElement)?.value === 'Shift+U');
      const shortcuts = await worker.evaluate(async () => (await chrome.storage.sync.get('shortcuts')).shortcuts);
      if (shortcuts.toggleControlsPin !== 'Shift+U' || shortcuts.toggleMute !== 'Ctrl+M') {
        fail('Editing another shortcut lost the custom pin shortcut.');
      }
      await page.keyboard.press('Shift+U');
      await waitForPin(false);
      await worker.evaluate(async () => { await chrome.storage.sync.remove('shortcuts'); });
      // Removing the saved map restores canonical defaults in the live runtime.
    } finally {
      await options.close();
      await worker.evaluate(async ({ keys, original }) => {
        await chrome.storage.local.remove(keys.filter(key => !(key in original)));
        await chrome.storage.local.set(original);
      }, { keys: highlightKeys, original: originalHighlights });
    }
    await page.keyboard.press('Escape');
    await page.locator('.theater-controls-wrapper').waitFor({ state: 'detached' });
  });
}
