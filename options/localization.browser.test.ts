import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright';
import { ownTestBrowser } from '../src/test-utils/test-browser';
import { assertLocalized, readCatalog } from '../src/test-utils/language-audit';
import { readStylesheet } from '../src/test-utils/styles';
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
  await page.addStyleTag({ content: readFileSync(path.join(root, surface, `${surface}.css`), 'utf8') }).catch(() => undefined);
  await page.addScriptTag({ content: (await bundles)[surface === 'options' ? 0 : 1] });
  if (surface === 'popup') {
    await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
    await page.waitForFunction(() => document.getElementById('domain-name')!.textContent !== 'Loading...');
  } else {
    await page.waitForFunction(() => document.querySelector('#shortcuts .options-body')?.getAttribute('aria-busy') === 'false');
  }
}

it('Settings groups AutoTheater and accessibility, persists countdown choices, and fits narrow layouts', { timeout: 30_000 }, async t => {
  const browser = await chromium.launch({ headless: true });
  ownTestBrowser(t, browser);
  try {
    const page = await browser.newPage();
    await open(page, 'options', []);
    await page.addStyleTag({ content: readStylesheet(path.join(root, 'options/options.css')) });
    await page.locator('#tab-features').click();
    const group = page.getByRole('group', { name: 'AutoTheater', exact: true });
    assert.equal(await group.locator('input[type=checkbox]').count(), 2);
    const skip = page.locator('#auto-theater-skip-countdown-toggle');
    assert.equal(await skip.isChecked(), false, 'existing settings retain the countdown');
    await page.locator('label[for=auto-theater-skip-countdown-toggle]').click();
    assert.equal(await page.evaluate(async () => (await chrome.storage.sync.get('autoTheaterSkipCountdown')).autoTheaterSkipCountdown), true);
    await page.evaluate(() => chrome.storage.sync.set({ autoTheaterSkipCountdown: false }));
    assert.equal(await skip.isChecked(), false, 'external changes update the same control');
    await page.evaluate(() => chrome.storage.sync.set({ autoTheaterSkipCountdown: 'true' }));
    assert.equal(await skip.isChecked(), false, 'invalid saved values retain the countdown');
    await page.locator('#tab-appearance').click();
    assert.equal(await page.locator('#appearance label[for=keep-controls-visible-toggle]').isVisible(), true);
    assert.equal(await page.getByRole('group', { name: 'Accessibility', exact: true }).locator('.choice-combobox').count(), 3);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const locale of ['en', 'pl', 'ar']) {
        await switchTo(page, locale);
        for (const tab of ['appearance', 'features', 'shortcuts']) {
          await page.locator(`#tab-${tab}`).click();
          assert.equal(await page.locator(`#${tab}`).evaluate(panel => {
            return [...panel.querySelectorAll('.options-row')].every(row => {
              const bounds = row.getBoundingClientRect();
              return bounds.width > 0 && bounds.left >= 0 && bounds.right <= innerWidth
                && row.scrollWidth <= row.clientWidth + 1;
            });
          }), true, `${locale} ${tab} at ${width}px keeps rows inside the viewport`);
        }
      }
    }
  } finally { await browser.close(); }
});

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
      const privacy = page.locator('#privacy-policy-btn');
      for (const locale of ['en', 'pl', 'ar']) {
        await switchTo(page, locale);
        const catalog = readCatalog(locale);
        assert.equal(await page.locator('#about .about-privacy h2').textContent(), catalog.privacyPolicy.message);
        assert.equal(await page.locator('#about .about-privacy p').textContent(), catalog.privacyPolicyDescription.message);
        assert.equal(await privacy.textContent(), catalog.privacyPolicyRead.message);
        await privacy.focus();
        await page.keyboard.press('Enter');
        const dialog = page.locator('.te-dialog-privacy');
        await dialog.waitFor();
        assert.equal(await page.locator('.te-dialog-title').textContent(), catalog.privacyPolicy.message);
        assert.equal(await dialog.getAttribute('aria-modal'), 'true');
        assert.equal(await dialog.getAttribute('aria-labelledby'), await page.locator('.te-dialog-title').getAttribute('id'));
        assert.equal(await page.evaluate(() => document.body.classList.contains('te-dialog-open')), true);
        const text = page.locator('.privacy-policy-text');
        assert.match(await text.textContent() ?? '', /Stored settings/);
        assert.equal(await text.evaluate(el => el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === 'auto'), true);
        const online = page.locator('.privacy-policy-online');
        assert.equal(await online.textContent(), catalog.privacyPolicyOpenOnline.message);
        assert.equal(await online.getAttribute('href'), 'https://theater.tomaszjanusz.dev/privacy-policy/');
        assert.equal(await online.getAttribute('target'), '_blank');
        assert.equal(await online.getAttribute('rel'), 'noopener noreferrer');
        assert.equal(await dialog.locator('script, [onclick], a[href^="javascript:"]').count(), 0);
        // Tab cycles inside the dialog; the page behind it is inert.
        for (let i = 0; i < 6; i++) {
          await page.keyboard.press('Tab');
          assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.te-dialog')), true);
        }
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        assert.equal(await privacy.evaluate(el => el === document.activeElement), true);
        assert.equal(await page.evaluate(() => document.body.classList.contains('te-dialog-open')), false);
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
