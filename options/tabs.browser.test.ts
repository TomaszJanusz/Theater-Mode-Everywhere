import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { Page } from 'playwright';
import { ownTestBrowser } from '../src/test-utils/test-browser';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild') as { buildSync(options: object): { outputFiles: Array<{ text: string }> } };
const BUNDLE = esbuild.buildSync({
  stdin: {
    contents: "import { setupSettingsTabs } from './tabs'; window.setupSettingsTabs = setupSettingsTabs;",
    resolveDir: new URL('./', import.meta.url).pathname, loader: 'ts'
  },
  bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent'
}).outputFiles[0].text;

const IDS = ['appearance', 'features', 'shortcuts'];
const FIXTURE = `<!doctype html><html><body>
  <div id="tabs" role="tablist">${IDS.map((id, i) =>
    `<button type="button" role="tab" id="tab-${id}" aria-selected="${i === 0}" ${i ? 'tabindex="-1"' : ''} aria-controls="${id}">${id}</button>`).join('')}</div>
  ${IDS.map((id, i) => `<section id="${id}" role="tabpanel" aria-labelledby="tab-${id}" ${i ? 'hidden' : ''}>${id} panel</section>`).join('')}
  </body></html>`;

/** Opens the fixture at `hash` and runs the production tab setup, collecting page errors. */
async function open(page: Page, hash: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('http://options.test/**', (route) => route.fulfill({ contentType: 'text/html', body: FIXTURE }));
  await page.goto(`http://options.test/${hash}`);
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(() => (window as unknown as { setupSettingsTabs(el: HTMLElement): void })
    .setupSettingsTabs(document.getElementById('tabs')!));
  return errors;
}

const visiblePanels = (page: Page) =>
  page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[role="tabpanel"]')).filter((p) => !p.hidden).map((p) => p.id));

async function withPage(t: Parameters<typeof ownTestBrowser>[0], run: (page: Page) => Promise<void>): Promise<void> {
  const { chromium } = await import('playwright');
  if (!existsSync(chromium.executablePath())) { (t as { skip(message: string): void }).skip('Chromium is not installed'); return; }
  const browser = await chromium.launch({ headless: true });
  ownTestBrowser(t, browser);
  try { await run(await browser.newPage()); } finally { await browser.close(); }
}

describe('settings tabs', () => {
  it('restores the tab named by the URL hash and keeps the hash in sync with clicks and arrow keys', async (t) => {
    await withPage(t, async (page) => {
      const errors = await open(page, '#features');
      assert.deepEqual(await visiblePanels(page), ['features']);
      await page.locator('#tab-shortcuts').click();
      assert.deepEqual(await visiblePanels(page), ['shortcuts']);
      assert.equal(await page.evaluate(() => location.hash), '#shortcuts');
      await page.keyboard.press('ArrowRight');
      assert.deepEqual(await visiblePanels(page), ['appearance'], 'arrow keys wrap around');
      assert.equal(await page.locator('#tab-appearance').evaluate((el) => el === document.activeElement), true);
      assert.deepEqual(errors, []);
    });
  });

  it('treats a malformed hash escape as an unknown tab instead of failing', async (t) => {
    await withPage(t, async (page) => {
      const errors = await open(page, '#%E0%A4%A');
      assert.deepEqual(errors, []);
      assert.deepEqual(await visiblePanels(page), ['appearance']);
    });
  });
});
