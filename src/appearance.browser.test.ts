import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { ACCENT_COLOR_OPTIONS } from './accentTheme';
import { contrastRatio } from './contrast';
import { bundleModules } from './test-utils/player-boot';
import { readStylesheet } from './test-utils/styles';
import { sharedTestBrowser } from './test-utils/test-browser';
import { selectTestEngines } from './test-utils/test-engines';
const bundle = bundleModules([`
  import { observeAppearance, observeDocumentAppearance, applyAppearanceModes } from './appearance-runtime';
  import { applyAccentColorPreset } from './accentTheme';
  import { setupRteSettings } from '../options/rte-settings';
  import { setupAppearanceChoices } from '../options/appearance-choices';
  import { getPlayerUiRoot, destroyPlayerUi, setPlayerUiCss } from './ui/root';
  window.startDocument = observeDocumentAppearance;
  window.palette = (preset, high, reduced) => {
    for (const target of [document.documentElement, document.getElementById('theater-everywhere-ui')]) {
      applyAccentColorPreset(target, preset);
      applyAppearanceModes(target, { contrast: high, transparency: reduced, motion: false });
    }
  };
  window.start = async (css) => {
    window.stopAppearance = observeAppearance(document.documentElement);
    window.stopChoices = document.getElementById('highContrast-combobox') ? setupAppearanceChoices() : () => {};
    setPlayerUiCss(css);
    const root = getPlayerUiRoot();
    root.innerHTML += '<div class="theater-controls-wrapper visible"><button>Play</button><div class="theater-settings-menu"><span class="theater-settings-label">Player settings</span></div></div>';
    root.innerHTML += '<div class="theater-everywhere-caption-hud" style="--theater-caption-color:#010203">Caption feedback</div><div class="theater-service-action-progress"></div><div class="theater-caption-overlay-text" style="--theater-caption-color:rgb(250,217,0);--theater-caption-bg:rgba(1,2,3,0.4)">Captions</div>';
    if (document.getElementById('rte-tiles')) window.stopRte = await setupRteSettings(async () => {});
    window.destroyPlayer = destroyPlayerUi;
  };`]);
const optionsCss = readStylesheet('options/options.css');
const shadowCss = readStylesheet('src/ui/shadow.css');
const popupCss = readStylesheet('popup/popup.css');
const browsers = { chromium: sharedTestBrowser(chromium), firefox: sharedTestBrowser(firefox) };
const popupHtml = readFileSync('popup/popup.html', 'utf8').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]+>/g, '');
const optionsHtml = readFileSync('options/options.html', 'utf8').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]+>/g, '');

async function choose(page: Page, key: 'highContrast' | 'reduceTransparency', value: 'auto' | 'on' | 'off'): Promise<void> {
  await page.locator(`#${key}-combobox`).click();
  await page.locator(`#${key}-combobox-listbox [data-value=${value}]`).click();
}

function hexColor(css: string): string {
  const values = css.match(/[\d.]+/g)?.map(Number);
  assert.ok(values && (values.length === 3 || (values.length === 4 && values[3] === 1)), `Expected opaque computed sRGB: ${css}`);
  return '#' + values.slice(0, 3).map(value => Math.round(value * (css.startsWith('color(srgb') ? 255 : 1)).toString(16).padStart(2, '0')).join('');
}

