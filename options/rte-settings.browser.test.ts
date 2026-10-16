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
const css = buildSync({ entryPoints: [new URL('./options.css', import.meta.url).pathname], bundle: true, write: false }).outputFiles[0].text;
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

  it('advertises only registered playlist navigation and localizes its filter and badges', { timeout: 45000 }, async t => {
    const browser = await engine.launch({ headless: true });
    ownTestBrowser(t, browser);
    try {
      const page = await browser.newPage();
      await open(page);
      const supported = ['bilibili', 'bilibiliIntl', 'disney', 'netflix', 'tencent', 'vimeo', 'youtube'];
      assert.deepEqual((await page.locator('.rte-tile:has(.rte-badge[data-capability="playlists"])').evaluateAll(tiles => tiles.map(tile => tile.getAttribute('data-provider')))).sort(), supported);
      const filter = page.locator('#rte-filter-buttons [data-capability="playlists"]');
      await filter.click();
      for (const { locale } of LANGUAGES) {
        await page.evaluate(locale => (window as unknown as Harness).setLanguage(locale), locale);
        assert.equal(await filter.textContent(), `${catalogs[locale].rteCapabilityPlaylists.message} · 7`);
        assert.deepEqual((await page.locator('.rte-tile:visible').evaluateAll(tiles => tiles.map(tile => tile.getAttribute('data-provider')))).sort(), supported);
        assert.ok((await page.locator('.rte-badge[data-capability="playlists"]').allTextContents()).every(text => text === catalogs[locale].rteCapabilityPlaylists.message));
      }
      await page.locator('#rte-filter-buttons [data-capability="chapters"]').click();
      assert.equal(await page.locator('.rte-tile:visible').count(), 4);
      await page.locator('#rte-clear').click();
      assert.equal(await page.locator('.rte-tile:visible').count(), 10);
      assert.deepEqual(await page.evaluate(() => (window as unknown as Harness).writes), []);
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

  it('uses the standard switch, dark-glass badges and a larger title on branded tiles', { timeout: 45000 }, async t => {
    const browser = await engine.launch({ headless: true });
    ownTestBrowser(t, browser);
    try {
      const page = await browser.newPage();
      await open(page);
      const slider = (selector: string) => page.locator(`${selector} .toggle-slider`).evaluate(el => getComputedStyle(el).backgroundColor);
      assert.equal(await page.locator('.rte-tile .toggle-switch').count(), 10);
      assert.equal(await page.locator('.rte-tile .toggle-switch input:checked + .toggle-slider').count(), 10);
      const standard = await page.locator('.toggle-switch:not(.rte-tile *)').first().evaluate(el => { const input = el.querySelector('input')!; const checked = input.checked; input.checked = true; const color = getComputedStyle(el.querySelector('.toggle-slider')!).backgroundColor; input.checked = checked; return color; });
      for (const { id } of PROVIDER_CAPABILITIES) {
        assert.equal(await slider(`[data-provider="${id}"]`), standard, `${id}: switch uses the standard accent, not a brand color`);
        assert.equal(await page.locator(`[data-provider="${id}"] .toggle-switch`).evaluate(el => getComputedStyle(el).boxShadow !== 'none'), true, `${id}: dark ring around the switch`);
      }
      const title = await page.locator('.rte-name').first().evaluate(el => ({ size: parseFloat(getComputedStyle(el).fontSize), weight: Number(getComputedStyle(el).fontWeight) }));
      assert.ok(title.size >= 16 && title.size <= 17, `title ${title.size}px`);
      assert.ok(title.weight >= 650 && title.weight <= 700);
      const badge = await page.locator('.rte-badge:not(.is-matching)').first().evaluate(el => {
        const context = document.createElement('canvas').getContext('2d')!;
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = getComputedStyle(el).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data];
      });
      // The page black (#09090b) at 70%, never an opaque or neutral grey pill.
      assert.ok(Math.abs(badge[3] - 0.7 * 255) <= 2, `badge alpha ${badge[3]}`);
      assert.ok(badge.slice(0, 3).every((channel, i) => Math.abs(channel - [9, 9, 11][i]) <= 3), `badge color ${badge}`);
    } finally { await browser.close(); }
  });

  it('rests as a standard row, colors on hover and focus, and orbits one shared gradient', { timeout: 45000 }, async t => {
    const browser = await engine.launch({ headless: true });
    ownTestBrowser(t, browser);
    try {
      const page = await browser.newPage();
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
      assert.equal(await netflix.evaluate(el => getComputedStyle(el).getPropertyValue('--te-veil').trim()), '78%', 'the veil the contrast test bounds');
      await netflix.hover();
      const boosted = await motion();
      assert.equal(boosted.playState, 'running', 'hover starts the orbit');
      assert.equal(boosted.boosting, true, 'hover boosts first');
      assert.equal(await netflix.evaluate(el => getComputedStyle(el, '::before').transitionDuration.split(', ')[0]), '0.35s', 'a soft fade in');
      await settle();
      const angle = () => netflix.evaluate(el => new Promise<string>(resolve => requestAnimationFrame(() => resolve(getComputedStyle(el, '::before').getPropertyValue('--te-border-angle')))));
      const first = await angle();
      await page.waitForTimeout(300);
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
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await netflix.hover();
      const still = await motion();
      assert.equal(still.opacity, '1', 'reduced motion: hover still shows the static colored ring and interior');
      assert.equal(await netflix.evaluate(el => getComputedStyle(el, '::before').animationName), 'none');
      assert.equal(await netflix.evaluate(el => el.getAnimations({ subtree: true }).length), 0);
    } finally { await browser.close(); }
  });

  it('keeps the Clear filter button compact, unbolded, unwrapped and below a wrapping heading', { timeout: 60000 }, async t => {
    const browser = await engine.launch({ headless: true });
    ownTestBrowser(t, browser);
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
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
