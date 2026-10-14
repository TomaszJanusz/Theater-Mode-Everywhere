import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { Page } from 'playwright';
import { readStylesheet } from '../test-utils/styles';

const require = createRequire(import.meta.url);
const SRC = new URL('../', import.meta.url).pathname;
const PAGE_CSS = readStylesheet(path.join(SRC, 'content.css'));
const UI_CSS = readStylesheet(path.join(SRC, 'ui/shadow.css'));
const esbuild = require('esbuild') as { buildSync(options: object): { outputFiles: Array<{ text: string }> } };
const BUNDLE = esbuild.buildSync({
  stdin: {
    contents: [
      "export { bootstrapPlayerRuntime } from './ui/player-runtime';",
      "export { setPlayerUiCss } from './ui/root';",
      "export { installMainWorldRuntime } from './platform/main-world-runtime';"
    ].join('\n'),
    resolveDir: SRC, loader: 'ts'
  },
  bundle: true, write: false, format: 'iife', globalName: 'PlaybackHudTest',
  platform: 'browser', target: 'es2022', logLevel: 'silent'
}).outputFiles[0].text;

const FIXTURE = `<!doctype html><html><head><title>Playback HUD fixture</title>
  <style>body { margin:0; background:#111; } video { width:960px; height:540px; }</style>
  </head><body><video id="player" title="Playback HUD regression" muted playsinline></video>
  <script>
    const canvas = document.createElement('canvas');
    canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1c2634'; ctx.fillRect(0, 0, 1280, 720);
    const video = document.querySelector('video');
    video.srcObject = canvas.captureStream(12);
    setInterval(() => { ctx.fillRect(0, 0, 1, 1); }, 100);
    video.play();
  </script></body></html>`;

/**
 * Starts theater mode on a playing local video with the play/pause key on K.
 * @param page Browser page containing the local video fixture.
 * @returns When the theater controls have mounted and playback has started.
 */
async function boot(page: Page, settings: Record<string, unknown> = {}): Promise<void> {
  await page.evaluate(`window.chrome = { storage: {
    sync: {
      get: async () => ({ keepControlsVisible: true, shortcuts: { playPause: 'k' }, ...${JSON.stringify(settings)} }),
      set: async () => {}
    },
    onChanged: { addListener() {} }
  } };`);
  await page.addStyleTag({ content: PAGE_CSS });
  await page.addScriptTag({ content: BUNDLE });
  if (settings.volumeBoostEnabled) await page.evaluate('PlaybackHudTest.installMainWorldRuntime();');
  await page.evaluate(`PlaybackHudTest.setPlayerUiCss(${JSON.stringify(UI_CSS)}); PlaybackHudTest.bootstrapPlayerRuntime();`);
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return Boolean(video && video.readyState >= 2 && !video.paused);
  });
  await page.keyboard.press('t');
  await page.locator('.theater-controls-wrapper.visible').waitFor();
}

/**
 * Waits until exactly one playback HUD is showing the expected label.
 * @param page Theater page under test.
 * @param text Expected play or pause label.
 * @returns When the overlay is present and not fading out.
 */
async function waitForHud(page: Page, text: string): Promise<void> {
  await page.waitForFunction((expected) => {
    const nodes = document.querySelector('#theater-everywhere-ui')?.shadowRoot
      ?.querySelectorAll('.theater-everywhere-volume-overlay') ?? [];
    if (nodes.length !== 1) return false;
    const overlay = nodes[0];
    const label = overlay.querySelector('.volume-hud-text')?.textContent;
    return label === expected && !overlay.classList.contains('fade-out');
  }, text);
}

