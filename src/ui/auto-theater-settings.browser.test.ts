import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { build } from 'esbuild';
import { chromium, firefox, type BrowserContext, type Page } from 'playwright';
import { ownTestBrowser } from '../test-utils/test-browser';
import { readStylesheet } from '../test-utils/styles';
import { WHATS_NEW_RELEASE } from '../whatsNew-release';

const ROOT = path.resolve(__dirname, '../..');
const bundles = Promise.all(['options/options.ts', 'player'].map(entry => build({
  ...(entry === 'player' ? { stdin: { contents: `export { bootstrapPlayerRuntime } from './src/ui/player-runtime';
    export { setPlayerUiCss } from './src/ui/root';
    export { saveAutoTheaterEnabled } from './src/ui/auto-theater-settings';`, resolveDir: ROOT, loader: 'ts' as const } }
    : { entryPoints: [path.join(ROOT, entry)] }),
  plugins: [{ name: 'raw', setup(builder) {
    builder.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' }));
    builder.onLoad({ filter: /.*/, namespace: 'raw' }, args => ({ contents: readFileSync(args.path, 'utf8'), loader: 'text' }));
  } }],
  bundle: true, write: false, format: 'iife', globalName: 'SettingsFixture', target: 'es2022'
}).then(result => result.outputFiles![0].text)));

type Saved = Record<string, unknown>;
async function storage(context: BrowserContext, saved: Saved): Promise<void> {
  await context.exposeBinding('readSettings', () => ({ ...saved }));
  await context.exposeBinding('writeSettings', async (_source, values: Saved) => {
    const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { oldValue: saved[key], newValue }]));
    Object.assign(saved, values);
    await Promise.all(context.pages().map(page => page.evaluate(changes => {
      window.dispatchEvent(new CustomEvent('fixture-storage', { detail: changes }));
    }, changes)));
  });
  await context.addInitScript({ content: `window.__name = fn => fn;
    const listeners = new Set();
    window.addEventListener('fixture-storage', event => listeners.forEach(fn => fn(event.detail, 'sync')));
    const sync = { get: async (_keys, cb) => { const data = await window.readSettings(); cb?.(data); return data; },
      set: values => window.writeSettings(values) };
    window.chrome = { runtime: { getURL: file => file, sendMessage: async () => ({}), onMessage: { addListener() {} }, getManifest: () => ({ version: '2.0.0' }) },
      storage: { sync, local: { get: async () => ({}), set: async () => {} },
        onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) } },
      tabs: { query: async () => [] } };
    localStorage.setItem('whatsNewAcknowledgedId', ${JSON.stringify(WHATS_NEW_RELEASE.id)});` });
}

async function open(page: Page, surface: 'options' | 'player'): Promise<void> {
  page.setDefaultTimeout(8_000);
  const html = surface === 'options'
    ? readFileSync(path.join(ROOT, 'options/options.html'), 'utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')
    : '<html><body><video src="/vod.webm" muted style="width:640px;height:360px"></video></body></html>';
  await page.route('http://settings.test/**', route => route.fulfill(route.request().url().endsWith('.webm')
    ? { contentType: 'video/webm', body: readFileSync(path.join(ROOT, 'test/fixtures/vod.webm')) }
    : { contentType: 'text/html', body: html }));
  await page.goto('http://settings.test/');
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
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.auto-theater-btn')?.getAttribute('aria-pressed') === 'true');
  }
}

async function toggle(page: Page, surface: 'options' | 'player'): Promise<void> {
  if (surface === 'options') await page.locator('label[for=auto-enter-theater-toggle]').click();
  else await page.locator('.auto-theater-btn').evaluate((button: HTMLElement) => button.click());
}

for (const engine of [chromium, firefox]) {
  for (const surface of ['options', 'player'] as const) {
    it(`${engine.name()}: ${surface} offers the launcher once, respects No and updates other tabs after Yes`, { timeout: 60_000 }, async t => {
      const browser = await engine.launch(); ownTestBrowser(t, browser);
      const context = await browser.newContext({ reducedMotion: 'reduce' });
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
      await browser.close();
    });
  }

  it(`${engine.name()}: cancels stale offers and treats Escape as a remembered No`, { timeout: 60_000 }, async t => {
    const browser = await engine.launch(); ownTestBrowser(t, browser);
    const context = await browser.newContext({ reducedMotion: 'reduce' });
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
    await browser.close();
  });
}
