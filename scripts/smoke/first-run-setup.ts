import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SETUP_STATE_KEY, shownSetupSteps } from '../../src/first-run-setup';

import { extensionWorker, fail, timeScenario, type BrowserContext, type ExtensionBackground } from './helpers';

type Installed = { sync: Record<string, unknown>; state: unknown; setupTabs: string[] };
const SETUP_PAGE = '/options/options.html#setup';

/** Storage and Settings tabs once `onInstalled` has finished: its last step opens the setup tab. */
async function afterInstall(context: BrowserContext, worker: ExtensionBackground): Promise<Installed> {
  if (!context.pages().some(page => page.url().endsWith(SETUP_PAGE))) {
    await context.waitForEvent('page', { predicate: page => page.url().endsWith(SETUP_PAGE), timeout: 10_000 })
      .catch(() => fail('A fresh install did not open Settings at the setup'));
  }
  const { sync, state } = await worker.evaluate(async key => ({
    sync: await chrome.storage.sync.get(null), state: (await chrome.storage.local.get(key))[key]
  }), SETUP_STATE_KEY);
  return { sync, state, setupTabs: context.pages().map(page => page.url()).filter(url => url.includes('/options/options.html')) };
}

/**
 * The shared smoke profiles are fresh installs too. Proves on the installed extension that the install opened the
 * setup and stored AutoTheater off, then closes the tab through the background (Playwright cannot drive Firefox's
 * extension pages), so every later scenario starts as before, with no Settings tab open. AutoTheater stays off as a
 * fresh install has it; scenarios that need it set it themselves.
 */
export async function closeInstallSetup(context: BrowserContext): Promise<void> {
  const worker = await extensionWorker(context);
  // Callbacks stay anonymous: tsx names named ones through a `__name` helper the background does not have.
  const found = await worker.evaluate(page => new Promise<{ tabs: string[]; auto: unknown }>(resolve => {
    const state = { done: false };
    const listeners: Array<() => Promise<void>> = [];
    listeners.push(async () => {
      const tabs = (await chrome.tabs.query({})).filter(tab => (tab.pendingUrl ?? tab.url ?? '').endsWith(page));
      if (state.done || !tabs.length) return;
      state.done = true;
      chrome.tabs.onUpdated.removeListener(listeners[0]);
      await chrome.tabs.remove(tabs.map(tab => tab.id!));
      resolve({ tabs: tabs.map(tab => tab.pendingUrl ?? tab.url ?? ''), auto: (await chrome.storage.sync.get('autoEnterTheater')).autoEnterTheater });
    });
    chrome.tabs.onUpdated.addListener(listeners[0]);
    void listeners[0]();
  }), SETUP_PAGE);
  if (found.tabs.length !== 1) fail(`A fresh install opened ${JSON.stringify(found.tabs)}`);
  if (found.auto !== false) fail(`A fresh install stored AutoTheater as ${JSON.stringify(found.auto)}`);
}

/**
 * A fresh install in a profile of its own: one Settings tab at `#setup`, AutoTheater stored off and the setup
 * pending, and the installed Settings page runs all its steps over real extension storage. Chromium reports a
 * command-line extension as installed on every launch, so the second launch stands in for a reinstall over
 * surviving local state; an update cannot be simulated here and is background.test.ts's.
 */
export async function assertFreshInstall(
  unpackedDir: string, launchExtension: (userDataDir: string, unpackedDir: string) => Promise<BrowserContext>
): Promise<void> {
  // A profile of its own has its own sync quota: the install's defaults, then the answers on Finish.
  return timeScenario('assertFreshInstall', { syncWrites: 2 }, async () => {
    const profile = mkdtempSync(path.join(tmpdir(), 'te-smoke-install-'));
    let context: BrowserContext | null = null;
    try {
      context = await launchExtension(profile, unpackedDir);
      const worker = await extensionWorker(context);
      const installed = await afterInstall(context, worker);
      if (installed.setupTabs.length !== 1) fail(`A fresh install opened ${JSON.stringify(installed.setupTabs)}`);
      if (installed.sync.autoEnterTheater !== false) fail(`A fresh install stored AutoTheater as ${JSON.stringify(installed.sync.autoEnterTheater)}`);
      if ((installed.state as { status?: string } | undefined)?.status !== 'pending') fail(`A fresh install stored the setup state ${JSON.stringify(installed.state)}`);

      // The installed page, real storage: the preselected answers only answer the launcher offer.
      const page = context.pages().find(candidate => candidate.url().endsWith(SETUP_PAGE))!;
      await page.locator('.setup-step').waitFor();
      // Every step the setup ships, from the registry it is built from.
      const total = shownSetupSteps().length;
      for (let step = 2; step <= total; step++) {
        await page.getByRole('button', { name: 'Next' }).click();
        await page.locator('.setup-progress', { hasText: `Step ${step} of ${total}` }).waitFor();
      }
      await page.getByRole('button', { name: 'Finish' }).click();
      await page.locator('#features').waitFor();
      const after = await worker.evaluate(async key => ({
        sync: await chrome.storage.sync.get(null), state: (await chrome.storage.local.get(key))[key]
      }), SETUP_STATE_KEY);
      if (JSON.stringify(after.sync) !== JSON.stringify({ ...installed.sync, videoActivatorPromptAnswer: false })) {
        fail(`Finishing the preselected setup stored ${JSON.stringify(after.sync)}`);
      }
      if ((after.state as { status?: string } | undefined)?.status !== 'completed') fail(`Finishing the setup stored ${JSON.stringify(after.state)}`);
      await context.close();

      context = await launchExtension(profile, unpackedDir);
      await extensionWorker(context);
      if (context.pages().some(candidate => candidate.url().includes('/options/options.html'))) fail('A reinstall over a finished setup opened Settings');
      console.log('smoke:chromium fresh install opened the setup once, the installed setup finished all steps, and a reinstall stayed quiet');
    } finally {
      await context?.close();
      rmSync(profile, { recursive: true, force: true });
    }
  });
}
