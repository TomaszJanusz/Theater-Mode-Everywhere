import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SETUP_STATE_KEY, setupComplete } from '../../src/first-run-setup';

import { extensionWorker, fail, timeScenario, type BrowserContext, type ExtensionBackground } from './helpers';

type Installed = { sync: Record<string, unknown>; state: unknown; setupTabs: string[] };

/** Storage and Settings tabs once `onInstalled` has stored its defaults (its first write). */
async function afterInstall(context: BrowserContext, worker: ExtensionBackground): Promise<Installed> {
  // Callbacks stay anonymous: tsx names named ones through a `__name` helper the worker does not have.
  await worker.evaluate(() => new Promise<void>(resolve => {
    const listeners: Array<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void> = [];
    listeners.push((changes, area) => {
      if (area !== 'sync' || !('blacklist' in changes)) return;
      chrome.storage.onChanged.removeListener(listeners[0]);
      resolve();
    });
    chrome.storage.onChanged.addListener(listeners[0]);
    void chrome.storage.sync.get('blacklist').then(data => {
      if (!('blacklist' in data)) return;
      chrome.storage.onChanged.removeListener(listeners[0]);
      resolve();
    });
  }));
  // A complete setup opens its tab last, after the device state; until then the defaults are the whole install.
  if (setupComplete()) await context.waitForEvent('page', { predicate: page => page.url().endsWith('/options/options.html#setup'), timeout: 10_000 })
    .catch(() => fail('A fresh install did not open Settings at the setup'));
  const { sync, state } = await worker.evaluate(async key => ({
    sync: await chrome.storage.sync.get(null), state: (await chrome.storage.local.get(key))[key]
  }), SETUP_STATE_KEY);
  return { sync, state, setupTabs: context.pages().map(page => page.url()).filter(url => url.includes('/options/options.html')) };
}

/**
 * A fresh install in a profile of its own: the install-time setup follows the step registry (one Settings tab at
 * `#setup` and AutoTheater stored off once every step ships, nothing new before), and the installed Settings page
 * runs the setup over real extension storage. Chromium reports a command-line extension as installed on every
 * launch, so the second launch stands in for a reinstall over surviving local state; an update cannot be simulated
 * here and is background.test.ts's.
 */
export async function assertFreshInstall(
  unpackedDir: string, launchExtension: (userDataDir: string, unpackedDir: string) => Promise<BrowserContext>
): Promise<void> {
  // A profile of its own has its own sync quota; the one write is the install's defaults.
  return timeScenario('assertFreshInstall', { syncWrites: 1 }, async () => {
    const profile = mkdtempSync(path.join(tmpdir(), 'te-smoke-install-'));
    let context: BrowserContext | null = null;
    try {
      context = await launchExtension(profile, unpackedDir);
      const worker = await extensionWorker(context);
      const installed = await afterInstall(context, worker);
      const complete = setupComplete();
      if (installed.setupTabs.length !== (complete ? 1 : 0)) fail(`A fresh install opened ${JSON.stringify(installed.setupTabs)}`);
      if (complete ? installed.sync.autoEnterTheater !== false : 'autoEnterTheater' in installed.sync) {
        fail(`A fresh install stored AutoTheater as ${JSON.stringify(installed.sync.autoEnterTheater)}`);
      }
      if (complete !== (installed.state !== undefined)) fail(`A fresh install stored the setup state ${JSON.stringify(installed.state)}`);

      // The installed page, real storage: the preselected answers finish without a settings write.
      const page = context.pages().find(candidate => candidate.url().endsWith('#setup')) ?? await context.newPage();
      if (!page.url().endsWith('#setup')) await page.goto(new URL('options/options.html#setup', worker.url()).href);
      await page.locator('.setup-step').waitFor();
      await page.getByRole('button', { name: 'Next' }).click();
      await page.getByRole('button', { name: 'Finish' }).click();
      await page.locator('#features').waitFor();
      const after = await worker.evaluate(async key => ({
        sync: await chrome.storage.sync.get(null), state: (await chrome.storage.local.get(key))[key]
      }), SETUP_STATE_KEY);
      if (JSON.stringify(after.sync) !== JSON.stringify(installed.sync)) fail('Finishing the preselected setup changed settings');
      if ((after.state as { status?: string } | undefined)?.status !== 'completed') fail(`Finishing the setup stored ${JSON.stringify(after.state)}`);
      await context.close();

      context = await launchExtension(profile, unpackedDir);
      await extensionWorker(context);
      if (context.pages().some(candidate => candidate.url().includes('/options/options.html'))) fail('A reinstall over a finished setup opened Settings');
      console.log(`smoke:chromium fresh install (setup ${complete ? 'offered' : 'not offered yet'}) and installed setup page passed`);
    } finally {
      await context?.close();
      rmSync(profile, { recursive: true, force: true });
    }
  });
}
