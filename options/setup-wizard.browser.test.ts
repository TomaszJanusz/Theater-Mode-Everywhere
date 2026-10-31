import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { INSTALL_SHORTCUTS } from '../src/first-run-setup';
import { MEDIA_PROVIDER_IDS, mediaProviderFlagStorageKeys } from '../src/media-features/provider-flags';
import { PROVIDER_CAPABILITIES } from '../src/providers/capabilities';
import { bundleModules } from '../src/test-utils/player-boot';
import { readStylesheet } from '../src/test-utils/styles';
import { sharedTestBrowser } from '../src/test-utils/test-browser';
import { selectTestEngines } from '../src/test-utils/test-engines';

import { defaultSetupAnswers } from './setup-answers';

const html = readFileSync(new URL('./options.html', import.meta.url), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '');
const css = readStylesheet(new URL('./options.css', import.meta.url));
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const catalogs = Object.fromEntries(['en', 'ar'].map(locale => [locale,
  JSON.parse(readFileSync(new URL(`../_locales/${locale}/messages.json`, import.meta.url), 'utf8'))]));
// The page's own wiring (options.ts) minus what needs Vite: tabs, appearance, and the setup over chrome storage.
const BUNDLE = bundleModules([`
  import { chromeSetupStorage, routeSetupWizard } from '../options/setup-wizard';
  import { setupSettingsTabs } from '../options/tabs';
  import { localizeDocument } from './i18n';
  import { languageRuntime } from './i18n-runtime';
  import { observeAppearance } from './appearance-runtime';
  import { applyAccentColorPreset } from './accentTheme';
  window.setLanguage = async locale => { await languageRuntime.set(locale); localizeDocument(); };
  window.ready = (async () => {
    await window.setLanguage('en');
    setupSettingsTabs(document.getElementById('settings-tabs'));
    observeAppearance(document.documentElement);
    // As Settings applies the saved accent. A named preset: headless engines pair a light AccentColor with white
    // AccentColorText, which no real system accent does, so the system preset would fail contrast for the wrong reason.
    applyAccentColorPreset(document.documentElement, 'purple');
    window.setup = routeSetupWizard(document.getElementById('setup-wizard'),
      ['.privacy-thing-card', '#settings-tabs', '.settings-stack'].map(selector => document.querySelector(selector)), {
        storage: chromeSetupStorage(), version: '2.1.0'
      });
  })();`]);

type Area = 'sync' | 'local';
type Harness = {
  setup: { start(initial?: unknown): void; ready: Promise<void> };
  ready: Promise<void>;
  setLanguage(locale: string): Promise<void>;
  data: Record<Area, Record<string, unknown>>;
  writes: Array<[Area, Record<string, unknown>]>;
  /** A change from elsewhere: another device through sync, or another page. `quiet` skips `onChanged`. */
  external(update: Record<string, unknown>, quiet?: boolean): void;
};

/** What sync holds right after a fresh install wrote its defaults. */
const FRESH = { shortcuts: { ...INSTALL_SHORTCUTS }, blacklist: [], autoEnterTheater: false };
const PENDING = { firstRunSetup: { status: 'pending', version: '2.1.0' } };

