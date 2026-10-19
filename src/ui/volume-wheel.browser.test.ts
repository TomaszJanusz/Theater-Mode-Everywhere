import { testEngines } from '../test-utils/test-engines';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { Page } from 'playwright';
import { readStylesheet } from '../test-utils/styles';
import { ownTestBrowser } from '../test-utils/test-browser';

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

const FIXTURE = `<!doctype html><html><head><title>Wheel volume fixture</title>
  <style>body { margin:0; background:#111; } video { width:960px; height:540px; }</style>
  </head><body><video id="player" title="Wheel volume regression" muted playsinline></video>
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
 * Starts theater mode on a playing local video.
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
 * @param text Expected HUD label.
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

describe('wheel volume browser regressions', () => {
  for (const engine of testEngines()) {
    it(`shares keyboard volume behavior and disposes wheel gestures in ${engine}`, { timeout: 60_000 }, async t => {
      const browser = await (await import('playwright'))[engine].launch({ headless: true });
      ownTestBrowser(t, browser);
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.route('http://wheel-volume.test/**', route => route.fulfill({ contentType: 'text/html', body: FIXTURE }));
      await page.goto('http://wheel-volume.test/');
      await boot(page, { volumeBoostEnabled: true });
      await page.keyboard.press('ArrowUp');
      await page.clock.install();
      const speaker = page.locator('.volume-btn');
      const slider = page.locator('.theater-volume-slider');
      const setVolume = async (value: string) => {
        await slider.evaluate((input: HTMLInputElement, value) => {
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, value);
      };
      // Count delivery, including sub-notch input which intentionally has no HUD.
      await speaker.evaluate(button => {
        const container = button.parentElement!;
        container.setAttribute('data-wheel-count', '0');
        container.addEventListener('wheel', () => {
          container.setAttribute('data-wheel-count', String(Number(container.getAttribute('data-wheel-count')) + 1));
        }, true);
      });
      const wheel = async (delta: number) => {
        // Separate notches from the deterministic continuous-gesture checks below.
        await page.clock.runFor(251);
        const container = page.locator('.theater-volume-container');
        const count = Number(await container.getAttribute('data-wheel-count'));
        await page.mouse.wheel(0, delta);
        await page.waitForFunction(expected => document.querySelector('#theater-everywhere-ui')?.shadowRoot
          ?.querySelector('.theater-volume-container')?.getAttribute('data-wheel-count') === String(expected), count + 1);
      };
      await setVolume('0.5');
      await speaker.hover();
      assert.equal(await speaker.evaluate(button => getComputedStyle(button).cursor), 'ns-resize');
      assert.equal(await slider.evaluate(input => getComputedStyle(input).cursor), 'ns-resize');
      for (const control of [speaker, slider]) {
        await control.evaluate(element => { (element as HTMLButtonElement | HTMLInputElement).disabled = true; });
        assert.notEqual(await control.evaluate(element => getComputedStyle(element).cursor), 'ns-resize');
        assert.notEqual(await page.locator('.theater-volume-container').evaluate(element => getComputedStyle(element).cursor), 'ns-resize');
        assert.equal(await control.evaluate(element => element.dispatchEvent(new WheelEvent('wheel', {
          deltaY: -120, bubbles: true, cancelable: true
        }))), true, 'disabled volume controls do not consume gestures');
        await control.evaluate(element => { (element as HTMLButtonElement | HTMLInputElement).disabled = false; });
      }
      const scroll = await page.evaluate(() => scrollY);
      await wheel(-120);
      await waitForHud(page, '55%');
      assert.equal(await slider.inputValue(), '0.55');
      await wheel(120);
      await waitForHud(page, '50%');
      assert.equal(await page.evaluate(() => scrollY), scroll);
      await slider.hover();
      await wheel(-120);
      await waitForHud(page, '55%');
      await wheel(120);
      await waitForHud(page, '50%');
      await page.clock.runFor(251);
      const smallWheel = (deltas: number[]) => slider.evaluate((input, deltas) => {
        const values: string[] = [];
        for (const deltaY of deltas) {
          input.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }));
          values.push((input as HTMLInputElement).value);
        }
        return values;
      }, deltas);
      assert.deepEqual(await smallWheel([-25, -25, -25, -25]), ['0.5', '0.5', '0.5', '0.55']);
      await smallWheel([-50]);
      await page.clock.runFor(251);
      assert.deepEqual(await smallWheel([-50, -50]), ['0.55', '0.6'], 'idle resets the remainder');
      // Leave native browser zoom out of subsequent pointer geometry checks.
      assert.equal(await slider.evaluate(input => input.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true
      }))), true, 'pinch/ctrl-wheel remains available to the browser');
      assert.equal(await slider.inputValue(), '0.6');
      await wheel(-10000);
      await waitForHud(page, '65%');
      await setVolume('1.5');
      await wheel(-120);
      await waitForHud(page, '300%');
      assert.equal(await slider.inputValue(), '1.5');
      await wheel(120);
      await waitForHud(page, '280%');
      await setVolume('0');
      await wheel(120);
      await waitForHud(page, '0%');
      await wheel(-120);
      await waitForHud(page, '5%');
      await speaker.click();
      await speaker.hover();
      await wheel(-120);
      await waitForHud(page, '10%');
      assert.equal(await page.locator('video').evaluate(video => (video as HTMLVideoElement).muted), false);
      // Alternate units and shared-container gap take exactly one step.
      for (const deltaMode of [1, 2]) {
        await page.locator('.theater-volume-container').dispatchEvent('wheel', { deltaY: deltaMode === 1 ? -3 : -1, deltaMode });
      }
      await waitForHud(page, '20%');
      await page.mouse.move(900, 100);
      await page.mouse.wheel(0, -100);
      await page.evaluate(() => new Promise(requestAnimationFrame));
      assert.equal(await slider.inputValue(), '0.2', 'wheel outside volume controls is unchanged');
      // Retain detached controls to prove scope cleanup rather than just removal.
      await speaker.evaluate(button => {
        Reflect.set(window, 'retiredVolume', button.parentElement);
      });
      await page.locator('.close-btn').click();
      await page.locator('.theater-controls-wrapper').waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => {
        const container = Reflect.get(window, 'retiredVolume') as HTMLElement;
        return Array.from(container.querySelectorAll('.volume-btn, input')).every(target =>
          target.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })));
      }), true, 'retired listeners no longer cancel wheel input');
      await page.keyboard.press('t');
      await page.locator('.theater-controls-wrapper.visible').waitFor();
      assert.equal(await page.locator('.theater-volume-slider').inputValue(), '0.2');
    });
  }
});
