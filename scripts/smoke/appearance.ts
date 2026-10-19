import { WHATS_NEW_ACK_STORAGE_KEY, WHATS_NEW_RELEASE } from '../../src/whatsNew-release';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext } from 'playwright';
import { extensionWorker, waitForPlayer, timeScenario } from './helpers';

/** One real Settings write fans out to an extension page and the isolated shadow owner. */
export async function assertAppearanceModes(context: BrowserContext, origin: string): Promise<void> {
  await timeScenario('assertAppearanceModes', async () => {
    const worker = await extensionWorker(context);
    const keys = ['highContrast', 'reduceTransparency', 'keepControlsVisible'];
    const original = await worker.evaluate(keys => chrome.storage.sync.get(keys), keys);
    const options = await context.newPage();
    const player = await context.newPage();
    const popup = await context.newPage();
    const waitModes = async (contrast: string, transparency: string) => {
      for (const page of [options, popup]) await page.waitForFunction(({ contrast, transparency }) =>
        document.documentElement.dataset.contrast === contrast && document.documentElement.dataset.transparency === transparency,
      { contrast, transparency });
      await player.waitForFunction(({ contrast, transparency }) => {
        const host = document.getElementById('theater-everywhere-ui');
        return host?.dataset.contrast === contrast && host.dataset.transparency === transparency;
      }, { contrast, transparency });
    };
    try {
      await worker.evaluate(({ key, id }) => chrome.storage.local.set({ [key]: id }), { key: WHATS_NEW_ACK_STORAGE_KEY, id: WHATS_NEW_RELEASE.id });
      await worker.evaluate(() => chrome.storage.sync.set({ highContrast: 'off', reduceTransparency: 'off', keepControlsVisible: true }));
      await options.setViewportSize({ width: 1440, height: 1100 });
      await options.goto(new URL('options/options.html#appearance', worker.url()).href);
      await popup.goto(new URL('popup/popup.html', worker.url()).href);
      await player.goto(origin);
      await waitForPlayer(player);
      await player.keyboard.press('t');
      await player.locator('.theater-controls-wrapper').waitFor();
      await waitModes('normal', 'normal');
      await options.locator('#highContrast-combobox').click();
      await options.locator('#highContrast-combobox-listbox [data-value="on"]').click();
      await waitModes('high', 'normal');
      await worker.evaluate(() => chrome.storage.sync.set({ reduceTransparency: 'on' }));
      await waitModes('high', 'reduced');
      // A new shadow root must hydrate both saved settings.
      await player.keyboard.press('Escape');
      await player.locator('#theater-everywhere-ui').waitFor({ state: 'detached' });
      // Detachment does not release the previous entry's private repeat guard.
      await player.goto(origin, { waitUntil: 'domcontentloaded' });
      await waitForPlayer(player);
      await player.keyboard.press('t');
      await waitModes('high', 'reduced');
      const captureDir = process.env.THEATER_APPEARANCE_SCREENSHOT_DIR;
      if (captureDir) {
        mkdirSync(captureDir, { recursive: true });
        for (const [name, page] of [['settings', options], ['popup', popup], ['player', player]] as const) {
          await page.screenshot({ path: path.join(captureDir, `tme48a-${name}-contrast.png`), animations: 'disabled' });
        }
      }
      console.log('smoke:chromium appearance: real Settings/popup/player propagation and shadow reentry passed');
    } finally {
      await worker.evaluate(async ({ keys, original }) => {
        await chrome.storage.sync.remove(keys.filter(key => !(key in original)));
        await chrome.storage.sync.set(original);
      }, { keys, original });
      await Promise.all([options, player, popup].map(page => page.close()));
    }
  });
}
