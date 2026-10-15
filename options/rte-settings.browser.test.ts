import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { buildSync } from 'esbuild';
import { chromium, firefox, type Page } from 'playwright';
import { ownTestBrowser } from '../src/test-utils/test-browser';
import { PROVIDER_CAPABILITIES } from '../src/providers/capabilities';
import { MEDIA_PROVIDER_FLAG_KEYS } from '../src/media-features/provider-flags';
import { LANGUAGES } from '../src/language';

const html = readFileSync(new URL('./options.html', import.meta.url), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '');
const css = readFileSync(new URL('./options.css', import.meta.url), 'utf8').replace("@import '../src/settings-brand.css';", readFileSync(new URL('../src/settings-brand.css', import.meta.url), 'utf8'));
const catalogs = Object.fromEntries(LANGUAGES.map(({ locale }) => [locale, JSON.parse(readFileSync(new URL(`../_locales/${locale}/messages.json`, import.meta.url), 'utf8'))]));
const bundle = (empty = false) => buildSync({
  stdin: { contents: `
    import { setupRteSettings } from './rte-settings';
    import { localizeDocument } from '../src/i18n';
    import { languageRuntime } from '../src/i18n-runtime';
    import { setupSettingsTabs } from './tabs';
    ${empty ? "import { PROVIDER_CAPABILITIES } from '../src/providers/capabilities'; PROVIDER_CAPABILITIES.splice(0, PROVIDER_CAPABILITIES.length, { ...PROVIDER_CAPABILITIES[0], capabilities: { ...PROVIDER_CAPABILITIES[0].capabilities, heatmap: { status: 'no' } } });" : ''}
    window.setLanguage = async locale => { await languageRuntime.set(locale); localizeDocument(); };
    window.ready = (async () => {
      await window.setLanguage('en');
      setupSettingsTabs(document.getElementById('settings-tabs'));
      await setupRteSettings(async () => {});
    })();`, resolveDir: new URL('./', import.meta.url).pathname, loader: 'ts' },
  bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent'
}).outputFiles[0].text;
const BUNDLE = bundle();

type Harness = {
  ready: Promise<void>;
  setLanguage(locale: string): Promise<void>;
  external(update: Record<string, unknown>): void;
  writes: Record<string, unknown>[];
  data: Record<string, unknown>;
  duringRead?: Record<string, unknown>;
};

async function open(page: Page, empty = false, initial: Record<string, unknown> = {}, duringRead?: Record<string, unknown>) {
  await page.route('http://options.test/**', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('http://options.test/#features');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: 'window.__name = fn => fn;' });
  await page.evaluate(({ messages, initial, duringRead }) => {
    const state = window as unknown as Harness;
    state.data = initial;
    state.duringRead = duringRead;
    state.writes = [];
    const listeners = new Set<(changes: Record<string, { newValue: unknown }>, area: string) => void>();
    state.external = update => {
      Object.assign(state.data, update);
      const changes = Object.fromEntries(Object.entries(update).map(([key, newValue]) => [key, { newValue }]));
      for (const listener of listeners) listener(changes, 'sync');
    };
    Object.assign(window, { chrome: {
      i18n: { getMessage: (key: string) => key === '@@ui_locale' ? 'en' : key === '@@bidi_dir' ? 'ltr' : '' },
      runtime: { sendMessage: async ({ locale }: { locale: string }) => messages[locale] },
      storage: {
        sync: { get: async () => {
          const snapshot = { ...state.data };
          if (state.duringRead) { state.external(state.duringRead); state.duringRead = undefined; }
          return snapshot;
        }, set: async (update: Record<string, unknown>) => { state.writes.push(update); state.external(update); } },
        onChanged: { addListener: (listener: (changes: Record<string, { newValue: unknown }>, area: string) => void) => listeners.add(listener), removeListener: (listener: (changes: Record<string, { newValue: unknown }>, area: string) => void) => listeners.delete(listener) }
      }
    } });
  }, { messages: catalogs, initial, duringRead });
  await page.addScriptTag({ content: empty ? bundle(true) : BUNDLE });
  await page.evaluate(() => (window as unknown as Harness).ready);
}

