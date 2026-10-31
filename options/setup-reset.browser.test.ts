import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { FRESH_INSTALL_SETTINGS, INSTALL_SHORTCUTS } from '../src/first-run-setup';
import { readCatalog } from '../src/test-utils/language-audit';
import { bundleQueryModules } from '../src/test-utils/query-bundle';
import { readStylesheet } from '../src/test-utils/styles';
import { sharedTestBrowser } from '../src/test-utils/test-browser';
import { selectTestEngines } from '../src/test-utils/test-engines';

// The whole Settings page (options.ts), so the card, the confirmation, the setup and the other controls are the real ones.
const bundle = bundleQueryModules(["import '../options/options';"]);
const html = readFileSync(new URL('./options.html', import.meta.url), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const css = readStylesheet(new URL('./options.css', import.meta.url));
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

type Area = 'sync' | 'local';
type Write = [Area, 'set', Record<string, unknown>] | [Area, 'remove', string[]];
type Harness = { data: Record<Area, Record<string, unknown>>; writes: Write[] };

/** Someone's settings after a while, on a device that went through the setup. */
const USED = {
  shortcuts: { ...INSTALL_SHORTCUTS, toggle: 'G' }, blacklist: ['example.com'], autoEnterTheater: true,
  netflixIntegrationEnabled: false, accentColor: 'green', volumeBoostEnabled: true, captionPreferenceMap: { youtube: 'pl' }
};
const COMPLETED = { firstRunSetup: { status: 'completed', version: '2.0.8' }, pendingUpdate: { version: '2.1.0', since: '2.0' } };

async function open(page: Page, sync: Record<string, unknown> = USED, local: Record<string, unknown> = COMPLETED): Promise<void> {
  const initialize = ({ catalogs, sync, local }: { catalogs: Record<string, unknown>; sync: Record<string, unknown>; local: Record<string, unknown> }) => {
    const data = { sync: structuredClone(sync), local: structuredClone(local) };
    const writes: Write[] = [];
    const listeners = new Set<(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void>();
    const notify = (area: Area, changes: Record<string, { oldValue?: unknown; newValue?: unknown }>) => {
      if (Object.keys(changes).length) for (const listener of [...listeners]) listener(changes, area);
    };
    const pick = (items: Record<string, unknown>, keys: unknown): Record<string, unknown> => {
      if (keys == null) return structuredClone(items);
      if (typeof keys === 'string' || Array.isArray(keys)) {
        return Object.fromEntries([keys].flat().filter(key => key in items).map(key => [key, structuredClone(items[key])]));
      }
      return Object.fromEntries(Object.entries(keys as Record<string, unknown>).map(([key, fallback]) => [key, key in items ? structuredClone(items[key]) : fallback]));
    };
    const area = (name: Area) => ({
      get: (keys?: unknown, callback?: (items: Record<string, unknown>) => void) => {
        const items = pick(data[name], keys);
        callback?.(items);
        return Promise.resolve(items);
      },
      set: async (values: Record<string, unknown>) => {
        writes.push([name, 'set', structuredClone(values)]);
        Object.assign(data[name], structuredClone(values));
        notify(name, Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }])));
      },
      remove: async (keys: string | string[]) => {
        const removed = [keys].flat().filter(key => key in data[name]);
        writes.push([name, 'remove', [keys].flat()]);
        const changes = Object.fromEntries(removed.map(key => [key, { oldValue: data[name][key] }]));
        for (const key of removed) delete data[name][key];
        notify(name, changes);
      }
    });
    Object.assign(window, { __harness: { data, writes } });
    Object.defineProperty(window, 'chrome', { configurable: true, value: {
      runtime: {
        getURL: (file: string) => file, getManifest: () => ({ version: '2.1.0' }),
        sendMessage: async (request: { action: string; locale: string }) => request.action === 'get-language-catalog' ? catalogs[request.locale] : undefined
      },
      storage: { sync: area('sync'), local: area('local'), onChanged: { addListener: listeners.add.bind(listeners), removeListener: listeners.delete.bind(listeners) } },
      tabs: { query: async () => [] }
    } });
  };
  // tsx names nested callbacks with __name; keep that helper inside the fixture.
  const catalogs = Object.fromEntries(['en', 'pl'].map(locale => [locale, readCatalog(locale)]));
  await page.addInitScript({ content: `window.__name = fn => fn; (${initialize.toString()})(${JSON.stringify({ catalogs, sync, local })});` });
  await page.route('http://options.test/**', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('http://options.test/options.html#about');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: await bundle });
  await page.waitForFunction(() => document.querySelector('#shortcuts .options-body')?.getAttribute('aria-busy') === 'false');
  await page.getByRole('button', { name: 'Run setup again' }).waitFor();
}