for (const engine of selectTestEngines([chromium, firefox], engine => engine.name())) it(`${engine.name()}: appearance across Settings, popup root and player; live storage, system and cleanup`, { timeout: 40000 }, async t => {
  const context = await browsers[engine.name() as 'chromium' | 'firefox'].newContext(t);
  const pages = [await context.newPage(), await context.newPage(), await context.newPage()];
  const storage: Record<string, unknown> = {};
  await context.exposeBinding('savePreferences', async (_source, update: Record<string, unknown>) => {
    Object.assign(storage, update);
    await Promise.all(pages.map(page => page.evaluate(update => {
      const changes = Object.fromEntries(Object.entries(update).map(([key, newValue]) => [key, { newValue }]));
      (window as unknown as { emitStorage(changes: object): void }).emitStorage(changes);
    }, update)));
  });
  for (const page of pages) {
    await page.setContent(page === pages[2] ? popupHtml : optionsHtml);
    await page.addStyleTag({ content: page === pages[2] ? popupCss : optionsCss });
    await page.evaluate(`(() => {
      window.__name = fn => fn;
      const listeners = new Set();
      const tracked = new Set();
      const original = window.matchMedia.bind(window);
      window.matchMedia = query => {
        const mql = original(query), add = mql.addEventListener.bind(mql), remove = mql.removeEventListener.bind(mql);
        mql.addEventListener = (type, fn) => { tracked.add(fn); add(type, fn); };
        mql.removeEventListener = (type, fn) => { tracked.delete(fn); remove(type, fn); };
        return mql;
      };
      window.listenerCount = () => tracked.size;
      window.emitStorage = changes => listeners.forEach(fn => fn(changes, 'sync'));
      window.chrome = { runtime: {}, i18n: {getMessage: () => ''}, storage: {
        sync: { get: (_keys, callback) => { callback?.({}); return Promise.resolve({}); }, set: update => window.savePreferences(update) },
        onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) }
      }};
    })()`);
    if (page === pages[0] && engine === firefox) await page.emulateMedia({ contrast: 'more' });
    await page.addScriptTag({ content: bundle });
    await page.evaluate(css => (window as unknown as { start(css: string): void }).start(css), shadowCss);
  }
  const [settings, secondSettings, popup] = pages;
  assert.equal(await settings.locator('#highContrast-combobox').textContent(), 'Auto');
  await settings.emulateMedia({ contrast: 'more' });
  const contrastEmulated = await settings.evaluate(() => matchMedia('(prefers-contrast: more)').matches);
  if (!contrastEmulated) await choose(settings, 'highContrast', 'on');
  await settings.waitForFunction(() => document.documentElement.dataset.contrast === 'high');
  assert.equal(await settings.locator('#theater-everywhere-ui').getAttribute('data-contrast'), 'high');
  const contrastMenu = settings.locator('#highContrast-combobox');
  await contrastMenu.press('Enter');
  await contrastMenu.press('End');
  assert.equal(await contrastMenu.textContent(), contrastEmulated ? 'Auto' : 'On', 'browsing does not save');
  await contrastMenu.press('Escape');
  await contrastMenu.press('Enter');
  await contrastMenu.press('End');
  await contrastMenu.press('Enter'); // Commit Off through the same persistence path as pointer selection.
  for (const page of pages) await page.waitForFunction(() => document.documentElement.dataset.contrast === 'normal');
  await choose(settings, 'highContrast', 'on');
  for (const page of pages) await page.waitForFunction(() => document.documentElement.dataset.contrast === 'high');
  assert.equal(await secondSettings.locator('#highContrast-combobox-listbox [data-value=on]').getAttribute('aria-selected'), 'true');
  assert.equal(await popup.locator('.status-card').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(24, 24, 27)');
  assert.equal(await popup.locator('body').evaluate(el => getComputedStyle(el).color), 'rgb(255, 255, 255)');
  assert.equal(await settings.locator('body').evaluate(el => getComputedStyle(el).color), 'rgb(255, 255, 255)');
  assert.equal(await settings.locator('.theater-controls-wrapper').evaluate(el => getComputedStyle(el, '::before').backgroundColor), 'rgb(24, 24, 27)');
  // Playwright has no reducedTransparency option; Chromium exposes the feature through CDP.
  if (engine === chromium) {
    const cdp = await context.newCDPSession(settings);
    await cdp.send('Emulation.setEmulatedMedia', { features: [
      { name: 'prefers-contrast', value: 'more' },
      { name: 'prefers-reduced-transparency', value: 'reduce' }
    ] });
    await settings.waitForFunction(() => document.documentElement.dataset.transparency === 'reduced');
    await choose(settings, 'reduceTransparency', 'off');
    await settings.waitForFunction(() => document.documentElement.dataset.transparency === 'normal');
    await choose(settings, 'reduceTransparency', 'auto');
    await settings.waitForFunction(() => document.documentElement.dataset.transparency === 'reduced');
  }
  // The explicit override covers engines without media-feature emulation.
  await choose(settings, 'reduceTransparency', 'on');
  for (const page of pages) await page.waitForFunction(() => document.documentElement.dataset.transparency === 'reduced');
  assert.equal(await settings.locator('.theater-settings-menu').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(24, 24, 27)');
  await choose(settings, 'highContrast', 'off');
  assert.equal(await settings.locator('.theater-controls-wrapper').evaluate(el => getComputedStyle(el, '::before').backgroundColor), 'rgb(24, 24, 27)');
  assert.equal(await settings.locator('.theater-caption-overlay-text').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(1, 2, 3, 0.4)');
  assert.equal(await settings.locator('.theater-caption-overlay-text').evaluate(el => getComputedStyle(el).color), 'rgb(250, 217, 0)');
  // Exercise the cascade, not a second copy of the palette: every preset in all four modes.
  const ratios: Array<Record<string, string | number | boolean>> = [];
  for (const high of [false, true]) for (const reduced of [false, true]) {
    for (const { preset } of ACCENT_COLOR_OPTIONS) {
      await settings.evaluate(({ preset, high, reduced }) => {
        (window as unknown as { palette(preset: string, high: boolean, reduced: boolean): void }).palette(preset, high, reduced);
      }, { preset, high, reduced });
      const colors = await settings.evaluate(() => {
        const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
        const probe = document.createElement('span');
        document.body.append(probe);
        const tokenColor = (name: string) => {
          probe.style.color = `var(${name})`;
          return getComputedStyle(probe).color;
        };
        const colors = {
          text: style('body').color, background: style('body').backgroundColor,
          panel: style('.main-card').backgroundColor, secondary: style('.section-desc').color,
          selectedText: style('#highContrast-combobox-listbox [aria-selected=true]').color,
          selected: style('#highContrast-combobox-listbox [aria-selected=true]').backgroundColor,
          accent: tokenColor('--accent-color'), foreground: tokenColor('--accent-text'), hover: tokenColor('--accent-hover'),
          border: tokenColor('--border-color'),
          ring: getComputedStyle(document.querySelector('.te-animated-border')!, '::before').content,
          ringAnimation: getComputedStyle(document.querySelector('.te-animated-border')!, '::before').animationName,
          notification: getComputedStyle(document.querySelector('#theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-everywhere-caption-hud')!).color,
          progress: getComputedStyle(document.querySelector('#theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-service-action-progress')!).backgroundColor,
          player: getComputedStyle(document.querySelector('#theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-controls-wrapper')!, '::before').backgroundColor
        };
        probe.remove();
        return colors;
      });
      const ratio = (fg: string, bg: string) => contrastRatio(hexColor(fg), hexColor(bg));
      const label = `${preset}, high=${high}, reduced=${reduced}`;
      assert.ok(ratio(colors.text, colors.background) >= 7, `${label} main text`);
      assert.ok(ratio(colors.secondary, colors.panel) >= 4.5, `${label} secondary text`);
      assert.ok(ratio(colors.selectedText, colors.selected) >= 4.5, `${label} selected text`);
      // Native system colors remain browser-owned in normal mode; high contrast always uses the checked fallback.
      if (high || preset !== 'system') {
        assert.ok(ratio(colors.foreground, colors.accent) >= 4.5, `${label} filled text`);
        assert.ok(ratio(colors.foreground, colors.hover) >= 4.5, `${label} hovered filled text`);
      }
      assert.ok(ratio(colors.accent, colors.panel) >= (high ? 7 : 3), `${label} accent indicator`);
      if (high) {
        assert.ok(ratio(colors.notification, colors.panel) >= 7, `${label} caption feedback stays readable independently of caption color`);
        assert.ok(ratio(colors.border, colors.panel) >= 3, `${label} boundary`);
        assert.ok(ratio(colors.progress, colors.panel) >= 3, `${label} countdown progress`);
        assert.ok(ratio(colors.text, colors.progress) >= 4.5, `${label} text over countdown progress`);
      }
      // Reduce transparency alone keeps the ring and its interior (motion has its own setting).
      if (high) {
        assert.equal(colors.ring, 'none', `${label} RTE ring and gradient interior`);
        assert.equal(colors.ringAnimation, 'none', `${label} RTE decoration stops animating`);
      } else assert.notEqual(colors.ring, 'none', `${label} keeps the RTE ring`);
      if (high || reduced) {
        hexColor(colors.player); // Opaque independently of the underlying video.
      }
      ratios.push({ preset, high, reduced, text: ratio(colors.text, colors.background), secondary: ratio(colors.secondary, colors.panel),
        accent: hexColor(colors.accent), foreground: hexColor(colors.foreground), filled: ratio(colors.foreground, colors.accent),
        hover: ratio(colors.foreground, colors.hover), indicator: ratio(colors.accent, colors.panel), border: ratio(colors.border, colors.panel) });
    }
  }
  if (engine === chromium && process.env.THEATER_APPEARANCE_RATIOS) writeFileSync(process.env.THEATER_APPEARANCE_RATIOS, JSON.stringify(ratios, null, 2));
  await choose(settings, 'highContrast', 'on');
  const selectedChoice = settings.locator('#highContrast-combobox');
  await selectedChoice.focus();
  await selectedChoice.press('Tab');
  await settings.keyboard.press('Shift+Tab');
  assert.equal(await selectedChoice.evaluate(el => getComputedStyle(el).outlineWidth), '3px', 'focus remains distinct on a selected choice');
  await selectedChoice.press('Enter');
  assert.equal(await settings.locator('#highContrast-combobox-listbox [aria-selected=true]').evaluate(el => getComputedStyle(el).textDecorationLine), 'underline', 'selection is visible beyond its color');
  await selectedChoice.press('Escape');
  await settings.setViewportSize({ width: 390, height: 844 });
  for (const dir of ['ltr', 'rtl']) {
    await settings.locator('html').evaluate((el, dir) => el.setAttribute('dir', dir), dir);
    for (const key of ['highContrast', 'reduceTransparency']) {
      const menu = settings.locator(`#${key}-combobox`);
      await menu.scrollIntoViewIfNeeded();
      const bounds = await menu.evaluate(el => {
        const row = el.parentElement!.getBoundingClientRect(), control = el.getBoundingClientRect();
        const info = el.parentElement!.querySelector('.options-info')!.getBoundingClientRect();
        return { contained: control.left >= row.left && control.right <= row.right, below: control.top >= info.bottom };
      });
      assert.deepEqual(bounds, { contained: true, below: true }, `${key}: narrow ${dir} row keeps the dropdown below its description`);
      await menu.click();
      const popupBounds = await settings.locator(`#${key}-combobox-listbox`).evaluate(el => {
        const rect = el.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth;
      });
      assert.equal(popupBounds, true, `${key}: narrow ${dir} dropdown stays in viewport`);
      await menu.press('Escape');
    }
  }
  await settings.emulateMedia({ forcedColors: 'active' });
  assert.equal(await settings.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--appearance-ink')), '', 'forced colors retains browser ownership');
  await settings.emulateMedia({ forcedColors: 'none' });
  await settings.evaluate(`window.stopRte(); window.stopChoices(); window.stopChoices(); window.stopAppearance(); window.destroyPlayer(); window.destroyPlayer();`);
  assert.equal(await settings.locator('#highContrast-combobox-listbox, #reduceTransparency-combobox-listbox').count(), 0, 'cleanup removes dropdown portals');
  assert.equal(await settings.evaluate('window.listenerCount()'), 0);
  await settings.emulateMedia({ contrast: 'no-preference' });
  assert.equal(await settings.locator('html').getAttribute('data-contrast'), null);
  assert.equal(await settings.locator('#theater-everywhere-ui').count(), 0);
  await settings.evaluate(`window.startDocument(); window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));`);
  assert.equal(await settings.locator('html').getAttribute('data-contrast'), null);
  assert.equal(await settings.evaluate('window.listenerCount()'), 0);
  await settings.evaluate(`window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));`);
  assert.equal(await settings.locator('html').getAttribute('data-contrast'), 'normal');
  await settings.evaluate(`window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));`);
  assert.equal(await settings.evaluate('window.listenerCount()'), 0);
});
