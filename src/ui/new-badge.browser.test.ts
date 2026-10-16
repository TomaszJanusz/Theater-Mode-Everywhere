import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { buildSync } from 'esbuild';
import { chromium, firefox, type Page } from 'playwright';
import { ownTestBrowser } from '../test-utils/test-browser';
import { readStylesheet } from '../test-utils/styles';
import { CURRENT_GENERATION, CURRENT_VERSION, PREVIOUS_GENERATION } from '../test-utils/release';

const bundle = buildSync({
  stdin: { contents: `
    export * from './src/ui/new-badge';
    export { NEW_FEATURE_ITEMS, HIGHLIGHTS_WINDOW_STORAGE_KEY, FEATURE_HIGHLIGHTS_MAX_AGE_MS } from './src/feature-highlights';
    export { createFeatureHighlightsLifecycle } from './src/feature-highlights-lifecycle';
    export { setupFeatureHighlights } from './options/feature-highlights';
    export { localizeDocument } from './src/i18n';
    export { languageRuntime } from './src/i18n-runtime';
    export { openWhatsNewDialog, hasUnseenWhatsNew } from './src/whatsNew';
    export { bootstrapPlayerRuntime } from './src/ui/player-runtime';
    export { setPlayerUiCss } from './src/ui/root';`,
  resolveDir: new URL('../../', import.meta.url).pathname, loader: 'ts' },
  bundle: true, write: false, format: 'iife', globalName: 'BadgeTest', target: 'es2022'
}).outputFiles[0].text;
const optionsHtml = readFileSync(new URL('../../options/options.html', import.meta.url), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const optionsCss = readStylesheet(new URL('../../options/options.css', import.meta.url));
const uiCss = readStylesheet(new URL('./shadow.css', import.meta.url));
const contentCss = readStylesheet(new URL('../content.css', import.meta.url));
const media = `data:video/webm;base64,${readFileSync(new URL('../../test/fixtures/vod.webm', import.meta.url)).toString('base64')}`;
const polish = JSON.parse(readFileSync(new URL('../../_locales/pl/messages.json', import.meta.url), 'utf8'));

async function installMock(page: Page, version = CURRENT_VERSION) {
  await page.evaluate('window.__name = value => value');
  await page.evaluate(({ version, polish }) => {
    const listeners = new Set<(changes: object, area: string) => void>();
    const sync: Record<string, unknown> = { keepControlsVisible: true };
    const local: Record<string, unknown> = {};
    function area(name: string, values: Record<string, unknown>) {
      return {
        async get() { return { ...values }; },
        async set(next: Record<string, unknown>) {
          Object.assign(values, next);
          const changes = Object.fromEntries(Object.entries(next).map(([key, newValue]) => [key, { newValue }]));
          for (const listener of listeners) listener(changes, name);
        },
        async remove(keys: string[]) {
          for (const key of keys) delete values[key];
          const changes = Object.fromEntries(keys.map(key => [key, {}]));
          for (const listener of listeners) listener(changes, name);
        }
      };
    }
    Object.assign(window, { chrome: {
      runtime: { getManifest: () => ({ version }), sendMessage: async () => polish, onMessage: { addListener() {} } },
      storage: { sync: area('sync', sync), local: area('local', local),
        onChanged: { addListener: (fn: typeof listeners extends Set<infer T> ? T : never) => listeners.add(fn),
          removeListener: (fn: typeof listeners extends Set<infer T> ? T : never) => listeners.delete(fn) } }
    }, badgeListenerCount: () => listeners.size });
  }, { version, polish });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(`(() => {
    const lifecycle = BadgeTest.createFeatureHighlightsLifecycle(chrome.storage.local, chrome.runtime.getManifest().version, Date.now);
    const send = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = message => message.action === 'feature-highlights'
      ? ({ read: () => lifecycle.read(), acknowledge: () => lifecycle.acknowledge().then(() => ({})),
          hide: () => lifecycle.hideUntilNextVersion().then(() => ({})),
          restore: () => lifecycle.restoreHidden().then(() => ({})) })[message.operation]() : send(message);
  })()`);
}

for (const engine of ['chromium', 'firefox'] as const) {
  it(`${engine}: development Settings restores only newly added items after an acknowledged catalog`, { timeout: 30_000 }, async t => {
    const browser = await ({ chromium, firefox })[engine].launch(); ownTestBrowser(t, browser);
    const page = await browser.newPage();
    await page.setContent(optionsHtml); await page.addStyleTag({ content: optionsCss });
    await installMock(page, '0.26.1016.1512');
    await page.evaluate(`(async () => {
      await chrome.storage.local.set({newFeaturesSeenThrough:'${CURRENT_GENERATION}'});
      window.settingsHighlights = BadgeTest.setupFeatureHighlights(chrome.storage.sync.get());
      await settingsHighlights.ready;
    })()`);
    await page.locator('[data-new-feature=settingsLanguage] .te-new-badge').waitFor({ state: 'attached' });
    await page.evaluate(`void BadgeTest.openWhatsNewDialog()`);
    await page.waitForFunction(() => !document.querySelector('.te-new-badge'));
    await page.locator('.te-dialog-btn-primary').click();
    await page.evaluate(`(async () => {
      settingsHighlights.dispose();
      window.settingsHighlights = BadgeTest.setupFeatureHighlights(chrome.storage.sync.get());
      await settingsHighlights.ready;
    })()`);
    assert.equal(await page.locator('.te-new-badge').count(), 0, 'remount with unchanged items stays acknowledged');
    // A snapshot written before Language joined the same generation, as in a rebuilt extension.
    await page.evaluate(async (since: string) => {
      const local = await chrome.storage.local.get('newFeaturesSeenItems');
      await chrome.storage.local.set({ newFeaturesSeenItems: local.newFeaturesSeenItems.filter((key: string) => key !== `settingsLanguage@${since}`) });
    }, CURRENT_GENERATION);
    await page.locator('[data-new-feature=settingsLanguage] .te-new-badge').waitFor({ state: 'attached' });
    assert.equal(await page.locator('[data-new-feature=settingsHighContrast] .te-new-badge').count(), 0);
    await page.locator('#whats-new-btn.has-unseen').waitFor();
    await browser.close();
  });

  it(`${engine}: expiry hides Settings badges and unseen indication without acknowledging, and live state cannot revive them`, { timeout: 30_000 }, async t => {
    const browser = await ({ chromium, firefox })[engine].launch(); ownTestBrowser(t, browser);
    const page = await browser.newPage();
    await page.setContent(optionsHtml); await installMock(page);
    await page.evaluate(`(async () => {
      window.settingsHighlights = BadgeTest.setupFeatureHighlights(chrome.storage.sync.get());
      await settingsHighlights.ready;
    })()`);
    await page.locator('#whats-new-btn.has-unseen').waitFor();
    assert.equal(await page.evaluate(`BadgeTest.hasUnseenWhatsNew()`), true);
    await page.evaluate(`chrome.storage.local.set({
      [BadgeTest.HIGHLIGHTS_WINDOW_STORAGE_KEY]: { generation: '${CURRENT_GENERATION}', firstShownAt: Date.now() - BadgeTest.FEATURE_HIGHLIGHTS_MAX_AGE_MS }
    })`);
    assert.equal(await page.locator('.te-new-badge').count(), 0);
    assert.equal(await page.locator('#whats-new-btn.has-unseen').count(), 0);
    assert.equal(await page.evaluate(`BadgeTest.hasUnseenWhatsNew()`), false);
    const saved = await page.evaluate(() => chrome.storage.local.get(null));
    assert.equal(saved.newFeaturesSeenThrough, undefined, 'viewing Settings and expiry never acknowledge');
    assert.equal(saved.whatsNewAcknowledgedId, undefined);
    await page.evaluate(() => chrome.storage.sync.set({ highlightNewFeatures: false }));
    await page.evaluate(() => chrome.storage.sync.set({ highlightNewFeatures: true }));
    assert.equal(await page.locator('.te-new-badge').count(), 0);
    await browser.close();
  });

  it(`${engine}: shared badge has accessible text, decorative dot, accent tokens and logical RTL spacing`, { timeout: 30_000 }, async t => {
    const browser = await ({ chromium, firefox })[engine].launch(); ownTestBrowser(t, browser);
    const page = await browser.newPage();
    await page.setContent('<html dir="rtl"><body style="--accent-color:#ff0000;--bg-color:#123456"><button>Language</button><button id="gear" aria-label="Settings" aria-description="New"></button></body></html>');
    await page.addScriptTag({ content: bundle });
    const styles = await page.evaluate<{tag:string;tabindex:number;color:string;margin:string;fontSize:string;animation:string;dotWidth:string;dotBackground:string;dotRing:string;hidden:string;text:string}>(`(() => {
      BadgeTest.defineNewBadge(); BadgeTest.defineNewBadge(); BadgeTest.ensureNewBadgeStyles(document);
      const pill = BadgeTest.createNewBadge(); document.querySelector('button').append(pill);
      const dot = BadgeTest.createNewBadge('dot'); document.getElementById('gear').append(dot);
      const p = getComputedStyle(pill), d = getComputedStyle(dot);
      return { tag: pill.localName, tabindex: pill.tabIndex, color: p.color, margin: p.marginRight,
        fontSize:p.fontSize, animation:p.animationName, dotWidth:d.width, dotBackground:d.backgroundColor,
        dotRing:d.boxShadow, hidden:dot.getAttribute('aria-hidden'), text:dot.textContent };
    })()`);
    assert.equal(styles.tag, 'te-new-badge'); assert.equal(styles.tabindex, -1);
    assert.equal(styles.margin, '8px'); assert.equal(styles.fontSize, '9.5px');
    assert.equal(styles.animation, 'none'); assert.match(styles.color, /1(?:\.0+)?[, ]/);
    assert.equal(styles.dotWidth, '8px'); assert.equal(styles.dotBackground, 'rgb(255, 0, 0)');
    assert.match(styles.dotRing, /18, 52, 86/); assert.equal(styles.hidden, 'true'); assert.equal(styles.text, '');
    assert.equal(await page.getByRole('button', { name: 'Language New', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Settings' }).getAttribute('aria-description'), 'New');
    const fallback = await page.evaluate(`(() => {
      Object.defineProperty(window, 'customElements', { value: undefined, configurable: true });
      BadgeTest.defineNewBadge();
      const pill = BadgeTest.createNewBadge(); document.body.append(pill);
      return { tag: pill.localName, text: pill.textContent, font: getComputedStyle(pill).fontSize };
    })()`);
    assert.deepEqual(fallback, { tag: 'span', text: 'New', font: '9.5px' });
    await browser.close();
  });

  for (const version of [CURRENT_VERSION, '0.26.1016.1512']) {
    it(`${engine} ${version}: fresh install auto-open requires unseen items, independently of announcement acknowledgement`, { timeout: 30_000 }, async t => {
      const browser = await ({ chromium, firefox })[engine].launch(); ownTestBrowser(t, browser);
      const page = await browser.newPage();
      await page.setContent(optionsHtml);
      await installMock(page, version);
      await page.evaluate(`(async () => {
        const lifecycle = BadgeTest.createFeatureHighlightsLifecycle(chrome.storage.local, chrome.runtime.getManifest().version, Date.now);
        await lifecycle.installed({ reason: 'install' }, async () => { throw new Error('Install must not open Settings'); });
      })()`);
      assert.equal(await page.evaluate(`BadgeTest.hasUnseenWhatsNew()`), version !== CURRENT_VERSION,
        'release installs start seen; date-version builds still have unreleased items');
      await page.evaluate(() => chrome.storage.local.set({ newFeaturesSeenThrough: '0.0', newFeaturesSeenItems: [] }));
      assert.equal(await page.evaluate(`BadgeTest.hasUnseenWhatsNew()`), true, 'an unacknowledged update with unseen items auto-opens');
      await page.evaluate(`void BadgeTest.openWhatsNewDialog()`);
      await page.getByRole('dialog', { name: 'Update highlights', exact: true }).waitFor();
      assert.equal(await page.evaluate(`BadgeTest.hasUnseenWhatsNew()`), false, 'opening acknowledges the announcement and items');
      await page.evaluate(() => chrome.storage.local.set({ newFeaturesSeenThrough: '0.0', newFeaturesSeenItems: [] }));
      assert.equal(await page.evaluate(`BadgeTest.hasUnseenWhatsNew()`), false, 'new items alone do not reopen an acknowledged announcement');
      await browser.close();
    });

    it(`${engine} ${version}: Settings badges, acknowledgement, preference and language update live and clean up`, { timeout: 30_000 }, async t => {
      const browser = await ({ chromium, firefox })[engine].launch(); ownTestBrowser(t, browser);
      const page = await browser.newPage();
      await page.setContent(optionsHtml); await page.addStyleTag({ content: optionsCss });
      await installMock(page, version);
      await page.evaluate(`(async () => {
        BadgeTest.localizeDocument();
        BadgeTest.languageRuntime.subscribe(() => BadgeTest.localizeDocument());
        window.settingsHighlights = BadgeTest.setupFeatureHighlights(chrome.storage.sync.get());
        await settingsHighlights.ready;
      })()`);
      assert.equal(await page.getByRole('tab', { name: 'Appearance New', exact: true }).count(), 1);
      assert.equal(await page.getByLabel('Language New', { exact: true }).count(), 1);
      for (const name of ['AutoTheater', 'High contrast', 'Reduce transparency', 'Reduce motion']) {
        assert.equal(await page.getByLabel(`${name} New`, { exact: true }).count(), 1, name);
      }
      assert.equal(await page.locator('#whats-new-btn.has-unseen').count(), 1);
      await page.evaluate(`BadgeTest.languageRuntime.set('pl')`);
      await page.getByRole('tab', { name: 'Wygląd Nowość', exact: true }).waitFor();
      await page.evaluate(`BadgeTest.languageRuntime.set('automatic')`);
      const seenBefore = await page.evaluate(() => chrome.storage.local.get(null));
      await page.locator('label.toggle-switch').filter({ has: page.locator('#highlight-new-features-toggle') }).click();
      await page.waitForFunction(() => !document.querySelector('.te-new-badge'));
      assert.equal(await page.locator('#whats-new-btn.has-unseen').count(), 0);
      assert.deepEqual(await page.evaluate(() => chrome.storage.local.get(null)), seenBefore,
        'hiding badges does not acknowledge either the feature catalog or the announcement');
      await page.locator('label.toggle-switch').filter({ has: page.locator('#highlight-new-features-toggle') }).click();
      await page.getByLabel('Language New', { exact: true }).waitFor();
      await page.locator('#whats-new-btn.has-unseen').waitFor();
      await page.evaluate(`void BadgeTest.openWhatsNewDialog()`);
      await page.getByRole('dialog', { name: 'Update highlights' }).waitFor();
      assert.equal(await page.locator('.te-new-badge').count(), 0, 'opening acknowledges without waiting for dismissal');
      await page.locator('.te-dialog-btn-primary').click();
      await page.locator('label.toggle-switch').filter({ has: page.locator('#highlight-new-features-toggle') }).click();
      await page.waitForFunction(async () => (await chrome.storage.sync.get('highlightNewFeatures')).highlightNewFeatures === false);
      await page.locator('label.toggle-switch').filter({ has: page.locator('#highlight-new-features-toggle') }).click();
      await page.waitForFunction(async () => (await chrome.storage.sync.get('highlightNewFeatures')).highlightNewFeatures === true);
      assert.equal(await page.locator('.te-new-badge').count(), 0, 'toggling preserves previously acknowledged items');
      const listeners = await page.evaluate<number>(`badgeListenerCount()`);
      await page.evaluate(`settingsHighlights.dispose(); settingsHighlights.dispose()`);
      assert.equal(await page.evaluate(`badgeListenerCount()`), listeners - 1);
      await browser.close();
    });
  }

  it(`${engine}: Hide until next version hides badges live, restores them and ends with a new version`, { timeout: 30_000 }, async t => {
    const browser = await ({ chromium, firefox })[engine].launch(); ownTestBrowser(t, browser);
    const page = await browser.newPage();
    await page.setContent(optionsHtml); await page.addStyleTag({ content: optionsCss });
    await installMock(page);
    const mount = `(async () => {
      BadgeTest.localizeDocument();
      window.settingsHighlights = BadgeTest.setupFeatureHighlights(chrome.storage.sync.get());
      await settingsHighlights.ready;
    })()`;
    await page.evaluate(mount);
    const button = page.getByRole('button', { name: 'Hide until next version', exact: true });
    await page.locator('.te-new-badge').first().waitFor({ state: 'attached' });
    const before = await page.evaluate(() => chrome.storage.local.get(null));
    await button.click();
    await page.waitForFunction(() => !document.querySelector('.te-new-badge') && !document.querySelector('#whats-new-btn.has-unseen'));
    const restore = page.getByRole('button', { name: 'Restore badges', exact: true });
    await restore.waitFor();
    const hidden = await page.evaluate(() => chrome.storage.local.get(null));
    assert.equal(hidden.newFeaturesHiddenThrough, CURRENT_GENERATION);
    assert.equal(hidden.newFeaturesSeenThrough, before.newFeaturesSeenThrough, 'hiding never acknowledges');
    assert.equal(await page.evaluate(() => (document.getElementById('highlight-new-features-toggle') as HTMLInputElement).checked), true);
    // A freshly opened Settings page starts hidden; a localized label follows the language.
    await page.evaluate(`settingsHighlights.dispose()`);
    await page.evaluate(mount);
    await restore.waitFor();
    assert.equal(await page.locator('.te-new-badge').count(), 0);
    await page.evaluate(`BadgeTest.languageRuntime.set('pl')`);
    await page.getByRole('button', { name: 'Przywróć oznaczenia', exact: true }).waitFor();
    await page.evaluate(`BadgeTest.languageRuntime.set('automatic')`);
    await restore.click();
    await page.locator('[data-new-feature=settingsLanguage] .te-new-badge').waitFor({ state: 'attached' });
    await button.waitFor();
    assert.equal('newFeaturesHiddenThrough' in await page.evaluate(() => chrome.storage.local.get(null)), false);
    // The marker of an earlier generation no longer hides anything in this one.
    await page.evaluate(`chrome.storage.local.set({ newFeaturesHiddenThrough: '0.1' })`);
    await page.locator('[data-new-feature=settingsLanguage] .te-new-badge').waitFor({ state: 'attached' });
    await browser.close();
  });

  it(`${engine}: Settings rejects stale storage snapshots after a live acknowledgement`, { timeout: 30_000 }, async t => {
    const browser = await ({ chromium, firefox })[engine].launch(); ownTestBrowser(t, browser);
    const page = await browser.newPage();
    await page.setContent(optionsHtml); await installMock(page);
    await page.evaluate(`(async () => {
      let resolve;
      const snapshot = new Promise(done => { resolve = done; });
      window.settingsHighlights = BadgeTest.setupFeatureHighlights(snapshot);
      await chrome.storage.sync.set({highlightNewFeatures:false});
      await chrome.storage.local.set({newFeaturesSeenThrough:'${CURRENT_GENERATION}'});
      resolve({highlightNewFeatures:true});
      await settingsHighlights.ready;
    })()`);
    assert.equal(await page.locator('.te-new-badge').count(), 0);
    assert.equal(await page.locator('#highlight-new-features-toggle').isChecked(), false);
    await page.evaluate(() => chrome.storage.sync.set({ highlightNewFeatures: true }));
    assert.equal(await page.locator('.te-new-badge').count(), 0);
    await browser.close();
  });

  it(`${engine}: development hydration preserves both acknowledgement keys across a partial live update`, { timeout: 30_000 }, async t => {
    const browser = await ({ chromium, firefox })[engine].launch(); ownTestBrowser(t, browser);
    const page = await browser.newPage();
    await page.setContent(optionsHtml); await installMock(page, '0.26.1016.1512');
    await page.evaluate(`(async () => {
      let resolveLocal;
      chrome.storage.local.get = () => new Promise(resolve => { resolveLocal = resolve; });
      window.settingsHighlights = BadgeTest.setupFeatureHighlights(Promise.resolve({}));
      await chrome.storage.local.set({newFeaturesSeenThrough:'${CURRENT_GENERATION}'});
      resolveLocal({newFeaturesSeenThrough:'${PREVIOUS_GENERATION}', newFeaturesSeenItems: BadgeTest.NEW_FEATURE_ITEMS.map(item => item.id + '@' + item.since)});
      await settingsHighlights.ready;
    })()`);
    assert.equal(await page.locator('.te-new-badge').count(), 0, 'generation event cannot discard the item snapshot');
    await browser.close();
  });

  it(`${engine}: player gear dot and new menu rows follow local/sync changes, language and rebuilds`, { timeout: 45_000 }, async t => {
    const browser = await ({ chromium, firefox })[engine].launch(); ownTestBrowser(t, browser);
    const page = await browser.newPage();
    await page.route('https://badge.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><video muted loop style="width:640px;height:360px"></video>' }));
    await page.goto('https://badge.test/');
    await installMock(page, '0.26.1016.1512');
    await page.evaluate(`window.getBadgeLocal = chrome.storage.local.get; chrome.storage.local.get = () => new Promise(resolve => { window.resolveBadgeLocal = resolve; })`);
    await page.addStyleTag({ content: contentCss });
    await page.evaluate(({ media, uiCss }) => {
      document.querySelector('video')!.src = media;
      // Bundle entrypoints are deliberately explicit in these browser fixtures.
      const api = (window as unknown as { BadgeTest: { setPlayerUiCss(css: string): void; bootstrapPlayerRuntime(): void } }).BadgeTest;
      api.setPlayerUiCss(uiCss); api.bootstrapPlayerRuntime();
    }, { media, uiCss });
    await page.evaluate(`(async () => {
      await chrome.storage.local.set({newFeaturesSeenThrough:'${CURRENT_GENERATION}'});
      resolveBadgeLocal({newFeaturesSeenThrough:'${CURRENT_GENERATION}'});
      // Later acknowledgement reads use the normal mock storage again.
      chrome.storage.local.get = getBadgeLocal;
    })()`);
    await page.waitForFunction(() => document.querySelector('video')!.readyState >= 2);
    await page.keyboard.press('t');
    await page.locator('.player-settings-btn .te-new-badge[data-variant="dot"]').waitFor();
    await page.locator('.player-settings-btn').click();
    assert.equal(await page.getByRole('button', { name: /^Layout: Centered, New$/ }).count(), 1);
    const gear = await page.locator('.player-settings-btn svg').boundingBox();
    const dot = await page.locator('.player-settings-btn .te-new-badge').boundingBox();
    assert.ok(gear && dot && Math.abs(dot.y - gear.y) < 8 && Math.abs(dot.x - gear.x) < 22,
      'the dot stays beside the gear icon when the menu expands its trigger');
    assert.equal(await page.locator('[data-settings-section=audio] .te-new-badge').count(), 1);
    assert.equal(await page.locator('[data-settings-section=audio] .theater-settings-heading .te-new-badge').count(), 1);
    assert.equal(await page.locator('[data-settings-section=audio] button .te-new-badge').count(), 0);
    assert.doesNotMatch(await page.locator('.audio-voice-btn').getAttribute('aria-label') ?? '', /New/);
    assert.equal(await page.locator('.volume-boost-btn .te-new-badge').count(), 0, 'volume boost shipped before the current generation');
    await page.evaluate(() => chrome.storage.sync.set({ highlightNewFeatures: false }));
    await page.waitForFunction(() => !document.querySelector('#theater-everywhere-ui')?.shadowRoot?.querySelector('.te-new-badge'));
    await page.evaluate(() => chrome.storage.sync.set({ highlightNewFeatures: true }));
    await page.locator('.player-settings-btn .te-new-badge').waitFor();
    await page.evaluate(`BadgeTest.languageRuntime.set('pl')`);
    await page.locator('[data-settings-section=audio] .theater-settings-heading .te-new-badge').filter({ hasText: 'Nowość' }).waitFor({ state: 'attached' });
    await page.evaluate(`chrome.storage.local.set({
      [BadgeTest.HIGHLIGHTS_WINDOW_STORAGE_KEY]: { generation: '${CURRENT_GENERATION}', firstShownAt: Date.now() - BadgeTest.FEATURE_HIGHLIGHTS_MAX_AGE_MS }
    })`);
    await page.waitForFunction(() => !document.querySelector('#theater-everywhere-ui')?.shadowRoot?.querySelector('.te-new-badge'));
    assert.equal(await page.evaluate(`BadgeTest.hasUnseenWhatsNew()`), false, 'expired items cannot auto-open the announcement');
    await page.evaluate(`chrome.storage.local.set({
      [BadgeTest.HIGHLIGHTS_WINDOW_STORAGE_KEY]: { generation: '${CURRENT_GENERATION}', firstShownAt: Date.now() }
    })`);
    await page.locator('.player-settings-btn .te-new-badge').waitFor();
    await page.evaluate(`void BadgeTest.openWhatsNewDialog()`);
    await page.waitForFunction(() => !document.querySelector('#theater-everywhere-ui')?.shadowRoot?.querySelector('.te-new-badge'));
    await page.locator('.te-dialog-btn-primary').click();
    await page.keyboard.press('Escape'); await page.keyboard.press('t');
    assert.equal(await page.locator('.te-new-badge').count(), 0);
    await browser.close();
  });
}