async function open(page: Page, sync: Record<string, unknown> = FRESH, local: Record<string, unknown> = PENDING) {
  await page.route('http://options.test/**', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('http://options.test/options.html#setup');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: 'window.__name = fn => fn;' });
  await page.evaluate(({ messages, sync, local }) => {
    const state = window as unknown as Harness;
    state.data = { sync: structuredClone(sync), local: structuredClone(local) };
    state.writes = [];
    const listeners = new Set<(changes: Record<string, { newValue: unknown }>, area: string) => void>();
    const notify = (area: Area, update: Record<string, unknown>) => {
      const changes = Object.fromEntries(Object.entries(update).map(([key, newValue]) => [key, { newValue }]));
      for (const listener of listeners) listener(changes, area);
    };
    state.external = (update, quiet = false) => {
      Object.assign(state.data.sync, update);
      if (!quiet) notify('sync', update);
    };
    const area = (name: Area) => ({
      get: async (keys: string | string[] | null) => keys === null ? structuredClone(state.data[name])
        : Object.fromEntries([keys].flat().filter(key => key in state.data[name]).map(key => [key, structuredClone(state.data[name][key])])),
      set: async (update: Record<string, unknown>) => {
        state.writes.push([name, structuredClone(update)]);
        Object.assign(state.data[name], update);
        notify(name, update);
      }
    });
    Object.assign(window, { chrome: {
      i18n: { getMessage: (key: string) => key === '@@ui_locale' ? 'en' : key === '@@bidi_dir' ? 'ltr' : '' },
      runtime: { sendMessage: async ({ locale }: { locale: string }) => messages[locale] },
      storage: {
        sync: area('sync'), local: area('local'),
        onChanged: { addListener: (listener: never) => listeners.add(listener), removeListener: (listener: never) => listeners.delete(listener) }
      }
    } });
  }, { messages: catalogs, sync, local });
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(() => (window as unknown as Harness).ready);
  await page.locator('.setup-wizard :is(.setup-step, .setup-notice)').waitFor();
}

const defaultAnswers = () => JSON.parse(JSON.stringify(defaultSetupAnswers())) as unknown;
const writes = (page: Page) => page.evaluate(() => (window as unknown as Harness).writes);
/** Next until the last step, whose primary button is Finish. */
async function toSummary(page: Page): Promise<void> {
  while (await page.locator('.setup-summary').count() === 0) await page.getByRole('button', { name: 'Next' }).click();
}
const focusedText = (page: Page) => page.evaluate(() => document.activeElement?.textContent ?? '');

async function blockingViolations(page: Page): Promise<string[]> {
  if (!await page.evaluate(() => 'axe' in window)) await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => {
    const results = await (window as unknown as { axe: { run(scope: Element): Promise<{ violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[] }> }> }> } })
      .axe.run(document.getElementById('setup-wizard')!);
    return results.violations.filter(violation => ['serious', 'critical'].includes(violation.impact))
      .flatMap(violation => violation.nodes.map(node => `${violation.id}: ${node.target.join(' ')}`));
  });
}

