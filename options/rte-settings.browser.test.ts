import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { LANGUAGES } from '../src/language';
import { MEDIA_PROVIDER_FLAG_KEYS } from '../src/media-features/provider-flags';
import { MEDIA_CAPABILITIES, PROVIDER_CAPABILITIES } from '../src/providers/capabilities';
import { bundleModules } from '../src/test-utils/player-boot';
import { readStylesheet } from '../src/test-utils/styles';
import { sharedTestBrowser } from '../src/test-utils/test-browser';
import { selectTestEngines } from '../src/test-utils/test-engines';

import { brightestStop, hexRgb, luminance, over } from './rte-colors';


// Counts follow the declarations, so adding a provider or capability never edits these tests.
const supporting = (...keys: Array<keyof (typeof PROVIDER_CAPABILITIES)[number]['capabilities']>) =>
  PROVIDER_CAPABILITIES.filter(provider => keys.every(key => provider.capabilities[key].status !== 'no'));
const html = readFileSync(new URL('./options.html', import.meta.url), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '');
const css = readStylesheet(new URL('./options.css', import.meta.url));
const catalogs = Object.fromEntries(LANGUAGES.map(({ locale }) => [locale, JSON.parse(readFileSync(new URL(`../_locales/${locale}/messages.json`, import.meta.url), 'utf8'))]));
const bundle = (empty = false) => bundleModules([`
    import { setupRteSettings } from '../options/rte-settings';
    import { localizeDocument } from './i18n';
    import { languageRuntime } from './i18n-runtime';
    import { observeAppearance } from './appearance-runtime';
    import { setupSettingsTabs } from '../options/tabs';
    ${empty ? "import { PROVIDER_CAPABILITIES } from './providers/capabilities'; PROVIDER_CAPABILITIES.splice(0, PROVIDER_CAPABILITIES.length, { ...PROVIDER_CAPABILITIES[0], capabilities: { ...PROVIDER_CAPABILITIES[0].capabilities, heatmap: { status: 'no' } } });" : ''}
    window.setLanguage = async locale => { await languageRuntime.set(locale); localizeDocument(); };
    window.ready = (async () => {
      await window.setLanguage('en');
      setupSettingsTabs(document.getElementById('settings-tabs'));
      observeAppearance(document.documentElement);
      await setupRteSettings(async () => {});
    })();`]);
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
        sync: { get: async (_keys: unknown, callback?: (data: Record<string, unknown>) => void) => {
          const snapshot = { ...state.data };
          if (!callback && state.duringRead) { state.external(state.duringRead); state.duringRead = undefined; }
          callback?.(snapshot);
          return snapshot;
        }, set: async (update: Record<string, unknown>) => { state.writes.push(update); state.external(update); } },
        onChanged: { addListener: (listener: (changes: Record<string, { newValue: unknown }>, area: string) => void) => listeners.add(listener), removeListener: (listener: (changes: Record<string, { newValue: unknown }>, area: string) => void) => listeners.delete(listener) }
      }
    } });
  }, { messages: catalogs, initial, duringRead });
  await page.addScriptTag({ content: empty ? bundle(true) : BUNDLE });
  await page.evaluate(() => (window as unknown as Harness).ready);
}

