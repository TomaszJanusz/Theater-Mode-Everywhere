import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { it } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { bundleModules } from '../src/test-utils/player-boot';
import { readStylesheet } from '../src/test-utils/styles';
import { sharedTestBrowser } from '../src/test-utils/test-browser';
import { selectTestEngines } from '../src/test-utils/test-engines';

const html = readFileSync(new URL('./popup.html', import.meta.url), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '');
const css = readStylesheet(new URL('./popup.css', import.meta.url));
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const bundle = bundleModules([
  "import { setupPopupUpdateNotice } from '../popup/update-notice';",
  "import { languageRuntime } from './i18n-runtime';",
  "import { localizeDocument } from './i18n';",
  'window.notice = setupPopupUpdateNotice();',
  'window.relocalize = async locale => { await languageRuntime.set(locale); localizeDocument(); window.notice.render(); };'
]);
const catalogs = Object.fromEntries(['en', 'de', 'ar'].map(locale => [locale,
  JSON.parse(readFileSync(new URL(`../_locales/${locale}/messages.json`, import.meta.url), 'utf8'))]));

type Harness = { sent: unknown[]; change(value: unknown): void; listeners: Set<unknown>; notice: { dispose(): void } };

/** The popup document with the extension edge stubbed: local storage holds `pending`, messages are recorded. */
async function open(page: Page, pending: unknown) {
  await page.setContent(html);
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: 'window.__name = fn => fn;' });
  await page.evaluate(({ pending, catalogs }) => {
    const state = window as unknown as Harness;
    const listeners = new Set<(changes: Record<string, { newValue: unknown }>, area: string) => void>();
    state.sent = [];
    state.listeners = listeners;
    state.change = value => { for (const listener of listeners) listener({ pendingUpdate: { newValue: value } }, 'local'); };
    Object.assign(window, { chrome: {
      runtime: { sendMessage: (message: { action: string; locale?: string }, reply?: () => void) => {
        if (message.action === 'get-language-catalog') return Promise.resolve(catalogs[message.locale!]);
        state.sent.push(message);
        reply?.();
        return undefined;
      } },
      storage: {
        local: { get: async () => (pending === undefined ? {} : { pendingUpdate: pending }) },
        onChanged: { addListener: (fn: never) => listeners.add(fn), removeListener: (fn: never) => listeners.delete(fn) }
      }
    } });
  }, { pending, catalogs });
  await page.addScriptTag({ content: bundle });
}

async function blockingViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => {
    const results = await (window as unknown as { axe: { run(scope: Element): Promise<{ violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[] }> }> }> } })
      .axe.run(document.getElementById('update-card')!);
    return results.violations.filter(violation => ['serious', 'critical'].includes(violation.impact))
      .flatMap(violation => violation.nodes.map(node => `${violation.id}: ${node.target.join(' ')}`));
  });
}

for (const [name, engine] of selectTestEngines(Object.entries({ chromium, firefox }), ([name]) => name)) {
  const shared = sharedTestBrowser(engine);
  it(`popup announces a pending update, opens its highlights and follows the acknowledgement (${name})`, { timeout: 30_000 }, async t => {
    const page = await (await shared.newContext(t, { viewport: { width: 300, height: 480 } })).newPage();
    const card = page.locator('#update-card');
    await open(page, { version: '2.1.0', since: '2.0' });
    await card.waitFor();
    assert.equal(await page.locator('#update-title').textContent(), 'Updated to 2.1');
    const button = page.getByRole('button', { name: 'See what’s new' });
    assert.deepEqual(await blockingViolations(page), []);
    // Both texts fit the 300px popup on one line each.
    assert.ok(await card.evaluate(element => element.scrollWidth <= element.clientWidth));
    await button.click();
    assert.deepEqual(await page.evaluate(() => (window as unknown as Harness).sent), [{ action: 'open-options-page', section: 'whats-new' }]);
    for (const locale of ['de', 'ar']) {
      await page.evaluate(locale => (window as unknown as { relocalize(locale: string): Promise<void> }).relocalize(locale), locale);
      assert.equal(await page.locator('#update-title').textContent(), catalogs[locale].updatePanelTitle.message.replace('$VERSION$', '2.1'));
      assert.equal(await page.locator('#update-btn').textContent(), catalogs[locale].updateSeeWhatsNew.message);
    }
    // Opening Update highlights from any source removes the stored announcement; the open popup follows.
    await page.evaluate(() => (window as unknown as Harness).change(undefined));
    await card.waitFor({ state: 'hidden' });
    await page.evaluate(() => (window as unknown as Harness).notice.dispose());
    assert.equal(await page.evaluate(() => (window as unknown as Harness).listeners.size), 0);
  });

  it(`popup shows no panel without a valid announcement, and a later one appears live (${name})`, { timeout: 30_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
    for (const pending of [undefined, { version: 'next' }]) {
      await open(page, pending);
      await page.evaluate(() => new Promise(requestAnimationFrame));
      assert.equal(await page.locator('#update-card').isHidden(), true, JSON.stringify(pending));
    }
    await page.evaluate(() => (window as unknown as Harness).change({ version: '3.0.0', since: '2.3' }));
    assert.equal(await page.locator('#update-title').textContent(), 'Updated to 3.0');
  });
}
