import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

import { chromium, firefox, type BrowserContext, type Page } from 'playwright';

import { installContextChromeStub } from '../test-utils/chrome-stub-context';
import { bundleQueryModules } from '../test-utils/query-bundle';
import { readStylesheet } from '../test-utils/styles';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { selectTestEngines } from '../test-utils/test-engines';
import { WHATS_NEW_RELEASE } from '../whatsNew-release';

const ROOT = path.resolve(__dirname, '../..');
const bundles = Promise.all([
  bundleQueryModules(["import '../options/options';"], 'SettingsFixture'),
  bundleQueryModules([
    "export { bootstrapPlayerRuntime } from './ui/player-runtime';",
    "export { setPlayerUiCss } from './ui/root';",
    "export { saveAutoTheaterEnabled } from './ui/auto-theater-settings';"
  ], 'SettingsFixture')
]);

type Saved = Record<string, unknown>;
async function storage(context: BrowserContext, saved: Saved): Promise<void> {
  await installContextChromeStub(context, saved);
  await context.addInitScript({ content: `localStorage.setItem('whatsNewAcknowledgedId', ${JSON.stringify(WHATS_NEW_RELEASE.id)});` });
}

// AutoTheater is only available where a provider declares watch playback.
async function open(page: Page, surface: 'options' | 'player', host = surface === 'player' ? 'vimeo.com' : 'settings.test'): Promise<void> {
  page.setDefaultTimeout(8_000);
  const html = surface === 'options'
    ? readFileSync(path.join(ROOT, 'options/options.html'), 'utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')
    : '<html><body><video src="/vod.webm" muted style="width:640px;height:360px"></video></body></html>';
  await page.route(`https://${host}/**`, route => route.fulfill(route.request().url().endsWith('.webm')
    ? { contentType: 'video/webm', body: readFileSync(path.join(ROOT, 'test/fixtures/vod.webm')) }
    : { contentType: 'text/html', body: html }));
  await page.goto(`https://${host}/`);
  await page.addStyleTag({ content: readStylesheet(path.join(ROOT, surface === 'options' ? 'options/options.css' : 'src/content.css')) });
  await page.addScriptTag({ content: (await bundles)[surface === 'options' ? 0 : 1] });
  if (surface === 'options') {
    await page.waitForFunction(() => document.querySelector('#shortcuts .options-body')?.getAttribute('aria-busy') === 'false');
    await page.locator('#tab-features').click();
    await page.waitForFunction(() => document.querySelector<HTMLInputElement>('#auto-enter-theater-toggle')?.checked);
  } else {
    await page.evaluate(css => {
      // The fixture bundle is deliberately exposed for lifecycle and stale-work checks.
      const fixture = (window as unknown as { SettingsFixture: { setPlayerUiCss(css: string): void; bootstrapPlayerRuntime(): void } }).SettingsFixture;
      fixture.setPlayerUiCss(css); fixture.bootstrapPlayerRuntime();
    }, readStylesheet(path.join(ROOT, 'src/ui/shadow.css')));
    await page.locator('video').evaluate(async (video: HTMLVideoElement) => { await video.play(); video.pause(); });
    await page.keyboard.press('t');
    await page.locator('.theater-controls-wrapper').waitFor();
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.auto-theater-btn')?.matches('[aria-pressed="true"], [aria-disabled="true"]'));
  }
}

async function toggle(page: Page, surface: 'options' | 'player'): Promise<void> {
  if (surface === 'options') await page.locator('label[for=auto-enter-theater-toggle]').click();
  else await page.locator('.auto-theater-btn').evaluate((button: HTMLElement) => button.click());
}

const browsers = new Map(selectTestEngines([chromium, firefox], engine => engine.name()).map(engine => [engine, sharedTestBrowser(engine)] as const));

