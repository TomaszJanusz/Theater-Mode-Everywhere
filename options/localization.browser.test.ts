import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright';
import { ownTestBrowser } from '../src/test-utils/test-browser';
import { assertLocalized, readCatalog } from '../src/test-utils/language-audit';
import { LANGUAGES } from '../src/language';
import { WHATS_NEW_RELEASE } from '../src/whatsNew-release';

const root = path.resolve(__dirname, '..');
const bundles = Promise.all(['options/options.ts', 'popup/popup.ts'].map(entry => build({
  entryPoints: [path.join(root, entry)], bundle: true, write: false, format: 'iife', target: 'es2022',
  plugins: [{ name: 'raw', setup(builder) {
    builder.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' }));
    builder.onLoad({ filter: /.*/, namespace: 'raw' }, args => ({ contents: readFileSync(args.path, 'utf8'), loader: 'text' }));
  } }]
}).then(result => result.outputFiles![0].text)));

async function open(page: Page, surface: 'options' | 'popup', blacklist: string[], url = 'chrome://extensions'): Promise<void> {
  const initialize = ({ catalogs, blacklist, url, release }: { catalogs: Record<string, ReturnType<typeof readCatalog>>; blacklist: string[]; url: string; release: string }) => {
    localStorage.setItem('whatsNewAcknowledgedId', release);
    const saved: Record<string, unknown> = { blacklist, shortcuts: { toggle: '', cycle: 'T', playPause: 'T' } };
    const listeners = new Set<(changes: Record<string, { newValue: unknown }>, area: string) => void>();
    const storage = {
      get: (_keys: unknown, callback?: (data: object) => void) => { callback?.(saved); return Promise.resolve({ ...saved }); },
      set: async (values: Record<string, unknown>) => {
        Object.assign(saved, values);
        const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }]));
        listeners.forEach(listener => listener(changes, 'sync'));
      }
    };
    Object.defineProperty(window, 'chrome', { configurable: true, value: {
      runtime: { getURL: (file: string) => file, sendMessage: async (request: { locale: keyof typeof catalogs; action: string }) =>
        request.action === 'get-language-catalog' ? catalogs[request.locale] : { status: 'conflict', owners: ['cycle'] } },
      storage: { sync: storage, onChanged: { addListener: listeners.add.bind(listeners), removeListener: listeners.delete.bind(listeners) } },
      tabs: { query: async () => url ? [{ id: 1, url }] : [] }
    } });
  };
  // tsx names nested callbacks with __name; keep that helper inside the fixture.
  await page.addInitScript({ content: `window.__name = fn => fn; (${initialize.toString()})(${JSON.stringify({ catalogs: { en: readCatalog('en'), pl: readCatalog('pl'), ar: readCatalog('ar') }, blacklist, url, release: WHATS_NEW_RELEASE.id })});` });
  const html = readFileSync(path.join(root, surface, `${surface}.html`), 'utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');
  await page.route('http://localization.test/**', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('http://localization.test/');
  await page.addScriptTag({ content: (await bundles)[surface === 'options' ? 0 : 1] });
  if (surface === 'popup') {
    await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
    await page.waitForFunction(() => document.getElementById('domain-name')!.textContent !== 'Loading...');
  } else {
    await page.waitForFunction(() => document.querySelector('.shortcuts-grid')?.getAttribute('aria-busy') === 'false');
  }
}

async function switchTo(page: Page, locale: string): Promise<void> {
  await page.evaluate(locale => chrome.storage.sync.set({ language: locale }), locale);
  await page.waitForFunction(locale => document.documentElement.lang === locale, locale);
}