const harness = (page: Page) => page.evaluate(() => (window as unknown as { __harness: Harness }).__harness);
const writes = async (page: Page) => (await harness(page)).writes;
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Reset all settings?' });

async function blockingViolations(page: Page, selector: string): Promise<string[]> {
  if (!await page.evaluate(() => 'axe' in window)) await page.addScriptTag({ content: axeSource });
  return page.evaluate(async selector => {
    const results = await (window as unknown as { axe: { run(scope: Element): Promise<{ violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[] }> }> }> } })
      .axe.run(document.querySelector(selector)!);
    return results.violations.filter(violation => ['serious', 'critical'].includes(violation.impact))
      .flatMap(violation => violation.nodes.map(node => `${violation.id}: ${node.target.join(' ')}`));
  }, selector);
}

for (const [name, engine] of selectTestEngines(Object.entries({ chromium, firefox }), ([name]) => name)) describe(`Setup again and reset (${name})`, () => {
  const shared = sharedTestBrowser(engine);
  const newPage = async (t: Parameters<typeof shared.newContext>[0]) =>
    (await shared.newContext(t, { viewport: { width: 1100, height: 900 } })).newPage();

  it('runs the setup again over the saved settings, in the same tab, without writing anything', async t => {
    const page = await newPage(t);
    await open(page);
    assert.deepEqual(await blockingViolations(page, '#setup-actions'), []);
    await page.getByRole('button', { name: 'Run setup again' }).click();
    await page.locator('.setup-step').waitFor();
    assert.equal(new URL(page.url()).hash, '#setup');
    assert.equal(await page.locator('#settings-tabs').isHidden(), true);
    assert.equal(await page.getByRole('radio', { name: 'Choose services' }).isChecked(), true, 'the saved services, not the defaults');
    await page.getByRole('button', { name: 'Skip setup' }).click();
    await page.locator('#features').waitFor();
    assert.deepEqual(await writes(page), []);
  });

  it('asks before a reset; Cancel, Escape and leaving change nothing', async t => {
    const page = await newPage(t);
    await open(page);
    const reset = page.getByRole('button', { name: 'Reset to defaults' });
    await reset.click();
    await dialog(page).waitFor();
    // A destructive action starts on Cancel, with the wider reset off.
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Cancel');
    const also = page.getByRole('checkbox', { name: 'Also reset excluded websites and keyboard shortcuts' });
    assert.equal(await also.isChecked(), false);
    assert.deepEqual(await blockingViolations(page, '.te-dialog-overlay'), []);
    await also.check();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await dialog(page).waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Reset to defaults', 'focus returns to the button');
    await reset.click();
    await page.keyboard.press('Escape');
    await dialog(page).waitFor({ state: 'detached' });
    // A language change keeps the open confirmation and its checkbox, in the new language.
    await reset.click();
    await page.getByRole('checkbox', { name: 'Also reset excluded websites and keyboard shortcuts' }).check();
    await page.evaluate(() => chrome.storage.sync.set({ language: 'pl' }));
    const pl = readCatalog('pl');
    await page.getByRole('dialog', { name: pl.setupResetTitle.message }).waitFor();
    assert.equal(await page.getByRole('checkbox', { name: pl.setupResetAlso.message }).isChecked(), true);
    await page.getByRole('button', { name: pl.setupResetCancel.message }).click();
    const { data, writes: saved } = await harness(page);
    assert.deepEqual(saved, [['sync', 'set', { language: 'pl' }]], 'only the language change of this test');
    assert.deepEqual(data.local, COMPLETED);
  });

  it('resets everything but excluded websites and shortcuts, forgets the setup on this device, and opens it at its defaults', async t => {
    const page = await newPage(t);
    await open(page);
    await page.getByRole('button', { name: 'Reset to defaults' }).click();
    await dialog(page).getByRole('button', { name: 'Reset settings' }).click();
    await page.locator('.setup-step').waitFor();
    const { data, writes: saved } = await harness(page);
    assert.deepEqual(saved, [
      ['sync', 'remove', ['netflixIntegrationEnabled', 'accentColor', 'volumeBoostEnabled', 'captionPreferenceMap']],
      ['sync', 'set', { autoEnterTheater: false }],
      ['local', 'remove', ['firstRunSetup']]
    ], 'one remove and one set in sync');
    assert.deepEqual(data.sync, { shortcuts: USED.shortcuts, blacklist: USED.blacklist, ...FRESH_INSTALL_SETTINGS });
    assert.deepEqual(data.local, { pendingUpdate: COMPLETED.pendingUpdate }, 'other device state stays');
    // The setup shows a fresh install's preselection, with the kept theater key.
    assert.equal(await page.getByRole('radio', { name: 'All supported services' }).isChecked(), true);
    await page.getByRole('button', { name: 'Next' }).click();
    assert.equal(await page.getByRole('radio', { name: 'Only when I press G' }).isChecked(), true);
    await page.getByRole('button', { name: 'Skip setup' }).click();
    await page.locator('#features').waitFor();
    // Settings behind the setup show the reset values, not the ones the page loaded with.
    assert.equal(await page.locator('#auto-enter-theater-toggle').isChecked(), false);
    assert.equal(await page.locator('#volume-boost-toggle').isChecked(), false);
    await page.getByRole('tab', { name: 'Website Exclusions' }).click();
    assert.deepEqual(await page.locator('#blacklist-container .domain-name').allTextContents(), ['example.com']);
  });

  it('also resets excluded websites and shortcuts when asked, and the page follows', async t => {
    const page = await newPage(t);
    await open(page);
    await page.getByRole('tab', { name: 'Appearance' }).click();
    assert.equal(await page.locator('#accent-color-grid [data-choice=green]').getAttribute('aria-checked'), 'true');
    await page.getByRole('tab', { name: 'About' }).click();
    await page.getByRole('button', { name: 'Reset to defaults' }).click();
    await dialog(page).getByRole('checkbox', { name: 'Also reset excluded websites and keyboard shortcuts' }).check();
    await dialog(page).getByRole('button', { name: 'Reset settings' }).click();
    await page.locator('.setup-step').waitFor();
    const { data, writes: saved } = await harness(page);
    assert.deepEqual(saved.filter(([area]) => area === 'sync').map(([, kind]) => kind), ['remove', 'set']);
    assert.deepEqual(data.sync, { shortcuts: { ...INSTALL_SHORTCUTS }, blacklist: [], ...FRESH_INSTALL_SETTINGS });
    await page.getByRole('button', { name: 'Next' }).click();
    assert.equal(await page.getByRole('radio', { name: 'Only when I press T' }).isChecked(), true);
    // Finish writes against the reset settings: only the launcher offer, then this device's state.
    while (await page.locator('.setup-summary').count() === 0) await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Finish' }).click();
    await page.locator('#features').waitFor();
    assert.deepEqual((await writes(page)).slice(saved.length), [
      ['sync', 'set', { videoActivatorPromptAnswer: false }], ['local', 'set', { firstRunSetup: { status: 'completed', version: '2.1.0' } }]
    ]);
    await page.getByRole('tab', { name: 'Appearance' }).click();
    assert.equal(await page.locator('#accent-color-grid [data-choice=green]').getAttribute('aria-checked'), 'false');
    await page.getByRole('tab', { name: 'Website Exclusions' }).click();
    assert.equal(await page.locator('#blacklist-container .domain-name').count(), 0);
    assert.equal(await page.locator('#blacklist-count').textContent(), '0');
  });
});
