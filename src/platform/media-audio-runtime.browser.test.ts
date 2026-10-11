import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import type { Page } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const esbuild = require(createRequire(require.resolve('vite')).resolve('esbuild')) as {
  buildSync(options: Record<string, unknown>): { outputFiles: Array<{ text: string }> };
};
const BUNDLE = esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'src/platform/media-audio-runtime.ts')],
  bundle: true, write: false, format: 'iife', globalName: 'AudioRuntime', platform: 'browser', target: 'es2022'
}).outputFiles[0].text;
const MEDIA = `data:video/webm;base64,${readFileSync(path.join(ROOT, 'test/fixtures/vod.webm')).toString('base64')}`;

declare global {
  interface Window {
    AudioRuntime: typeof import('./media-audio-runtime');
    audioRuntimeProbe: { contexts: AudioContext[]; sources: string[]; gains: GainNode[]; ready: number };
  }
}

async function boot(page: Page): Promise<void> {
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  page.on('pageerror', error => console.error(error.message));
  await page.route('https://watch.example/', route => route.fulfill({
    contentType: 'text/html',
    body: '<button id="gesture">Apply</button><video id="first" class="theater-everywhere-video-active"></video><video id="second"></video>'
  }));
  await page.goto('https://watch.example/');
  await page.evaluate(media => {
    // Playwright evaluation itself can grant transient activation. Force
    // the deferred branch; trusted pointer/key events still activate it.
    Object.defineProperty(navigator, 'userActivation', { value: { isActive: false }, configurable: true });
    for (const video of document.querySelectorAll('video')) video.src = media;
    const probe = window.audioRuntimeProbe = { contexts: [] as AudioContext[], sources: [] as string[], gains: [] as GainNode[], ready: 0 };
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor() { super(); probe.contexts.push(this); }
      override createMediaElementSource(media: HTMLMediaElement): MediaElementAudioSourceNode {
        probe.sources.push(media.id);
        return super.createMediaElementSource(media);
      }
      override createGain(): GainNode {
        const gain = super.createGain();
        probe.gains.push(gain);
        return gain;
      }
    };
    window.addEventListener('theater-everywhere-boost-ready', () => probe.ready++);
  }, MEDIA);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('video')).every(video => video.readyState >= 1));
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(() => window.AudioRuntime.installMediaAudioRuntime());
}

for (const engine of ['chromium', 'firefox'] as const) {
  describe(`media audio runtime in ${engine}`, () => {
    it('creates one graph on activation and reuses it for gain, effects and reentry', { timeout: 60_000 }, async t => {
      const browserType = (await import('playwright'))[engine];
      if (!existsSync(browserType.executablePath())) { t.skip(`${engine} is not installed`); return; }
      const browser = await browserType.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await boot(page);
        await page.evaluate(() => {
          const video = document.querySelector<HTMLVideoElement>('#first')!;
          video.dataset.theaterVoice = 'light';
          video.dataset.theaterBoost = '1.8';
          video.dispatchEvent(new CustomEvent('theater-everywhere-audio', { bubbles: true, composed: true }));
          window.dispatchEvent(new CustomEvent('theater-everywhere-boost-event'));
        });
        assert.equal(await page.evaluate(() => window.audioRuntimeProbe.contexts.length), 0, 'synthetic settings do not start a suspended context');
        await page.click('#gesture');
        assert.equal(await page.locator('#first').getAttribute('data-theater-boost-ready'), 'true');
        assert.equal(await page.evaluate(() => window.audioRuntimeProbe.gains.at(-1)?.gain.value), Math.fround(1.8));
        const releasedGain = await page.evaluate(() => {
          const video = document.querySelector<HTMLVideoElement>('#first')!;
          for (const voice of ['strong', 'off', 'light']) {
            video.dataset.theaterVoice = voice;
            video.dataset.theaterBass = 'more';
            video.dataset.theaterLeveling = 'strong';
            video.dispatchEvent(new CustomEvent('theater-everywhere-audio', { bubbles: true, composed: true }));
          }
          video.classList.remove('theater-everywhere-video-active');
          Object.assign(video.dataset, { theaterVoice: 'off', theaterBass: 'original', theaterLeveling: 'off', theaterBoost: '1' });
          video.dispatchEvent(new CustomEvent('theater-everywhere-audio', { bubbles: true, composed: true }));
          const released = window.audioRuntimeProbe.gains.at(-1)!.gain.value;
          video.classList.add('theater-everywhere-video-active');
          video.dataset.theaterBoost = '2';
          window.dispatchEvent(new CustomEvent('theater-everywhere-boost-event'));
          return released;
        });
        assert.equal(releasedGain, 1, 'neutral reset restores native gain before reentry');
        await page.click('#gesture');
        assert.deepEqual(await page.evaluate(() => ({
          contexts: window.audioRuntimeProbe.contexts.length,
          sources: window.audioRuntimeProbe.sources,
          ready: window.audioRuntimeProbe.ready
        })), { contexts: 1, sources: ['first'], ready: 1 });
        assert.equal(await page.evaluate(() => window.audioRuntimeProbe.gains.at(-1)?.gain.value), 2);
      } finally { await browser.close(); }
    });

    it('discards metadata activation from a replaced player and leaves neutral media alone', { timeout: 60_000 }, async t => {
      const browserType = (await import('playwright'))[engine];
      if (!existsSync(browserType.executablePath())) { t.skip(`${engine} is not installed`); return; }
      const browser = await browserType.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await boot(page);
        await page.evaluate(() => {
          const first = document.querySelector<HTMLVideoElement>('#first')!;
          first.removeAttribute('src');
          first.load();
          first.dataset.theaterVoice = 'strong';
          first.dispatchEvent(new CustomEvent('theater-everywhere-audio', { bubbles: true, composed: true }));
          first.classList.remove('theater-everywhere-video-active');
          const second = document.querySelector<HTMLVideoElement>('#second')!;
          second.classList.add('theater-everywhere-video-active');
          second.dataset.theaterBass = 'more';
          document.querySelector<HTMLButtonElement>('#gesture')!.onclick = () => {
            first.dispatchEvent(new Event('loadedmetadata'));
            first.dataset.theaterVoice = 'off';
            first.dispatchEvent(new CustomEvent('theater-everywhere-audio', { bubbles: true, composed: true }));
          };
        });
        await page.click('#gesture');
        assert.deepEqual(await page.evaluate(() => window.audioRuntimeProbe.sources), ['second']);
        assert.equal(await page.locator('#first').getAttribute('data-theater-boost-ready'), null);
      } finally { await browser.close(); }
    });
  });
}