for (const blacklist of [[], ['example.com', 'second.com']]) {
  it(`Settings catalog audit relabels all five tabs and dynamic exclusions (${blacklist.length} rows) without reload`, { timeout: 30_000 }, async t => {
    const browser = await chromium.launch({ headless: true });
    ownTestBrowser(t, browser);
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await open(page, 'options', blacklist);
      assert.equal(await page.locator('[role=tab]').count(), 5);
      const language = page.locator('#language-combobox');
      assert.equal(await page.locator('#language-combobox-listbox [role=option]').count(), LANGUAGES.length + 1);
      for (const { locale } of LANGUAGES) {
        const option = page.locator(`#language-combobox-listbox [data-value="${locale}"]`);
        assert.equal(await option.getAttribute('lang'), locale.replace('_', '-'));
        assert.equal(await option.getAttribute('dir'), locale === 'ar' ? 'rtl' : 'ltr');
      }
      const accent = page.locator('#accent-color-grid [data-choice=teal]');
      await accent.click();
      const original = await accent.elementHandle();
      assert.equal(await accent.getAttribute('title'), 'Teal');
      await page.locator('#tab-exclusions').click();
      await page.locator('#domain-input').fill('invalid');
      await page.locator('#add-domain-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
      await page.locator('#tab-appearance').click();
      await accent.focus();
      for (const locale of ['pl', 'ar']) {
        await switchTo(page, locale);
        const catalog = readCatalog(locale);
        assert.equal(await page.locator('#language-combobox-listbox [aria-selected=true]').getAttribute('data-value'), locale);
        assert.equal(await page.locator('#language-combobox-listbox [data-value=automatic]').textContent(), catalog.languageAutomatic.message);
        await language.ariaSnapshot().then(snapshot => assert.ok(snapshot.includes(catalog.languageTitle.message)));
        assert.equal(await page.locator('#language-description').textContent(), catalog.languageDescription.message);
        assert.equal(await language.getAttribute('aria-describedby'), 'language-description');
        for (const key of ['highContrast', 'reduceTransparency', 'reduceMotion']) {
          assert.equal(await page.locator(`#${key}-combobox`).textContent(), catalog.appearanceAuto.message);
          assert.equal(await page.locator(`#${key}-combobox-listbox [data-value=auto]`).textContent(), catalog.appearanceAuto.message);
          assert.equal(await page.locator(`#${key}-combobox-listbox [data-value=on]`).textContent(), catalog.controlsVisibilityOn.message);
          assert.equal(await page.locator(`#${key}-combobox-listbox [data-value=off]`).textContent(), catalog.controlsVisibilityOff.message);
          assert.equal(await page.locator(`#${key}-combobox-listbox [aria-selected=true]`).getAttribute('data-value'), 'auto');
        }
        assert.equal(await accent.textContent(), catalog.accentColorTeal.message);
        assert.equal(await accent.getAttribute('title'), catalog.accentColorTeal.message);
        assert.equal(await accent.getAttribute('aria-label'), catalog.useAccentColor.message.replace(/\$color\$/i, catalog.accentColorTeal.message));
        assert.equal(await original!.evaluate(el => el.isConnected && el === document.activeElement), true);
        assert.equal(await accent.getAttribute('aria-checked'), 'true');
        assert.equal(await page.locator('#validation-msg').textContent(), catalog.invalidDomain.message);
        await assertLocalized(page, locale);
      }
      await page.locator('#tab-about').click();
      const privacy = page.locator('#about a[data-i18n="privacyPolicy"]');
      for (const locale of ['en', 'pl', 'ar']) {
        await switchTo(page, locale);
        assert.equal(await privacy.isVisible(), true);
        assert.equal(await privacy.textContent(), readCatalog(locale).privacyPolicy.message);
        assert.equal(await privacy.getAttribute('href'), 'https://github.com/TomaszJanusz/Theater-Mode-Everywhere/blob/main/PRIVACY.md');
        assert.equal(await privacy.getAttribute('target'), '_blank');
        assert.equal(await privacy.getAttribute('rel'), 'noopener noreferrer');
      }
      await page.locator('#tab-features').click();
      // An expanded service description is covered too: its text must follow the language live.
      await page.locator('.rte-details-toggle').first().click();
      await switchTo(page, 'pl');
      await assertLocalized(page, 'pl');
      await page.locator('#whats-new-btn').click();
      await page.locator('.te-dialog').waitFor();
      const acknowledge = page.locator('.te-dialog-btn-primary');
      await acknowledge.focus();
      for (const locale of ['ar', 'pl']) {
        await switchTo(page, locale);
        assert.equal(await page.locator('.te-dialog-title').textContent(), readCatalog(locale).whatsNewDialogTitle.message);
        assert.equal(await acknowledge.evaluate(el => el === document.activeElement), true);
        await assertLocalized(page, locale);
      }
      await acknowledge.click();
      await page.locator('.te-dialog').waitFor({ state: 'detached' });
      await page.locator('#tab-shortcuts').click();
      await page.locator('#shortcut-cycle').press('Escape');
      await page.locator('.te-dialog').waitFor();
      await switchTo(page, 'ar');
      await assertLocalized(page, 'ar');
      await page.locator('.te-dialog-btn-primary').click();
      await page.locator('.te-dialog').waitFor({ state: 'detached' });
      await page.locator('#shortcut-play-pause').press('k');
      await page.locator('.te-dialog-btn-secondary').waitFor();
      await switchTo(page, 'pl');
      await assertLocalized(page, 'pl');
      const description = await page.locator('.te-dialog-body').textContent();
      assert.ok(description?.includes(readCatalog('pl').cycleSwitchPlayer.message));
      assert.ok(description?.includes(readCatalog('pl').playPause.message));
      await page.locator('.te-dialog-btn-secondary').click();
      await page.locator('.te-dialog').waitFor({ state: 'detached' });
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}

for (const url of ['chrome://extensions', '', 'https://example.com/watch', 'https://child.example.com/watch', 'https://youtube.com/watch']) {
  it(`popup catalog audit refreshes dynamic domain/status (${url || 'no tab'})`, { timeout: 30_000 }, async t => {
    const browser = await chromium.launch({ headless: true });
    ownTestBrowser(t, browser);
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await open(page, 'popup', ['example.com'], url);
      for (const locale of ['pl', 'ar']) {
        await switchTo(page, locale);
        await assertLocalized(page, locale);
      }
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