for (const [kind, engine] of selectTestEngines(Object.entries({ chromium, firefox }), ([name]) => name)) describe(`RTE settings (${kind})`, () => {
  const shared = sharedTestBrowser(engine);
  it('uses one-provider writes, mixed/all states, keyboard controls and external storage updates', { timeout: 45000 }, async t => {
    const context = await shared.newContext(t, { viewport: { width: 1280, height: 800 } });
    try {
      const page = await context.newPage();
      await open(page);
      assert.equal(await page.locator('.rte-tile').count(), PROVIDER_CAPABILITIES.length);
      await page.locator('[data-provider="netflix"] .rte-control').click();
      assert.deepEqual(await page.evaluate(() => (window as unknown as Harness).writes), [{ netflixIntegrationEnabled: false }]);
      assert.equal(await page.locator('#rte-all').evaluate((el: HTMLInputElement) => el.indeterminate), true);

      await page.locator('#rte-all').press('Space');
      assert.equal(await page.locator('#rte-all').isChecked(), true);
      assert.equal(Object.keys(await page.evaluate(() => (window as unknown as Harness).writes.at(-1)!)).length, PROVIDER_CAPABILITIES.length);
      await page.locator('#rte-all').press('Space');

      await page.locator('#rte-youtube').focus();
      await page.keyboard.press('Space');
      assert.equal(await page.locator('#rte-youtube').isChecked(), true);
      assert.equal(await page.locator('#rte-youtube').evaluate(el => el === document.activeElement), true);
      await page.evaluate(() => (window as unknown as Harness).external({ netflixIntegrationEnabled: true }));
      assert.equal(await page.locator('#rte-netflix').isChecked(), true);

      assert.ok((await page.locator('#rte-netflix').getAttribute('aria-describedby'))?.includes('rte-note-netflix'));
      const details = page.locator('[data-provider="netflix"] .rte-details-toggle');
      await details.click();
      assert.equal(await details.getAttribute('aria-expanded'), 'true');
      await page.locator('#rte-details-netflix').waitFor({ state: 'visible' });
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
      const legacy = await (await shared.newContext(t)).newPage();
      await open(legacy, false, Object.fromEntries(['youtube', 'vimeo', 'patreon', 'twitch', 'disney'].map(id => [MEDIA_PROVIDER_FLAG_KEYS[id as keyof typeof MEDIA_PROVIDER_FLAG_KEYS], false])), { netflixIntegrationEnabled: true });

      assert.equal(await legacy.locator('.rte-tile input:checked').count(), 1, 'storage events supersede the in-flight initial snapshot');
      assert.equal(await legacy.evaluate(() => (window as unknown as Harness).writes.length), 1, 'legacy defaults are materialized once before editing');
      await legacy.evaluate(() => { (window as unknown as Harness).writes = []; });
      await legacy.locator('#rte-youtube').press('Space');

      assert.deepEqual(await legacy.evaluate(() => (window as unknown as Harness).writes), [{ youtubeIntegrationEnabled: true }]);
      assert.equal(await legacy.locator('#rte-netflix').isChecked(), true);
      assert.equal(await legacy.locator('#rte-tencent').isChecked(), false);
    } finally { await context.close(); }
  });

  it('writes, mirrors and describes the Rakuten Viki switch like any other service', { timeout: 45000 }, async t => {
    const context = await shared.newContext(t);
    try {
      const page = await context.newPage();
      await open(page);
      const viki = page.locator('[data-provider="viki"]');
      assert.equal(await page.locator('#rte-viki').isChecked(), true);
      assert.deepEqual(await viki.locator('.rte-badge').evaluateAll(badges => badges.map(badge => badge.getAttribute('data-capability'))).then(list => list.sort()), ['audio', 'autoTheater', 'chapters', 'playlists', 'quickActions', 'subtitles', 'thumbnails', 'title']);
      await page.locator('[data-provider="viki"] .rte-control').click();
      assert.deepEqual(await page.evaluate(() => (window as unknown as Harness).writes), [{ vikiIntegrationEnabled: false }]);
      assert.equal(await page.locator('#rte-viki').isChecked(), false);
      await page.evaluate(() => (window as unknown as Harness).external({ vikiIntegrationEnabled: true }));
      assert.equal(await page.locator('#rte-viki').isChecked(), true);
      assert.equal(await page.locator('#rte-note-viki').textContent(), catalogs.en.rteNoteViki.message);
      await page.evaluate(() => (window as unknown as Harness).setLanguage('pl'));
      assert.equal(await page.locator('#rte-note-viki').textContent(), catalogs.pl.rteNoteViki.message);
    } finally { await context.close(); }
  });

  it('filters AutoTheater services, combines with another chip and clears', { timeout: 45000 }, async t => {
    const context = await shared.newContext(t);
    try {
      const page = await context.newPage();
      await open(page);
      const total = PROVIDER_CAPABILITIES.length;
      const automatic = PROVIDER_CAPABILITIES.filter(provider => provider.capabilities.autoTheater.status !== 'no');
      const combined = automatic.filter(provider => provider.capabilities.heatmap.status !== 'no');
      const expectedNames = (providers: typeof PROVIDER_CAPABILITIES) => providers.map(provider => provider.name).sort();
      const chip = page.locator('#rte-filter-buttons [data-capability="autoTheater"]');
      assert.equal(await chip.textContent(), `AutoTheater · ${automatic.length}`);
      assert.equal(await chip.getAttribute('aria-pressed'), 'false');
      const names = () => page.locator('.rte-tile:visible .rte-name').allTextContents();
      await chip.press('Space');
      assert.equal(await chip.getAttribute('aria-pressed'), 'true');
      assert.deepEqual((await names()).sort(), expectedNames(automatic));
      assert.equal(await page.locator('#rte-shown').textContent(), `${automatic.length} of ${total} services shown`);
      await page.locator('#rte-filter-buttons [data-capability="heatmap"]').click();
      assert.deepEqual((await names()).sort(), expectedNames(combined));
      assert.equal(await page.locator('#rte-shown').textContent(), `${combined.length} of ${total} services shown`);
      await page.locator('#rte-clear').click();
      assert.equal(await chip.getAttribute('aria-pressed'), 'false');
      assert.equal(await page.locator('.rte-tile:visible').count(), total);
      assert.deepEqual((await names()).sort(), expectedNames(PROVIDER_CAPABILITIES));
      assert.equal(await page.locator('#rte-filter-buttons [aria-pressed="true"]').count(), 0);
      assert.equal(await page.locator('#rte-shown').textContent(), `${total} of ${total} services shown`);
    } finally { await context.close(); }
  });

  it('filters with AND logic, highlights matches, scopes master writes and clears without saving', { timeout: 45000 }, async t => {
    const context = await shared.newContext(t);
    try {
      const page = await context.newPage();
      await open(page);
      await page.locator('#rte-filter-buttons [data-capability="chapters"]').click();
      assert.equal(await page.locator('.rte-tile:visible').count(), supporting('chapters').length);
      await page.locator('#rte-filter-buttons [data-capability="quickActions"]').press('Space');
      const both = supporting('chapters', 'quickActions');
      assert.equal(await page.locator('.rte-tile:visible').count(), both.length);
      assert.equal(await page.locator('#rte-shown').textContent(), `${both.length} of ${PROVIDER_CAPABILITIES.length} services shown`);
      assert.equal(await page.locator('#rte-filter-buttons [aria-pressed="true"]').count(), 2);
      assert.equal(await page.locator('.rte-tile:visible .is-matching').count(), both.length * 2);
      assert.equal(await page.locator('#rte-all-label').textContent(), 'All shown services');
      assert.deepEqual(await page.evaluate(() => (window as unknown as Harness).writes), []);
      await page.locator('#rte-all').click();
      const update = await page.evaluate(() => (window as unknown as Harness).writes.at(-1));
      assert.deepEqual(Object.keys(update!).sort(), both.map(provider => MEDIA_PROVIDER_FLAG_KEYS[provider.id]).sort());
      await page.locator('#rte-clear').click();
      assert.equal(await page.locator('.rte-tile:visible').count(), PROVIDER_CAPABILITIES.length);
      assert.equal(await page.locator('#rte-all').evaluate((el: HTMLInputElement) => el.indeterminate), true);
      assert.equal(await page.locator('#rte-clear').isVisible(), false);
      assert.equal(await page.locator('#rte-shown').getAttribute('role'), 'status');
      assert.equal(await page.evaluate(() => (window as unknown as Harness).writes.length), 1);
    } finally { await context.close(); }
  });

  it('advertises only registered playlist navigation and localizes its filter and badges', { timeout: 45000 }, async t => {
    const context = await shared.newContext(t);
    try {
      const page = await context.newPage();
      await open(page);
      const supported = supporting('playlists').map(provider => provider.id).sort();
      assert.deepEqual((await page.locator('.rte-tile:has(.rte-badge[data-capability="playlists"])').evaluateAll(tiles => tiles.map(tile => tile.getAttribute('data-provider')))).sort(), supported);
      const filter = page.locator('#rte-filter-buttons [data-capability="playlists"]');
      await filter.click();
      // Live switching across every bundled language is proven by the next test; locale key parity by scripts/locales.test.ts.
      for (const locale of ['pl', 'ar'] as const) {
        await page.evaluate(locale => (window as unknown as Harness).setLanguage(locale), locale);
        assert.equal(await filter.textContent(), `${catalogs[locale].rteCapabilityPlaylists.message} · ${supported.length}`);
        assert.deepEqual((await page.locator('.rte-tile:visible').evaluateAll(tiles => tiles.map(tile => tile.getAttribute('data-provider')))).sort(), supported);
        assert.ok((await page.locator('.rte-badge[data-capability="playlists"]').allTextContents()).every(text => text === catalogs[locale].rteCapabilityPlaylists.message));
      }
      await page.locator('#rte-filter-buttons [data-capability="chapters"]').click();
      assert.equal(await page.locator('.rte-tile:visible').count(), supporting('playlists', 'chapters').length);
      await page.locator('#rte-clear').click();
      assert.equal(await page.locator('.rte-tile:visible').count(), PROVIDER_CAPABILITIES.length);
      assert.deepEqual(await page.evaluate(() => (window as unknown as Harness).writes), []);
    } finally { await context.close(); }
  });

  it('localizes every language live, sorts with its collator and preserves focus and filters in RTL', { timeout: 45000 }, async t => {
    const context = await shared.newContext(t);
    try {
      const page = await context.newPage();
      await open(page);
      await page.locator('#rte-filter-buttons [data-capability="heatmap"]').click();
      for (const { locale } of LANGUAGES) {
        await page.evaluate(locale => (window as unknown as Harness).setLanguage(locale), locale);
        assert.equal(await page.locator('#rte-all-label').textContent(), catalogs[locale].rteAllShown.message);
        assert.equal(await page.locator('#rte-filter-buttons [data-capability="heatmap"]').textContent(), `${catalogs[locale].rteCapabilityHeatmap.message} · ${supporting('heatmap').length}`);
        const names = await page.locator('.rte-name').allTextContents();
        assert.deepEqual(names, PROVIDER_CAPABILITIES.map(p => p.name).sort(new Intl.Collator(locale.replace('_', '-')).compare));
        assert.equal(await page.locator('.rte-tile:visible').count(), supporting('heatmap').length);
        assert.equal(await page.locator('#rte-filter-buttons [data-capability="heatmap"]').evaluate(el => el === document.activeElement), true);
        assert.equal(await page.locator('#rte-note-netflix').textContent(), catalogs[locale].rteNoteNetflix.message);
      }
      assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
      await page.setViewportSize({ width: 420, height: 800 });
      assert.equal(await page.locator('#rte-tiles').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    } finally { await context.close(); }
  });

  it('bounds shared sticky headings to their card and restores normal flow below 860px', { timeout: 45000 }, async t => {
    const context = await shared.newContext(t, { viewport: { width: 1280, height: 600 } });
    try {
      const page = await context.newPage();
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
    } finally { await context.close(); }
  });

  it('uses the standard switch, colored badges at rest and dark badges on hover with a larger title on branded tiles', { timeout: 45000 }, async t => {
    const context = await shared.newContext(t);
    try {
      const page = await context.newPage();
      await open(page);
      const slider = (selector: string) => page.locator(`${selector} .toggle-slider`).evaluate(el => getComputedStyle(el).backgroundColor);
      assert.equal(await page.locator('.rte-tile .toggle-switch').count(), PROVIDER_CAPABILITIES.length);
      assert.equal(await page.locator('.rte-tile .toggle-switch input:checked + .toggle-slider').count(), PROVIDER_CAPABILITIES.length);
      const standard = await page.locator('.toggle-switch:not(.rte-tile *)').first().evaluate(el => { const input = el.querySelector('input')!; const checked = input.checked; input.checked = true; const color = getComputedStyle(el.querySelector('.toggle-slider')!).backgroundColor; input.checked = checked; return color; });
      for (const { id } of PROVIDER_CAPABILITIES) {
        assert.equal(await slider(`[data-provider="${id}"]`), standard, `${id}: switch uses the standard accent, not a brand color`);
        assert.equal(await page.locator(`[data-provider="${id}"] .toggle-switch`).evaluate(el => getComputedStyle(el).boxShadow !== 'none'), true, `${id}: dark ring around the switch`);
      }
      const title = await page.locator('.rte-name').first().evaluate(el => ({ size: parseFloat(getComputedStyle(el).fontSize), weight: Number(getComputedStyle(el).fontWeight) }));
      assert.ok(title.size >= 16 && title.size <= 17, `title ${title.size}px`);
      assert.ok(title.weight >= 650 && title.weight <= 700);
      const capabilityColors = await page.locator('#rte-filter-buttons button').evaluateAll(buttons => buttons.map(button => {
        const badge = document.querySelector(`.rte-badge[data-capability="${button.getAttribute('data-capability')}"]`)!;
        return [getComputedStyle(button).color, getComputedStyle(badge).color];
      }));
      for (const [filter, badge] of capabilityColors) assert.equal(filter, badge, 'filter and tile share capability colors');
      assert.equal(new Set(capabilityColors.map(([color]) => color)).size, MEDIA_CAPABILITIES.length);
      const firstBadge = page.locator('.rte-badge:not(.is-matching)').first();
      const rest = await firstBadge.evaluate(el => getComputedStyle(el).backgroundColor);
      await firstBadge.hover();
      assert.notEqual(await firstBadge.evaluate(el => getComputedStyle(el).backgroundColor), rest);
      const badge = await firstBadge.evaluate(el => {
        const context = document.createElement('canvas').getContext('2d')!;
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = getComputedStyle(el).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data];
      });
      // The page black (#09090b) at 70%, never an opaque or neutral grey pill.
      assert.ok(Math.abs(badge[3] - 0.7 * 255) <= 2, `badge alpha ${badge[3]}`);
      assert.ok(badge.slice(0, 3).every((channel, i) => Math.abs(channel - [9, 9, 11][i]) <= 3), `badge color ${badge}`);
      await page.mouse.move(2, 2);
      await page.locator('#rte-all').focus();
      assert.equal(await firstBadge.evaluate(el => getComputedStyle(el).backgroundColor), rest, 'leaving restores the capability color');
      await page.locator('#rte-bilibili').focus();
      assert.equal(await page.locator('[data-provider="bilibili"] .rte-badge').first().evaluate(el => getComputedStyle(el).color), 'rgb(228, 228, 231)', 'keyboard focus uses dark badges too');
      await page.evaluate(() => (window as unknown as Harness).external({ reduceTransparency: 'on', highContrast: 'on' }));
      const high = await firstBadge.evaluate(el => ({ text: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
      assert.equal(high.text, 'rgb(255, 255, 255)');
      assert.equal(high.background, 'rgb(24, 24, 27)');

    } finally { await context.close(); }
  });

  it('aligns badge edges with titles and distinguishes disabled integrations without disabling their controls', { timeout: 45000 }, async t => {
    const context = await shared.newContext(t);
    try {
      const page = await context.newPage();
      await open(page);
      const tile = page.locator('[data-provider="netflix"]');
      const appearance = () => tile.evaluate(el => ({
        border: getComputedStyle(el).borderTopStyle,
        badge: getComputedStyle(el.querySelector('.rte-badge')!).backgroundColor
      }));
      for (const dir of ['ltr', 'rtl']) {
        await page.locator('html').evaluate((el, dir) => el.setAttribute('dir', dir), dir);
        const offset = await tile.evaluate((el, dir) => {
          const title = el.querySelector('.rte-name')!.getBoundingClientRect();
          const badge = el.querySelector('.rte-badge')!.getBoundingClientRect();
          return dir === 'rtl' ? title.right - badge.right : badge.left - title.left;
        }, dir);
        assert.ok(Math.abs(offset) < 1, `${dir}: badge edge aligns with title (${offset}px)`);
      }
      await page.mouse.move(0, 0);
      const enabled = await appearance();
      assert.equal(enabled.border, 'solid');
      // A storage change from the popup or another Settings page must style the same tile.
      await page.evaluate(() => (window as unknown as Harness).external({ netflixIntegrationEnabled: false }));
      const disabled = await appearance();
      assert.equal(disabled.border, 'dashed');
      assert.notEqual(disabled.badge, enabled.badge);
      const toggle = page.locator('#rte-netflix');
      assert.equal(await toggle.isDisabled(), false, 'off is a saved preference, not an unavailable control');
      await tile.locator('.rte-details-toggle').click();
      assert.equal(await tile.locator('.rte-details-toggle').getAttribute('aria-expanded'), 'true');
      await toggle.focus();
      await toggle.press('Space');
      assert.equal(await toggle.isChecked(), true);
      await page.mouse.move(0, 0);
      await page.locator('#rte-all').focus();
      assert.deepEqual(await appearance(), enabled, 'enabling restores the original visual state');
    } finally { await context.close(); }
  });

  it('distinguishes notes and keeps contrast over every brightest hover stop in appearance modes', { timeout: 45000 }, async t => {
    const context = await shared.newContext(t);
    try {
      const page = await context.newPage();
      await open(page);
      const veil = Number(/--te-veil:\s*(\d+)%/.exec(css)![1]) / 100;
      const contrast = (a: number[], b: number[]) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
      for (const mode of [{}, { reduceMotion: 'on' }, { reduceTransparency: 'on' }, { highContrast: 'on' }]) {
        await page.evaluate(mode => (window as unknown as Harness).external({ reduceMotion: 'off', reduceTransparency: 'off', highContrast: 'off', ...mode }), mode);
        for (const enabled of [true, false]) {
          await page.locator('.rte-tile input').evaluateAll((inputs, checked) => inputs.forEach(input => { (input as HTMLInputElement).checked = checked; }), enabled);
          for (const hovered of [false, true]) {
            const provider = PROVIDER_CAPABILITIES[0];
            const tile = page.locator(`[data-provider="${provider.id}"]`);
            await page.mouse.move(0, 0);
            if (hovered) await tile.hover();
            const colors = await tile.evaluate(el => {
              const rgb = (element: Element) => {
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d')!;
                context.fillStyle = getComputedStyle(element).color;
                context.fillRect(0, 0, 1, 1);
                return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
              };
              return { note: rgb(el.querySelector('.rte-note')!), title: rgb(el.querySelector('.rte-name')!), badges: Array.from(el.querySelectorAll('.rte-badge')).map(rgb) };
            });
            assert.notDeepEqual(colors.note, colors.title, provider.id + ': note differs from title');
            for (const badge of colors.badges) assert.notDeepEqual(colors.note, badge, provider.id + ': note differs from badges');
            const base = hexRgb('#09090b');
            // Full-strength decoration bounds disabled tiles too; high contrast removes it.
            for (const palette of PROVIDER_CAPABILITIES) {
              const surface = hovered && !('highContrast' in mode) ? over(base, veil, brightestStop(palette.brandColors)) : base;
              assert.ok(contrast(colors.note, surface) >= 4.5, palette.id + ': note contrast');
            }
          }
        }
      }
    } finally { await context.close(); }
  });

  it('rests as a standard row, colors on hover and focus, and orbits one shared gradient', { timeout: 45000 }, async t => {
    const context = await shared.newContext(t);
    try {
      const page = await context.newPage();
      await open(page);
      const netflix = page.locator('[data-provider="netflix"]');
      const settle = () => netflix.evaluate(async el => { await Promise.all(el.getAnimations({ subtree: true }).filter(animation => animation instanceof CSSTransition).map(animation => animation.finished)); });
      const motion = () => netflix.evaluate(el => {
        const layer = getComputedStyle(el, '::before');
        const running = el.getAnimations({ subtree: true }).filter(animation => animation.effect instanceof KeyframeEffect && animation.effect.pseudoElement === '::before');
        return {
          opacity: layer.opacity,
          orbit: layer.animationName,
          playState: layer.animationPlayState,
          boosting: running.some(animation => animation instanceof CSSTransition && animation.transitionProperty === '--te-border-boost' && animation.playState === 'running'),
          settled: layer.getPropertyValue('--te-border-boost').trim()
        };
      });
      const surface = (selector = '[data-provider="netflix"]') => page.locator(selector).evaluate(el => ({ background: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderTopColor }));
      const row = await page.evaluate(() => { const probe = document.createElement('div'); probe.style.cssText = 'color: var(--border-color); background: var(--bg-color)'; document.body.append(probe); const style = getComputedStyle(probe); const result = { background: style.backgroundColor, border: style.color }; probe.remove(); return result; });
      for (const { id } of PROVIDER_CAPABILITIES) assert.deepEqual(await surface(`[data-provider="${id}"]`), row, `${id}: rest is the standard row, no brand color`);
      assert.deepEqual({ ...await motion(), boosting: undefined }, { opacity: '0', orbit: 'te-border-orbit', playState: 'paused', boosting: undefined, settled: '0deg' }, 'idle: colors hidden, nothing moving');
      // One registered angle turns the one gradient layer that is both the ring and the interior.
      const layers = await netflix.evaluate(el => {
        const style = getComputedStyle(el, '::before');
        return { image: style.backgroundImage, borderWidth: style.borderTopWidth, borderColor: style.borderTopColor, pointer: style.pointerEvents, origin: style.backgroundOrigin, clip: style.backgroundClip };
      });
      assert.match(layers.image, /^linear-gradient\(.*\), conic-gradient\(/, 'a darkening layer over the conic gradient');
      assert.equal(layers.origin, 'padding-box, border-box');
      assert.equal(layers.clip, 'padding-box, border-box');
      assert.equal(layers.borderWidth, '2px');
      assert.equal(layers.borderColor, 'rgba(0, 0, 0, 0)');
      assert.equal(layers.pointer, 'none');
      assert.equal(await netflix.evaluate(el => getComputedStyle(el).getPropertyValue('--te-veil').trim()), '88%', 'the veil the contrast test bounds');
      await netflix.hover();
      const boosted = await motion();
      assert.equal(boosted.playState, 'running', 'hover starts the orbit');
      assert.equal(boosted.boosting, true, 'hover boosts first');
      assert.equal(await netflix.evaluate(el => getComputedStyle(el, '::before').transitionDuration.split(', ')[0]), '0.35s', 'a soft fade in');
      await settle();
      const angle = () => netflix.evaluate(el => new Promise<string>(resolve => requestAnimationFrame(() => resolve(getComputedStyle(el, '::before').getPropertyValue('--te-border-angle')))));
      const first = await angle();
      await page.waitForFunction(first => {
        const tile = document.querySelector('[data-provider="netflix"]')!;
        return getComputedStyle(tile, '::before').getPropertyValue('--te-border-angle') !== first;
      }, first);
      assert.match(first, /deg$/, 'the angle is a registered <angle>');
      assert.notEqual(await angle(), first, 'the shared angle is animating');
      const steady = await motion();
      assert.deepEqual({ opacity: steady.opacity, playState: steady.playState, boosting: steady.boosting, settled: steady.settled }, { opacity: '1', playState: 'running', boosting: false, settled: '360deg' }, 'dwell: only the calmer steady orbit remains');
      assert.deepEqual(await surface(), row, 'the tile itself stays neutral under the colored layer');
      await page.mouse.move(2, 2);
      await settle();
      const rested = await motion();
      assert.deepEqual({ opacity: rested.opacity, playState: rested.playState, settled: rested.settled }, { opacity: '0', playState: 'paused', settled: '0deg' }, 'leaving fades back to neutral before rewinding');
      await page.locator('#rte-youtube').focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      const focused = await page.locator('[data-provider="youtube"]').evaluate(el => getComputedStyle(el, '::before').animationPlayState);
      assert.equal(focused, 'running', 'keyboard focus colors and orbits like hover');
      await page.locator('#rte-all').focus();
      await page.evaluate(() => { document.documentElement.dataset.motion = 'reduced'; });
      await netflix.hover();
      const still = await motion();
      assert.equal(still.opacity, '1', 'reduced motion: hover still shows the static colored ring and interior');
      assert.equal(await netflix.evaluate(el => getComputedStyle(el, '::before').animationName), 'none');
      // Reduced motion collapses durations instead of removing transitions, so the hover's own
      // badge/colour transitions end within a frame; wait for that settled state.
      await netflix.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => undefined))));
      assert.equal(await netflix.evaluate(el => el.getAnimations({ subtree: true }).length), 0);
    } finally { await context.close(); }
  });

  it('keeps the Clear filter button compact, unbolded, unwrapped and below a wrapping heading', { timeout: 60000 }, async t => {
    const context = await shared.newContext(t, { viewport: { width: 1280, height: 900 } });
    try {
      const page = await context.newPage();
      await open(page);
      const clear = page.getByRole('button', { name: 'Clear filter' });
      assert.equal(await clear.isVisible(), false);
      await page.locator('#rte-filter-buttons [data-capability="chapters"]').click();
      assert.equal(await clear.isVisible(), true);
      assert.equal(await clear.getAttribute('class'), 'secondary-btn');
      assert.equal(await page.locator('#rte-filter-buttons #rte-clear').count(), 0, 'not another chip in the row');
      const style = await clear.evaluate(el => ({ weight: Number(getComputedStyle(el).fontWeight), wrap: getComputedStyle(el).whiteSpace, height: el.getBoundingClientRect().height }));
      assert.ok(style.weight < 600, `weight ${style.weight}`);
      assert.equal(style.wrap, 'nowrap');
      assert.ok(style.height <= 30);
      for (const locale of ['pl', 'de', 'fr', 'ru', 'es', 'pt_BR', 'ja', 'ko', 'zh_CN', 'ar']) {
        await page.evaluate(locale => (window as unknown as Harness).setLanguage(locale), locale);
        const name = catalogs[locale].rteClear.message;
        const button = page.getByRole('button', { name });
        assert.equal(await button.count(), 1, `${locale}: accessible name`);
        const heading = (await page.locator('#rte-filter-label').boundingBox())!;
        const box = (await button.boundingBox())!;
        const lines = await button.evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size; });
        assert.equal(lines, 1, `${locale}: label stays on one line`);
        assert.ok(box.height <= 30, `${locale}: ${box.height}`);
        const sideBySide = Math.abs(heading.y + heading.height / 2 - (box.y + box.height / 2)) < 3 && box.x !== heading.x;
        assert.ok(sideBySide || box.y >= heading.y + heading.height, `${locale}: beside the heading or wholly below it`);
        const chips = (await page.locator('#rte-filter-buttons').boundingBox())!;
        assert.ok(box.y + box.height <= chips.y, `${locale}: above the chips`);
      }
      await page.evaluate(() => (window as unknown as Harness).setLanguage('en'));
      await clear.focus();
      await page.keyboard.press('Enter');
      assert.equal(await clear.isVisible(), false);
      assert.equal(await page.locator('#rte-shown').getAttribute('role'), 'status');
    } finally { await context.close(); }
  });

  it('lays out the shown count and master, animates details and respects resolved motion', { timeout: 45000 }, async t => {
    const context = await shared.newContext(t, { viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await open(page);
    assert.equal(await page.locator('#rte-count').count(), 0);
    for (const locale of ['en', 'pl', 'de', 'ar']) {
      await page.evaluate(locale => (window as unknown as Harness).setLanguage(locale), locale);
      const count = (await page.locator('#rte-shown').boundingBox())!;
      const master = (await page.locator('.rte-master').boundingBox())!;
      const checkbox = (await page.locator('#rte-all').boundingBox())!;
      const label = (await page.locator('#rte-all-label').boundingBox())!;
      assert.ok(Math.abs(count.y + count.height / 2 - master.y - master.height / 2) < 2);
      if (locale === 'ar') { assert.ok(count.x > master.x); assert.ok(checkbox.x < label.x); }
      else { assert.ok(count.x < master.x); assert.ok(checkbox.x > label.x); }
    }
    await page.evaluate(() => (window as unknown as Harness).setLanguage('en'));
    const tile = page.locator('[data-provider="bilibili"]');
    const button = tile.locator('.rte-details-toggle');
    const region = tile.locator('.rte-details-region');
    const height = () => tile.evaluate(el => el.getBoundingClientRect().height);
    const settle = () => region.evaluate(async el => { await Promise.all(el.getAnimations().map(animation => animation.finished)); });
    // Dispatch and inspect in one task: a slow transport can outlast the
    // entire transition between click() returning and a later evaluation.
    const toggleDetails = () => button.evaluate((button: HTMLButtonElement) => {
      const region = button.closest('.rte-tile')!.querySelector('.rte-details-region')!;
      getComputedStyle(region).gridTemplateRows;
      button.click();
      return region.getAnimations().map(animation => animation instanceof CSSTransition ? animation.transitionProperty : 'animation');
    });
    assert.equal(await button.evaluate(el => getComputedStyle(el).textDecorationLine), 'none');
    const collapsed = await height();
    assert.ok((await toggleDetails()).includes('grid-template-rows'));
    await settle();
    assert.ok(await height() > collapsed + 20);
    await button.click();
    await settle();
    assert.ok(Math.abs(await height() - collapsed) < 1);
    assert.equal(await tile.locator('.rte-details').getAttribute('aria-hidden'), 'true');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.documentElement.dataset.motion === 'reduced');
    assert.deepEqual(await toggleDetails(), []);
    assert.ok(await height() > collapsed + 20);
    await page.evaluate(() => (window as unknown as Harness).external({ reduceMotion: 'off' }));
    assert.equal(await page.locator('html').getAttribute('data-motion'), 'normal', 'explicit Off overrides the system through the shared resolver');
    await button.click();
    await settle();
    await page.evaluate(() => (window as unknown as Harness).external({ reduceMotion: 'on' }));
    assert.deepEqual(await toggleDetails(), []);
  });

  it('announces an empty result and disables its master for a catalog without a matching service', { timeout: 45000 }, async t => {
    const context = await shared.newContext(t);
    try {
      const page = await context.newPage();
      await open(page, true);
      await page.locator('#rte-filter-buttons [data-capability="heatmap"]').click();
      assert.equal(await page.locator('.rte-tile:visible').count(), 0);
      assert.equal(await page.locator('#rte-empty').isVisible(), true);
      assert.equal(await page.locator('#rte-all').isDisabled(), true);
      assert.equal(await page.locator('#rte-shown').textContent(), '0 of 1 services shown');
      assert.deepEqual(await page.evaluate(() => (window as unknown as Harness).writes), []);
    } finally { await context.close(); }
  });
});
