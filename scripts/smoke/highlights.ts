import { WHATS_NEW_ACK_STORAGE_KEY, WHATS_NEW_RELEASE } from '../../src/whatsNew-release';
import { featureHighlightsAcknowledgement, resolveFeatureHighlights, SEEN_ITEMS_STORAGE_KEY } from '../../src/feature-highlights';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { type BrowserContext, type Page } from 'playwright';

import { extensionWorker, waitForPlayer, timeScenario } from './helpers';
export async function assertBadgeWorld(page: Page, context: BrowserContext): Promise<void> {
  return timeScenario('assertBadgeWorld', async () => {
    const client = await context.newCDPSession(page);
    const worlds: number[] = [];
    client.on('Runtime.executionContextCreated', ({ context }) => {
      const isDefault: unknown = context.auxData?.isDefault;
      if (isDefault === false) worlds.push(context.id);
    });
    try {
      await client.send('Runtime.enable');
      for (const contextId of worlds) {
        const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
          contextId, returnByValue: true,
          expression: `(() => {
            if (typeof chrome === 'undefined' || !chrome.runtime?.id) return null;
            const root = document.getElementById('theater-everywhere-ui')?.shadowRoot;
            if (!root) throw new Error('Player shadow root is missing');
            try {
              if (!globalThis.customElements) {
                const badge = root.querySelector('.te-new-badge');
                if (badge?.localName !== 'span' || getComputedStyle(badge).fontSize !== '9.5px') {
                  throw new Error('Isolated-world badge fallback is missing or unstyled');
                }
                return {registry: 'unavailable', upgraded: false, badge: badge.localName};
              }
              const tag = 'tme-smoke-badge-probe';
              if (!customElements.get(tag)) customElements.define(tag, class extends HTMLElement {
                connectedCallback() { this.textContent = 'upgraded'; }
              });
              const badge = document.createElement(tag);
              root.append(badge);
              const upgraded = badge.textContent === 'upgraded';
              badge.remove();
              return {registry: 'available', upgraded};
            } catch (error) { return {registry: String(error), upgraded: false}; }
          })()`
        });
        if (exceptionDetails) throw new Error(exceptionDetails.text);
        if (result.value) {
          if (!['available', 'unavailable'].includes(result.value.registry)) throw new Error(result.value.registry);
          console.log('smoke:chromium badge custom-element feasibility (installed isolated world):', result.value);
          return;
        }
      }
      throw new Error('No extension isolated world was found for the badge feasibility check');
    } finally {
      await client.detach();
    }
  });
}

export async function assertFeatureHighlights(page: Page, origin: string, context: BrowserContext): Promise<void> {
  return timeScenario('assertFeatureHighlights', async () => {
    const worker = await extensionWorker(context);
    const localKeys = [WHATS_NEW_ACK_STORAGE_KEY, 'newFeaturesSeenThrough', SEEN_ITEMS_STORAGE_KEY];
    const originalLocal = await worker.evaluate(keys => chrome.storage.local.get(keys), localKeys);
    await worker.evaluate(({ key, release }) => chrome.storage.local.set({
      [key]: release, newFeaturesSeenThrough: '0.0', newFeaturesSeenItems: []
    }), { key: WHATS_NEW_ACK_STORAGE_KEY, release: WHATS_NEW_RELEASE.id });
    const options = await context.newPage();
    try {
      await page.goto(origin);
      await waitForPlayer(page);
      await page.locator('video#player').click();
      await page.keyboard.press('t');
      await page.locator('.player-settings-btn').waitFor();
      await page.locator('.player-settings-btn .te-new-badge[data-variant="dot"]').waitFor();
      await assertBadgeWorld(page, context);
      const url = new URL('options/options.html#appearance', worker.url()).href;
      await options.goto(url);
      await options.locator('#whats-new-btn.has-unseen').waitFor();
      await options.locator('label.toggle-switch').filter({ has: options.locator('#highlight-new-features-toggle') }).click();
      await options.locator('#whats-new-btn.has-unseen').waitFor({ state: 'hidden' });
      await page.waitForFunction(() => !document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.te-new-badge'));
      await options.locator('label.toggle-switch').filter({ has: options.locator('#highlight-new-features-toggle') }).click();
      await options.locator('#whats-new-btn.has-unseen').waitFor();
      await options.getByRole('button', { name: 'Update highlights', exact: true }).click();
      await options.getByRole('dialog', { name: 'Update highlights' }).waitFor();
      // Dialog copy, scrolling and RTL are fixture coverage; this verifies real acknowledgement storage.
      const version = await worker.evaluate(() => chrome.runtime.getManifest().version);
      const seen = await worker.evaluate(() => chrome.storage.local.get(['newFeaturesSeenThrough', 'newFeaturesSeenItems']));
      const expected = featureHighlightsAcknowledgement(resolveFeatureHighlights(version, {}, { newFeaturesSeenThrough: '0.0' }));
      for (const [key, value] of Object.entries(expected)) {
        if (JSON.stringify(seen[key]) !== JSON.stringify(value)) throw new Error(`Opening Update highlights did not acknowledge ${key}`);
      }
      await page.waitForFunction(() => !document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.te-new-badge'));
      await options.reload();
      await options.locator('#whats-new-btn:not(.has-unseen)').waitFor();
      if (await options.locator('.te-new-badge').count()) throw new Error('Unchanged development items reappeared after reload');
      const screenshotDir = process.env.SMOKE_SCREENSHOT_DIR;
      if (screenshotDir) {
        mkdirSync(screenshotDir, { recursive: true });
        await options.screenshot({ path: path.join(screenshotDir, 'badges-after-settings.png'), fullPage: true });
        await page.screenshot({ path: path.join(screenshotDir, 'badges-after-player.png') });
      }
      console.log('smoke:chromium feature highlights: installed Settings/player wiring, version gate, cross-tab preference and acknowledgement passed');
    } finally {
      await worker.evaluate(async ({ keys, original }) => {
        await chrome.storage.local.remove(keys.filter(key => !(key in original)));
        await chrome.storage.local.set(original);
        await chrome.storage.sync.remove(['highlightNewFeatures', 'language']);
      }, { keys: localKeys, original: originalLocal });
      await options.close();
    }
  });
}