describe('playback HUD browser regressions', () => {
  for (const engine of ['chromium', 'firefox'] as const) {
    it(`keeps boosted HUD and toolbar speakers orange over a green accent in ${engine}`, { timeout: 60_000 }, async () => {
      const browserType = (await import('playwright'))[engine];
      assert.ok(existsSync(browserType.executablePath()), `${engine} must be installed`);
      const browser = await browserType.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        await page.route('http://playback-hud.test/**', route => route.fulfill({ contentType: 'text/html', body: FIXTURE }));
        await page.goto('http://playback-hud.test/');
        await boot(page, { volumeBoostEnabled: true, accentColor: 'green' });
        const slider = page.locator('.theater-volume-slider');
        const speaker = page.locator('.volume-btn');
        const setVolume = (value: string) => slider.evaluate((input: HTMLInputElement, value) => {
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, value);
        await setVolume('1.25');
        // The trusted key can create the first Web Audio graph in either engine.
        await page.keyboard.press('ArrowUp');
        await waitForHud(page, '220%');
        await speaker.hover();
        const colors = () => page.evaluate(() => {
          const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
          return {
            speaker: getComputedStyle(root.querySelector('.volume-btn svg')!).color,
            hud: getComputedStyle(root.querySelector('.volume-hud-icon svg')!).color,
            text: getComputedStyle(root.querySelector('.volume-hud-text')!).color
          };
        });
        assert.deepEqual(await colors(), { speaker: 'rgb(245, 158, 11)', hud: 'rgb(245, 158, 11)', text: 'rgb(245, 158, 11)' });
        await speaker.focus();
        await page.mouse.move(80, 80);
        assert.equal((await colors()).speaker, 'rgb(245, 158, 11)', 'focus must not replace the boost color');
        if (process.env.THEATER_ICON_SCREENSHOTS) {
          await page.screenshot({ path: path.join(process.env.THEATER_ICON_SCREENSHOTS, `${engine}-boosted.png`) });
        }
        await page.keyboard.press('m');
        await page.locator('.volume-btn:not(.boosted)').waitFor();
        assert.equal((await colors()).speaker, 'rgb(81, 205, 0)', 'mute must clear orange even with remembered boost');
        await page.keyboard.press('m');
        await page.locator('.volume-btn.boosted').waitFor();
        assert.equal((await colors()).speaker, 'rgb(245, 158, 11)', 'unmute must restore orange');
        await setVolume('1');
        assert.equal(await speaker.evaluate(button => button.classList.contains('boosted')), false, 'returning to 100% must clear boost without another media event');
        await page.keyboard.press('ArrowDown');
        await waitForHud(page, '95%');
        assert.equal((await colors()).hud, 'rgb(81, 205, 0)', 'normal-volume HUD must use the saved accent');
        assert.equal((await colors()).speaker, 'rgb(81, 205, 0)');
      } finally {
        await browser.close();
      }
    });
  }

  it('shows the play/pause HUD for the control, the video surface, and the shortcut', async t => {
    const { chromium } = await import('playwright');
    if (!existsSync(chromium.executablePath())) { t.skip('Chromium is not installed'); return; }
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('http://playback-hud.test/**', route => route.fulfill({
        contentType: 'text/html',
        body: FIXTURE
      }));
      await page.goto('http://playback-hud.test/');
      await boot(page);

      await page.locator('.play-pause-btn').click();
      await waitForHud(page, 'Pause');
      assert.equal(await page.locator('video').evaluate(node => (node as HTMLVideoElement).paused), true);

      await page.locator('video').click({ position: { x: 80, y: 80 } });
      await waitForHud(page, 'Play');
      assert.equal(await page.locator('video').evaluate(node => (node as HTMLVideoElement).paused), false);

      await page.keyboard.press('k');
      await waitForHud(page, 'Pause');
      assert.equal(await page.locator('video').evaluate(node => (node as HTMLVideoElement).paused), true);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  });

  for (const engine of ['chromium', 'firefox'] as const) {
    it(`dismisses settings, speed, and volume on a video click without pausing in ${engine}`, async () => {
      const browserType = (await import('playwright'))[engine];
      assert.ok(existsSync(browserType.executablePath()), `${engine} must be installed`);
      const browser = await browserType.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('http://playback-hud.test/**', route => route.fulfill({
          contentType: 'text/html',
          body: FIXTURE
        }));
        await page.goto('http://playback-hud.test/');
        await boot(page);
        const paused = () => page.locator('video').evaluate(node => (node as HTMLVideoElement).paused);
        const clickPicture = () => page.locator('video').click({ position: { x: 120, y: 80 } });
        const panelShown = (selector: string) => page.waitForFunction((panelSelector) => {
          const panel = document.querySelector('#theater-everywhere-ui')?.shadowRoot?.querySelector(panelSelector);
          return panel instanceof HTMLElement && getComputedStyle(panel).opacity === '1';
        }, selector);
        const panelHidden = (selector: string) => page.waitForFunction((panelSelector) => {
          const panel = document.querySelector('#theater-everywhere-ui')?.shadowRoot?.querySelector(panelSelector);
          return panel instanceof HTMLElement && getComputedStyle(panel).opacity === '0';
        }, selector);

        await page.locator('.player-settings-btn').click();
        await page.locator('.theater-settings-menu.visible').waitFor();
        await clickPicture();
        await page.locator('.theater-settings-menu.visible').waitFor({ state: 'hidden' });
        assert.equal(await paused(), false, 'settings dismiss must leave playback running');

        await page.locator('.volume-btn').hover();
        await panelShown('.theater-volume-panel');
        await clickPicture();
        await panelHidden('.theater-volume-panel');
        assert.equal(await paused(), false, 'volume dismiss must leave playback running');

        // This fixture is a live capture, so the speed control stays hidden.
        // Leaving that control uses the same dismiss latch as the volume panel.
        await page.locator('.theater-speed-container').dispatchEvent('pointerleave');
        await clickPicture();
        assert.equal(await paused(), false, 'speed dismiss must leave playback running');

        await clickPicture();
        assert.equal(await paused(), true, 'a later video click still pauses');
        assert.deepEqual(errors, []);
      } finally {
        await browser.close();
      }
    });
  }
});