for (const [name, engine] of selectTestEngines(Object.entries({ chromium, firefox }), ([name]) => name)) describe(`First-run setup (${name})`, () => {
  const shared = sharedTestBrowser(engine);
  const newPage = async (t: Parameters<typeof shared.newContext>[0]) =>
    (await shared.newContext(t, { viewport: { width: 1100, height: 900 } })).newPage();

  it('runs every step by keyboard, moves focus to each step, and saves only the changed settings on Finish', { timeout: 60000 }, async t => {
    const page = await newPage(t);
    await open(page);
    // The setup replaces the settings while the page is at #setup.
    assert.equal(await page.locator('#settings-tabs').isHidden(), true);
    assert.equal(await page.locator('.settings-stack').isHidden(), true);
    assert.equal(await page.locator('.setup-progress').textContent(), 'Step 1 of 4');
    assert.equal(await page.getByRole('radio', { name: 'All supported services' }).isChecked(), true);
    assert.equal(await page.locator('#setup-services').isHidden(), true);
    assert.deepEqual(await blockingViolations(page), []);

    await page.getByRole('radio', { name: 'All supported services' }).focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.getByRole('radio', { name: 'Choose services' }).isChecked(), true);
    // The switches come from the provider catalog, all on, and follow the choice in keyboard order.
    assert.equal(await page.locator('#setup-services').getByRole('switch').count(), PROVIDER_CAPABILITIES.length);
    assert.equal(await page.locator('#setup-services [role="switch"]:checked').count(), PROVIDER_CAPABILITIES.length);
    assert.deepEqual(await blockingViolations(page), []);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'switch');
    const first = await page.evaluate(() => document.getElementById(document.activeElement!.getAttribute('aria-labelledby')!)!.textContent);
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#setup-services [role="switch"]:checked').count(), PROVIDER_CAPABILITIES.length - 1);
    // Escape is not a way out: nothing closes and nothing is written.
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.setup-step').isVisible(), true);

    await page.getByRole('button', { name: 'Next' }).click();
    assert.equal(await focusedText(page), 'Starting theater mode');
    assert.equal(await page.locator('.setup-progress').textContent(), 'Step 2 of 4');
    // The user's own theater key names the choices.
    assert.equal(await page.getByRole('radio', { name: 'Only when I press T' }).isChecked(), true);
    assert.equal(await page.locator('#setup-skip-countdown').isHidden(), true);
    await page.getByRole('radio', { name: 'Only when I press T' }).focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.getByRole('radio', { name: 'Start automatically' }).isChecked(), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'setup-skip-countdown');
    await page.keyboard.press('Space');
    assert.deepEqual(await blockingViolations(page), []);

    await page.getByRole('button', { name: 'Next' }).click();
    assert.equal(await focusedText(page), 'Keys and sound');
    assert.match(await page.locator('.setup-step-desc').textContent() ?? '', /T and F also work/);
    assert.equal(await page.getByRole('switch', { name: 'Hold for 2x speed' }).isChecked(), true);
    assert.equal(await page.getByRole('switch', { name: 'Volume Boost' }).isChecked(), false);
    await page.getByRole('switch', { name: 'Volume Boost' }).focus();
    await page.keyboard.press('Space');
    assert.deepEqual(await blockingViolations(page), []);

    await page.getByRole('button', { name: 'Next' }).click();
    assert.equal(await focusedText(page), 'You’re all set');
    assert.equal(await page.locator('.setup-progress').textContent(), 'Step 4 of 4');
    assert.deepEqual(await page.locator('.setup-summary dd').allTextContents(), [
      `${PROVIDER_CAPABILITIES.length - 1} of ${PROVIDER_CAPABILITIES.length} services`, 'Automatically, without a countdown', 'On', 'On'
    ]);
    assert.deepEqual(await blockingViolations(page), []);
    for (const heading of ['Keys and sound', 'Starting theater mode', 'Services with extra features']) {
      await page.getByRole('button', { name: 'Back' }).click();
      assert.equal(await focusedText(page), heading);
    }
    // Answers survive moving between steps.
    assert.equal(await page.getByRole('radio', { name: 'Choose services' }).isChecked(), true);
    assert.equal(await page.locator('#setup-services [role="switch"]:checked').count(), PROVIDER_CAPABILITIES.length - 1);
    await page.getByRole('button', { name: 'Next' }).click();
    assert.equal(await page.getByRole('switch', { name: 'Skip countdown' }).isChecked(), true);
    assert.deepEqual(await writes(page), [], 'nothing is written before Finish');

    await toSummary(page);
    await page.getByRole('button', { name: 'Finish' }).click();
    await page.locator('#features').waitFor();
    assert.equal(new URL(page.url()).hash, '#features');
    assert.equal(await page.locator('#setup-wizard').isHidden(), true);
    assert.equal(await page.getByRole('tab', { name: 'Features' }).getAttribute('aria-selected'), 'true');
    const saved = await writes(page);
    assert.equal(saved.length, 2, 'one sync write, then the device state');
    const [[area, settings], [stateArea, state]] = saved;
    assert.equal(area, 'sync');
    const off = PROVIDER_CAPABILITIES.find(provider => provider.name === first)!;
    assert.deepEqual(settings, {
      ...Object.fromEntries(mediaProviderFlagStorageKeys().map(key => [key, key !== `${off.id}IntegrationEnabled`])),
      autoEnterTheater: true, autoTheaterSkipCountdown: true, volumeBoostEnabled: true
    });
    assert.deepEqual([stateArea, state], ['local', { firstRunSetup: { status: 'completed', version: '2.1.0' } }]);
  });

  it('writes only the launcher offer for the preselected answers, nothing for Skip, and Skip leaves without asking', async t => {
    const page = await newPage(t);
    await open(page);
    await toSummary(page);
    assert.deepEqual(await page.locator('.setup-summary dd').allTextContents(), ['All supported services', 'Only when you press T', 'On', 'Off']);
    await page.getByRole('button', { name: 'Finish' }).click();
    await page.locator('#features').waitFor();
    assert.deepEqual(await writes(page), [
      ['sync', { videoActivatorPromptAnswer: false }], ['local', { firstRunSetup: { status: 'completed', version: '2.1.0' } }]
    ]);

    const skipped = await newPage(t);
    await open(skipped);
    // Unchanged answers close quietly; changed ones make the browser ask before the tab closes.
    const unload = () => skipped.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
    assert.equal(await unload(), false);
    await skipped.getByRole('radio', { name: 'None' }).check();
    assert.equal(await unload(), true);
    await skipped.getByRole('button', { name: 'Skip setup' }).click();
    await skipped.locator('#features').waitFor();
    assert.deepEqual(await writes(skipped), [['local', { firstRunSetup: { status: 'skipped', version: '2.1.0' } }]]);
    assert.equal(await unload(), false);
  });

  it('keeps "Start automatically" unavailable, and says why, when no chosen service supports it', async t => {
    const page = await newPage(t);
    await open(page);
    await page.getByRole('radio', { name: 'None' }).check();
    await page.getByRole('button', { name: 'Next' }).click();
    const auto = page.getByRole('radio', { name: 'Start automatically' });
    assert.equal(await auto.isDisabled(), true);
    assert.match(await page.evaluate(() => document.querySelector('input[value="auto"]')!.getAttribute('aria-describedby')!), /setup-choice-auto-unavailable/);
    assert.equal(await page.locator('#setup-choice-auto-unavailable').textContent(), 'Turn on a service that supports it in the first step to use this.');
    assert.equal(await page.getByRole('radio', { name: 'Only when I press T' }).isChecked(), true);
    assert.deepEqual(await blockingViolations(page), []);
    await page.getByRole('radio', { name: 'T, or a button on videos' }).check();
    await toSummary(page);
    assert.deepEqual(await page.locator('.setup-summary dd').allTextContents(), ['None', 'T or a button on videos', 'On', 'Off']);
    await page.getByRole('group', { name: 'Or finish and open:' }).getByRole('button', { name: 'Keyboard Shortcuts' }).click();
    await page.locator('#shortcuts').waitFor();
    const [[, settings]] = await writes(page);
    assert.ok(mediaProviderFlagStorageKeys().every(key => settings[key] === false));
    assert.equal(Object.keys(settings).length, MEDIA_PROVIDER_IDS.length + 2);
    assert.deepEqual([settings.videoActivator, settings.videoActivatorPromptAnswer], [true, true]);
  });

  it('gives way to settings that sync delivers after the install, and never overwrites them', async t => {
    // Arrives while the setup is open.
    const live = await newPage(t);
    await open(live);
    await live.getByRole('radio', { name: 'None' }).check();
    await live.evaluate(() => (window as unknown as Harness).external({ blacklist: ['example.com'] }));
    await live.locator('.setup-notice').waitFor();
    assert.match(await focusedText(live), /arrived from another device/);
    assert.deepEqual(await writes(live), [['local', { firstRunSetup: { status: 'profile', version: '2.1.0' } }]]);
    assert.deepEqual(await blockingViolations(live), []);
    await live.getByRole('button', { name: 'Open settings' }).click();
    await live.locator('#features').waitFor();

    // Arrives without a change event before Finish: the Finish-time read catches it.
    const quiet = await newPage(t);
    await open(quiet);
    await quiet.getByRole('radio', { name: 'None' }).check();
    await quiet.evaluate(() => (window as unknown as Harness).external({ language: 'pl' }, true));
    await toSummary(quiet);
    await quiet.getByRole('button', { name: 'Finish' }).click();
    await quiet.locator('.setup-notice').waitFor();
    assert.deepEqual(await writes(quiet), [['local', { firstRunSetup: { status: 'profile', version: '2.1.0' } }]]);

    // Already there when the page opens.
    const early = await newPage(t);
    await open(early, { ...FRESH, autoEnterTheater: true });
    assert.equal(await early.locator('.setup-step').count(), 0);
    assert.deepEqual(await writes(early), [['local', { firstRunSetup: { status: 'profile', version: '2.1.0' } }]]);
  });

  it('opened by hand, shows the saved choices and ignores the profile check', async t => {
    const page = await newPage(t);
    await open(page, { ...FRESH, netflixIntegrationEnabled: false, language: 'pl' }, {});
    assert.equal(await page.getByRole('radio', { name: 'Choose services' }).isChecked(), true);
    assert.equal(await page.locator('#setup-services [role="switch"]:checked').count(), PROVIDER_CAPABILITIES.length - 1);
    await page.getByRole('button', { name: 'Skip setup' }).click();
    await page.locator('#features').waitFor();
    assert.deepEqual(await writes(page), [], 'Skip records nothing when the install did not ask');
  });

  it('starts on request in the same page with the given answers, over the settings or over a running setup', async t => {
    const page = await newPage(t);
    // A pending install state and a synced profile: an explicit start still shows the setup, not the notice.
    await open(page, { ...FRESH, language: 'pl', netflixIntegrationEnabled: false });
    assert.equal(await page.locator('.setup-notice').count(), 1);
    const entries = await page.evaluate(() => history.length);
    const start = async (initial?: unknown) => {
      await page.evaluate(initial => (window as unknown as Harness).setup.start(initial ?? undefined), initial ?? null);
      // A start from another section arrives through hashchange; a restart at #setup replaces the shown setup.
      await page.locator('.setup-step').waitFor();
    };
    await start(defaultAnswers());
    assert.equal(await page.locator('.setup-step').count(), 1);
    assert.equal(await page.getByRole('radio', { name: 'All supported services' }).isChecked(), true, 'the given answers, not the saved ones');
    await page.getByRole('button', { name: 'Skip setup' }).click();
    await page.locator('#features').waitFor();
    // From the settings, without answers: the saved settings are preselected.
    await start();
    assert.equal(new URL(page.url()).hash, '#setup');
    assert.equal(await page.locator('#settings-tabs').isHidden(), true);
    assert.equal(await page.getByRole('radio', { name: 'Choose services' }).isChecked(), true);
    assert.equal(await page.evaluate(() => history.length), entries, 'the same tab and history entry');
    await toSummary(page);
    await page.getByRole('button', { name: 'Finish' }).click();
    await page.locator('#features').waitFor();
    assert.deepEqual((await writes(page)).at(-1), ['local', { firstRunSetup: { status: 'completed', version: '2.1.0' } }]);
    // Unchanged answers write no settings beyond answering the launcher offer.
    assert.deepEqual((await writes(page)).filter(([area]) => area === 'sync'), [['sync', { videoActivatorPromptAnswer: false }]]);
  });

  it('lays out right to left in Arabic and stays accessible', async t => {
    const page = await newPage(t);
    await open(page);
    await page.evaluate(() => (window as unknown as Harness).setLanguage('ar'));
    assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
    assert.equal(await page.locator('.setup-progress').textContent(), catalogs.ar.setupProgress.message.replace('$1', '1').replace('$2', '4'));
    // Skip sits at the inline start, the step buttons at the inline end: mirrored in right to left.
    const skip = await page.locator('.setup-skip').boundingBox();
    const next = await page.locator('.setup-actions .te-dialog-btn-primary').boundingBox();
    assert.ok(skip && next && skip.x > next.x, 'Skip is on the right in right-to-left');
    await page.getByRole('radio', { name: catalogs.ar.setupServicesChoose.message }).check();
    assert.deepEqual(await blockingViolations(page), []);
    // The nested countdown switch indents from the inline start: the right in right to left.
    await page.locator('.setup-actions .te-dialog-btn-primary').click();
    await page.getByRole('radio', { name: catalogs.ar.setupStartAuto.message }).check();
    const choice = await page.locator('.setup-choice:has(input[value="auto"])').boundingBox();
    const nested = await page.locator('.setup-nested').boundingBox();
    assert.ok(choice && nested && nested.x + nested.width < choice.x + choice.width, 'indented from the right');
    assert.deepEqual(await blockingViolations(page), []);
    await page.locator('.setup-actions .te-dialog-btn-primary').click();
    assert.deepEqual(await blockingViolations(page), []);
  });
});