for (const [kind, engine] of Object.entries({ chromium, firefox })) describe(`RTE settings (${kind})`, () => {
  it('uses one-provider writes, mixed/all states, keyboard controls and external storage updates', { timeout: 45000 }, async t => {
    const browser = await engine.launch({ headless: true });
    ownTestBrowser(t, browser);
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await open(page);
      assert.equal(await page.locator('.rte-tile').count(), 10);
      await page.locator('[data-provider="netflix"] .rte-control').click();
      assert.deepEqual(await page.evaluate(() => (window as unknown as Harness).writes), [{ netflixIntegrationEnabled: false }]);
      assert.equal(await page.locator('#rte-all').evaluate((el: HTMLInputElement) => el.indeterminate), true);
      assert.equal(await page.locator('#rte-count').textContent(), '9 of 10 on');
      await page.locator('#rte-all').press('Space');
      assert.equal(await page.locator('#rte-all').isChecked(), true);
      assert.equal(Object.keys(await page.evaluate(() => (window as unknown as Harness).writes.at(-1)!)).length, 10);
      await page.locator('#rte-all').press('Space');
      assert.equal(await page.locator('#rte-count').textContent(), '0 of 10 on');
      await page.locator('#rte-youtube').focus();
      await page.keyboard.press('Space');
      assert.equal(await page.locator('#rte-youtube').isChecked(), true);
      assert.equal(await page.locator('#rte-youtube').evaluate(el => el === document.activeElement), true);
      await page.evaluate(() => (window as unknown as Harness).external({ netflixIntegrationEnabled: true }));
      assert.equal(await page.locator('#rte-netflix').isChecked(), true);
      assert.equal(await page.locator('#rte-count').textContent(), '2 of 10 on');
      assert.ok((await page.locator('#rte-netflix').getAttribute('aria-describedby'))?.includes('rte-note-netflix'));
      const details = page.locator('[data-provider="netflix"] .rte-details-toggle');
      await details.click();
      assert.equal(await details.getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('#rte-details-netflix').isVisible(), true);
      assert.ok((await page.locator('[data-provider="patreon"] .rte-badge').first().boundingBox())!.height < 28, 'expanding a neighboring tile must not stretch badge pills');
      assert.equal(await page.locator('#rte-netflix').isChecked(), true);
      assert.equal(await details.evaluate(el => el === document.activeElement), true);
      const writesBefore = await page.evaluate(() => (window as unknown as Harness).writes.length);
      await details.press('Space');
      assert.equal(await details.getAttribute('aria-expanded'), 'false');
      await details.press('Enter');
      assert.equal(await details.getAttribute('aria-expanded'), 'true');
      assert.equal(await page.evaluate(() => (window as unknown as Harness).writes.length), writesBefore);
      await page.evaluate(() => (window as unknown as Harness).setLanguage('pl'));
      assert.equal(await details.textContent(), catalogs.pl.rteDetails.message);
      assert.equal(await page.locator('#rte-details-netflix p').textContent(), catalogs.pl.netflixIntegrationDescription.message);
      assert.equal(await details.getAttribute('aria-expanded'), 'true');
      assert.equal(await details.evaluate(el => el === document.activeElement), true);
      const legacy = await browser.newPage();
      await open(legacy, false, Object.fromEntries(['youtube', 'vimeo', 'patreon', 'twitch', 'disney'].map(id => [MEDIA_PROVIDER_FLAG_KEYS[id as keyof typeof MEDIA_PROVIDER_FLAG_KEYS], false])), { netflixIntegrationEnabled: true });
      assert.equal(await legacy.locator('#rte-count').textContent(), '1 of 10 on', 'storage events supersede the in-flight initial snapshot');
      assert.equal(await legacy.evaluate(() => (window as unknown as Harness).writes.length), 1, 'legacy defaults are materialized once before editing');
      await legacy.evaluate(() => { (window as unknown as Harness).writes = []; });
      await legacy.locator('#rte-youtube').press('Space');
      assert.equal(await legacy.locator('#rte-count').textContent(), '2 of 10 on');
      assert.deepEqual(await legacy.evaluate(() => (window as unknown as Harness).writes), [{ youtubeIntegrationEnabled: true }]);
      assert.equal(await legacy.locator('#rte-netflix').isChecked(), true);
      assert.equal(await legacy.locator('#rte-tencent').isChecked(), false);
    } finally { await browser.close(); }
  });

  it('filters with AND logic, highlights matches, scopes master writes and clears without saving', { timeout: 45000 }, async t => {
    const browser = await engine.launch({ headless: true });
    ownTestBrowser(t, browser);
    try {
      const page = await browser.newPage();
      await open(page);
      await page.locator('#rte-filter-buttons [data-capability="chapters"]').click();
      assert.equal(await page.locator('.rte-tile:visible').count(), 7);
      await page.locator('#rte-filter-buttons [data-capability="quickActions"]').press('Space');
      assert.equal(await page.locator('.rte-tile:visible').count(), 5);
      assert.equal(await page.locator('#rte-shown').textContent(), '5 of 10 services shown');
      assert.equal(await page.locator('#rte-filter-buttons [aria-pressed="true"]').count(), 2);
      assert.equal(await page.locator('.rte-tile:visible .is-matching').count(), 10);
      assert.equal(await page.locator('#rte-all-label').textContent(), 'All shown services');
      assert.deepEqual(await page.evaluate(() => (window as unknown as Harness).writes), []);
      await page.locator('#rte-all').click();
      const update = await page.evaluate(() => (window as unknown as Harness).writes.at(-1));
      assert.deepEqual(Object.keys(update!).sort(), ['youtube', 'vimeo', 'bilibili', 'bilibiliIntl', 'crunchyroll'].map(id => MEDIA_PROVIDER_FLAG_KEYS[id as keyof typeof MEDIA_PROVIDER_FLAG_KEYS]).sort());
      await page.locator('#rte-clear').click();
      assert.equal(await page.locator('.rte-tile:visible').count(), 10);
      assert.equal(await page.locator('#rte-all').evaluate((el: HTMLInputElement) => el.indeterminate), true);
      assert.equal(await page.locator('#rte-clear').isVisible(), false);
      assert.equal(await page.locator('#rte-shown').getAttribute('role'), 'status');
      assert.equal(await page.evaluate(() => (window as unknown as Harness).writes.length), 1);
    } finally { await browser.close(); }
  });

  it('localizes every language live, sorts with its collator and preserves focus and filters in RTL', { timeout: 45000 }, async t => {
    const browser = await engine.launch({ headless: true });
    ownTestBrowser(t, browser);
    try {
      const page = await browser.newPage();
      await open(page);
      await page.locator('#rte-filter-buttons [data-capability="heatmap"]').click();
      for (const { locale } of LANGUAGES) {
        await page.evaluate(locale => (window as unknown as Harness).setLanguage(locale), locale);
        assert.equal(await page.locator('#rte-all-label').textContent(), catalogs[locale].rteAllShown.message);
        assert.equal(await page.locator('#rte-filter-buttons [data-capability="heatmap"]').textContent(), `${catalogs[locale].rteCapabilityHeatmap.message} · 2`);
        const names = await page.locator('.rte-name').allTextContents();
        assert.deepEqual(names, PROVIDER_CAPABILITIES.map(p => p.name).sort(new Intl.Collator(locale.replace('_', '-')).compare));
        assert.equal(await page.locator('.rte-tile:visible').count(), 2);
        assert.equal(await page.locator('#rte-filter-buttons [data-capability="heatmap"]').evaluate(el => el === document.activeElement), true);
        assert.equal(await page.locator('#rte-note-netflix').textContent(), catalogs[locale].rteNoteNetflix.message);
      }
      assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
      await page.setViewportSize({ width: 420, height: 800 });
      assert.equal(await page.locator('#rte-tiles').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    } finally { await browser.close(); }
  });

  it('bounds shared sticky headings to their card and restores normal flow below 860px', { timeout: 45000 }, async t => {
    const browser = await engine.launch({ headless: true });
    ownTestBrowser(t, browser);
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 600 } });
      await open(page);
      await page.locator('#tab-shortcuts').click();
      // Give the document scroll room beyond the card to observe its lower boundary.
      await page.evaluate(() => { document.body.style.paddingBottom = '800px'; });
      const heading = page.locator('#shortcuts .card-heading-inner');
      await page.evaluate(() => scrollTo(0, document.getElementById('shortcuts')!.offsetTop + 250));
      assert.ok(Math.abs((await heading.boundingBox())!.y - 16) < 2);
      await page.evaluate(() => { const card = document.getElementById('shortcuts')!; scrollTo(0, card.offsetTop + card.offsetHeight - 60); });
      const bounds = await heading.boundingBox();
      const card = await page.locator('#shortcuts').boundingBox();
      assert.ok(bounds!.y < 16, 'heading leaves sticky top at card end');
      assert.ok(bounds!.y + bounds!.height <= card!.y + card!.height, 'heading stays inside card');
      await page.setViewportSize({ width: 420, height: 700 });
      assert.equal(await heading.evaluate(el => getComputedStyle(el).position), 'static');
    } finally { await browser.close(); }
  });

  it('keeps gradient, ribbon and arc motion decorative, one-shot and reduced-motion aware', { timeout: 45000 }, async t => {
    const browser = await engine.launch({ headless: true });
    ownTestBrowser(t, browser);
    try {
      const page = await browser.newPage();
      await open(page);
      const netflix = page.locator('[data-provider="netflix"]');
      const disney = page.locator('[data-provider="disney"]');
      assert.equal(await disney.evaluate(el => getComputedStyle(el, '::before').animationName), 'none');
      await disney.hover();
      assert.equal(await disney.evaluate(el => getComputedStyle(el, '::before').animationIterationCount), '1');
      assert.equal(await disney.evaluate(el => getComputedStyle(el, '::before').animationDuration), '1.1s');
      assert.equal(await disney.evaluate(el => getComputedStyle(el, '::before').pointerEvents), 'none');
      await netflix.hover();
      assert.equal(await netflix.evaluate(el => getComputedStyle(el, '::before').transitionDuration), '0.75s, 0.75s');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await netflix.evaluate(el => getComputedStyle(el, '::before').display), 'none');
      await disney.hover();
      assert.equal(await disney.evaluate(el => getComputedStyle(el, '::before').display), 'none');
      assert.equal(await disney.evaluate(el => getComputedStyle(el).transitionDuration), '0s');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.locator('#rte-netflix').focus();
      await page.keyboard.press('Space');
      await netflix.hover();
      await netflix.evaluate(async el => { await Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)); });
      assert.equal(await netflix.evaluate(el => getComputedStyle(el, '::before').opacity), '0');
    } finally { await browser.close(); }
  });

  it('announces an empty result and disables its master for a catalog without a matching service', { timeout: 45000 }, async t => {
    const browser = await engine.launch({ headless: true });
    ownTestBrowser(t, browser);
    try {
      const page = await browser.newPage();
      await open(page, true);
      await page.locator('#rte-filter-buttons [data-capability="heatmap"]').click();
      assert.equal(await page.locator('.rte-tile:visible').count(), 0);
      assert.equal(await page.locator('#rte-empty').isVisible(), true);
      assert.equal(await page.locator('#rte-all').isDisabled(), true);
      assert.equal(await page.locator('#rte-shown').textContent(), '0 of 1 services shown');
      assert.deepEqual(await page.evaluate(() => (window as unknown as Harness).writes), []);
    } finally { await browser.close(); }
  });
});