for (const engine of selectTestEngines([chromium, firefox], engine => engine.name())) {
  const shared = browsers.get(engine)!;
  for (const surface of ['options', 'player'] as const) {
    it(`${engine.name()}: ${surface} offers the launcher once, respects No and updates other tabs after Yes`, { timeout: 60_000 }, async t => {
      const context = await shared.newContext(t, { reducedMotion: 'reduce', ignoreHTTPSErrors: true });
      const saved: Saved = { autoEnterTheater: true, keepControlsVisible: true };
      await storage(context, saved);
      const page = await context.newPage();
      await open(page, surface);
      const observer = await context.newPage();
      await open(observer, 'options');
      assert.equal(await observer.locator('#video-activator-toggle').isChecked(), false);
      await toggle(page, surface);
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      assert.equal(await dialog.getAttribute('aria-modal'), 'true');
      assert.equal(await page.locator('.te-dialog-btn-secondary').evaluate(el => el.getRootNode() instanceof ShadowRoot
        ? (el.getRootNode() as ShadowRoot).activeElement === el : document.activeElement === el), true);
      await page.screenshot({ path: `/tmp/tme-86-${engine.name()}-${surface}-prompt.png` });
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('.te-dialog-btn-primary').evaluate(el => el.getRootNode() instanceof ShadowRoot
        ? (el.getRootNode() as ShadowRoot).activeElement === el : document.activeElement === el), true);
      await page.locator('.te-dialog-btn-secondary').click();
      await page.waitForFunction(async () => (await chrome.storage.sync.get('videoActivatorPromptAnswer')).videoActivatorPromptAnswer === false);
      assert.equal(saved.videoActivator, undefined, 'No never writes an enabled setting');
      for (let i = 0; i < 2; i++) {
        await toggle(page, surface);
        await page.waitForFunction(async enabled => (await chrome.storage.sync.get('autoEnterTheater')).autoEnterTheater === enabled, i === 0);
      }
      assert.equal(await dialog.count(), 0, 'remembered No suppresses the next offer');
      // A fresh profile/cleared answer can accept the same shared prompt.
      await page.evaluate(() => chrome.storage.sync.set({ autoEnterTheater: true, videoActivatorPromptAnswer: null }));
      await toggle(page, surface);
      await dialog.waitFor();
      await page.locator('.te-dialog-btn-primary').click();
      await observer.waitForFunction(() => document.querySelector<HTMLInputElement>('#video-activator-toggle')?.checked);
      await observer.waitForFunction(async () => {
        const data = await chrome.storage.sync.get(['videoActivator', 'videoActivatorPromptAnswer']);
        return data.videoActivator === true && data.videoActivatorPromptAnswer === true;
      });
      assert.equal(await observer.locator('#auto-enter-theater-toggle').isChecked(), false);
      // An existing explicit opt-in never prompts, even without an answer.
      await page.evaluate(() => chrome.storage.sync.set({ autoEnterTheater: true, videoActivatorPromptAnswer: null }));
      await toggle(page, surface);
      await page.waitForFunction(async () => (await chrome.storage.sync.get('autoEnterTheater')).autoEnterTheater === false);
      assert.equal(await dialog.count(), 0);
    });
  }

  it(`${engine.name()}: cancels stale offers and treats Escape as a remembered No`, { timeout: 60_000 }, async t => {
    const context = await shared.newContext(t, { reducedMotion: 'reduce', ignoreHTTPSErrors: true });
    const saved: Saved = { autoEnterTheater: true, keepControlsVisible: true };
    await storage(context, saved);
    const page = await context.newPage();
    // The theater shortcut ignores presses for 200 ms after each toggle. A fake clock makes that
    // window explicit: this test is fast enough to re-enter inside it, so expire it before the re-entry.
    await page.clock.install();
    await open(page, 'player');
    await toggle(page, 'player');
    await page.getByRole('dialog').waitFor();
    await page.evaluate(() => chrome.storage.sync.set({ autoEnterTheater: true }));
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(saved.videoActivatorPromptAnswer, undefined, 'external cancellation is not an answer');
    await toggle(page, 'player');
    await page.getByRole('dialog').waitFor();
    await page.evaluate(() => chrome.storage.sync.set({ videoActivator: true }));
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(saved.videoActivatorPromptAnswer, undefined, 'enabling the launcher elsewhere cancels the offer');
    await page.evaluate(() => chrome.storage.sync.set({ autoEnterTheater: true, videoActivator: false }));
    await toggle(page, 'player');
    await page.getByRole('dialog').waitFor();
    await page.locator('.close-btn').evaluate((button: HTMLElement) => button.click());
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(saved.videoActivatorPromptAnswer, undefined, 'theater exit is not an answer');
    await page.evaluate(() => chrome.storage.sync.set({ autoEnterTheater: true }));
    await page.clock.runFor(200);
    await page.keyboard.press('t');
    await page.locator('.theater-controls-wrapper').waitFor();
    await toggle(page, 'player');
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(async () => (await chrome.storage.sync.get('videoActivatorPromptAnswer')).videoActivatorPromptAnswer === false);
    assert.equal(saved.videoActivator, false);
  });
}

for (const engine of selectTestEngines([chromium, firefox], engine => engine.name())) {
  const shared = browsers.get(engine)!;
  it(`${engine.name()}: player menu shows AutoTheater unavailable off supported services and live when Rich Theater Experience toggles`, { timeout: 60_000 }, async t => {
    const context = await shared.newContext(t, { reducedMotion: 'reduce', ignoreHTTPSErrors: true });
    const saved: Saved = { autoEnterTheater: true, keepControlsVisible: true };
    await storage(context, saved);
    const row = (page: Page) => page.locator('.auto-theater-btn');
    const state = (page: Page) => row(page).evaluate((button: HTMLElement) => ({
      disabled: button.getAttribute('aria-disabled'), pressed: button.getAttribute('aria-pressed'), label: button.getAttribute('aria-label') }));

    const generic = await context.newPage();
    await open(generic, 'player', 'generic.test');
    await generic.locator('.player-settings-btn').click();
    await generic.screenshot({ path: `/tmp/te-autotheater-unsupported-${engine.name()}.png` });
    assert.deepEqual(await state(generic), { disabled: 'true', pressed: 'false', label: 'AutoTheater: Unavailable' });
    // Visible and focusable, but activating it neither changes the saved preference nor prompts.
    await row(generic).focus();
    await row(generic).evaluate((button: HTMLElement) => button.click());
    assert.equal(await generic.locator('.te-dialog-btn-primary').count(), 0);
    assert.equal(saved.autoEnterTheater, true);

    const supported = await context.newPage();
    await open(supported, 'player');
    assert.equal((await state(supported)).disabled, 'false');
    await supported.locator('.player-settings-btn').click();
    await supported.evaluate(() => chrome.storage.sync.set({ vimeoIntegrationEnabled: false }));
    await supported.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot
      ?.querySelector('.auto-theater-btn')?.getAttribute('aria-disabled') === 'true');
    assert.equal((await state(supported)).label, 'AutoTheater: Unavailable');
    await supported.screenshot({ path: `/tmp/te-autotheater-integration-off-${engine.name()}.png` });
    await supported.evaluate(() => chrome.storage.sync.set({ vimeoIntegrationEnabled: true }));
    await supported.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot
      ?.querySelector('.auto-theater-btn')?.getAttribute('aria-disabled') === 'false');
  });
}
