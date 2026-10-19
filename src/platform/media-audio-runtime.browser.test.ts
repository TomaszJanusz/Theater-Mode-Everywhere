import { testEngines } from '../test-utils/test-engines';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import type { Page } from 'playwright';
import { ownTestBrowser } from '../test-utils/test-browser';

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
    audioRuntimeProbe: {
      contexts: AudioContext[]; sources: string[]; gains: GainNode[]; ready: number;
      delayNextResume: boolean; resumeCalls: number; suspendCalls: number;
      startState: AudioContextState; autoplayPolicy?: string;
      releaseResume?: () => void;
      autoResume?: () => void;
    };
  }
}

async function boot(page: Page, controlledState = false): Promise<void> {
  await page.addInitScript('window.__name = target => target;');
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  page.on('pageerror', error => console.error(error.message));
  await page.route('https://watch.example/', route => route.fulfill({
    contentType: 'text/html',
    body: '<html class="theater-everywhere-html-active"><button id="gesture">Apply</button><video id="first" class="theater-everywhere-video-active"></video><video id="second"></video>'
  }));
  await page.goto('https://watch.example/');
  await page.evaluate(({ media, controlledState }) => {
    // Playwright evaluation itself can grant transient activation. Force
    // the deferred branch; trusted pointer/key events still activate it.
    Object.defineProperty(navigator, 'userActivation', { value: { isActive: false }, configurable: true });
    for (const video of document.querySelectorAll('video')) video.src = media;
    const probe = window.audioRuntimeProbe = {
      contexts: [] as AudioContext[], sources: [] as string[], gains: [] as GainNode[], ready: 0,
      delayNextResume: false, resumeCalls: 0, suspendCalls: 0,
      startState: 'suspended' as AudioContextState, autoplayPolicy: undefined as string | undefined,
      releaseResume: undefined as (() => void) | undefined,
      autoResume: undefined as (() => void) | undefined
    };
    // Firefox reports whether a context may start; Chromium has no such API.
    if (controlledState) Object.defineProperty(navigator, 'getAutoplayPolicy', { value: () => probe.autoplayPolicy, configurable: true });
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      private simulatedState: AudioContextState = probe.startState;
      constructor() {
        super();
        probe.contexts.push(this);
        // Native autoplay can resume without calling resume(). The delayed-operation
        // case controls state and completion; the other cases use real Web Audio.
        if (controlledState) {
          Object.defineProperty(this, 'state', { get: () => this.simulatedState });
          probe.autoResume = () => {
            this.simulatedState = 'running';
            this.dispatchEvent(new Event('statechange'));
          };
        }
      }
      override resume(): Promise<void> {
        if (!controlledState) return super.resume();
        probe.resumeCalls++;
        return new Promise(resolve => {
          const complete = () => {
            if (this.simulatedState !== 'closed') this.simulatedState = 'running';
            resolve();
          };
          if (probe.delayNextResume) {
            probe.delayNextResume = false;
            probe.releaseResume = () => { delete probe.releaseResume; complete(); };
          } else complete();
        });
      }
      override suspend(): Promise<void> {
        if (!controlledState) return super.suspend();
        probe.suspendCalls++;
        this.simulatedState = 'suspended';
        return Promise.resolve();
      }
      override close(): Promise<void> {
        if (controlledState) this.simulatedState = 'closed';
        return super.close();
      }
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
  }, { media: MEDIA, controlledState });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('video')).every(video => video.readyState >= 1));
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(() => window.AudioRuntime.installMediaAudioRuntime());
}

for (const engine of testEngines()) {
  describe(`media audio runtime in ${engine}`, () => {
    it('creates one graph on activation and reuses it for gain, effects and reentry', { timeout: 60_000 }, async t => {
      const browserType = (await import('playwright'))[engine];
      if (!existsSync(browserType.executablePath())) { t.skip(`${engine} is not installed`); return; }
      const browser = await browserType.launch({ headless: true });
      ownTestBrowser(t, browser);
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
          document.documentElement.classList.remove('theater-everywhere-html-active');
          Object.assign(video.dataset, { theaterVoice: 'off', theaterBass: 'original', theaterLeveling: 'off', theaterBoost: '1' });
          video.dispatchEvent(new CustomEvent('theater-everywhere-audio', { bubbles: true, composed: true }));
          const released = window.audioRuntimeProbe.gains.at(-1)!.gain.value;
          video.classList.add('theater-everywhere-video-active');
          document.documentElement.classList.add('theater-everywhere-html-active');
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

    it('does not scan shadow trees outside theater and caches the active video', { timeout: 60_000 }, async t => {
      const browserType = (await import('playwright'))[engine];
      if (!existsSync(browserType.executablePath())) { t.skip(`${engine} is not installed`); return; }
      const browser = await browserType.launch({ headless: true });
      ownTestBrowser(t, browser);
      try {
        const page = await browser.newPage();
        await boot(page);
        const counts = await page.evaluate(() => {
          const video = document.querySelector<HTMLVideoElement>('#first')!;
          const host = document.createElement('div');
          document.body.append(host);
          host.attachShadow({ mode: 'open' }).append(video);
          let scans = 0;
          const originalDocument = Document.prototype.querySelectorAll;
          const originalShadow = ShadowRoot.prototype.querySelectorAll;
          Document.prototype.querySelectorAll = function<T extends Element>(selector: string) {
            if (selector === '*') scans++;
            return originalDocument.call(this, selector) as NodeListOf<T>;
          };
          ShadowRoot.prototype.querySelectorAll = function<T extends Element>(selector: string) {
            if (selector === '*') scans++;
            return originalShadow.call(this, selector) as NodeListOf<T>;
          };
          const input = () => { for (let i = 0; i < 20; i++) for (const type of ['click', 'keydown', 'pointerdown']) {
            document.body.dispatchEvent(new Event(type, { bubbles: true }));
          } };
          document.documentElement.classList.remove('theater-everywhere-html-active');
          input();
          const outside = scans;
          document.documentElement.classList.add('theater-everywhere-html-active');
          input();
          const entered = scans;
          input();
          const cached = scans;
          document.documentElement.classList.remove('theater-everywhere-html-active');
          input();
          return { outside, entered, cached, exited: scans };
        });
        assert.equal(counts.outside, 0);
        assert.ok(counts.entered > 0, 'the first lookup discovers a shadow video');
        assert.equal(counts.cached, counts.entered);
        assert.equal(counts.exited, counts.entered);
        await page.evaluate(() => {
          document.documentElement.classList.add('theater-everywhere-html-active');
          const video = document.querySelector('div')!.shadowRoot!.querySelector<HTMLVideoElement>('video')!;
          video.dataset.theaterBoost = '2';
        });
        await page.click('#gesture');
        assert.deepEqual(await page.evaluate(() => window.audioRuntimeProbe.sources), ['first']);
      } finally { await browser.close(); }
    });

    it('suspends paused media, resumes playback, and retires only detached players', { timeout: 60_000 }, async t => {
      const browserType = (await import('playwright'))[engine];
      if (!existsSync(browserType.executablePath())) { t.skip(`${engine} is not installed`); return; }
      const browser = await browserType.launch({ headless: true });
      ownTestBrowser(t, browser);
      try {
        const page = await browser.newPage();
        await boot(page);
        await page.evaluate(() => { document.querySelector<HTMLVideoElement>('#first')!.dataset.theaterBoost = '2'; });
        await page.click('#gesture');
        await page.waitForFunction(() => window.audioRuntimeProbe.contexts[0]?.state === 'suspended');
        await page.click('#gesture');
        await page.waitForFunction(() => window.audioRuntimeProbe.contexts[0].state === 'suspended');
        assert.equal(await page.locator('#first').evaluate(video => (video as HTMLVideoElement).paused), true, 'gestures do not restart paused media');
        await page.evaluate(async () => {
          const video = document.querySelector<HTMLVideoElement>('#first')!;
          video.loop = true;
          await video.play();
        });
        await page.waitForFunction(() => window.audioRuntimeProbe.contexts[0].state === 'running');
        await page.evaluate(() => document.querySelector<HTMLVideoElement>('#first')!.load());
        await page.waitForFunction(() => window.audioRuntimeProbe.contexts[0].state === 'suspended');
        await page.evaluate(async () => { await document.querySelector<HTMLVideoElement>('#first')!.play(); });
        await page.waitForFunction(() => window.audioRuntimeProbe.contexts[0].state === 'running');
        await page.evaluate(() => {
          const video = document.querySelector<HTMLVideoElement>('#first')!;
          video.pause();
          // Resume immediately to exercise asynchronous suspend/resume reconciliation.
          void video.play();
        });
        await page.waitForFunction(() => !document.querySelector<HTMLVideoElement>('#first')!.paused && window.audioRuntimeProbe.contexts[0].state === 'running');
        await page.evaluate(() => document.querySelector<HTMLVideoElement>('#first')!.pause());
        await page.waitForFunction(() => window.audioRuntimeProbe.contexts[0].state === 'suspended');
        await page.evaluate(() => {
          const video = document.querySelector<HTMLVideoElement>('#first')!;
          const host = document.createElement('div');
          document.body.append(host);
          host.attachShadow({ mode: 'open' }).append(video);
        });
        await page.evaluate(() => Promise.resolve());
        assert.equal(await page.evaluate(() => window.audioRuntimeProbe.contexts[0].state), 'suspended', 'moving a player preserves its source');
        await page.evaluate(async () => {
          const video = document.querySelector('div')!.shadowRoot!.querySelector<HTMLVideoElement>('video')!;
          await video.play();
        });
        await page.waitForFunction(() => window.audioRuntimeProbe.contexts[0].state === 'running');
        await page.evaluate(() => {
          const video = document.querySelector('div')!.shadowRoot!.querySelector<HTMLVideoElement>('video')!;
          video.remove(); // Removal inside the shadow tree must be observed too.
          const second = document.querySelector<HTMLVideoElement>('#second')!;
          second.classList.add('theater-everywhere-video-active');
          second.dataset.theaterBoost = '1.5';
        });
        await page.waitForFunction(() => window.audioRuntimeProbe.contexts[0].state === 'closed');
        await page.click('#gesture');
        assert.deepEqual(await page.evaluate(() => window.audioRuntimeProbe.sources), ['first', 'second']);
        await page.evaluate(async () => { await document.querySelector<HTMLVideoElement>('#second')!.play(); });
        await page.waitForFunction(() => window.audioRuntimeProbe.contexts[1].state === 'running');
      } finally { await browser.close(); }
    });

    it('reconciles pause and retirement after an asynchronous resume', { timeout: 60_000 }, async t => {
      const browserType = (await import('playwright'))[engine];
      if (!existsSync(browserType.executablePath())) { t.skip(`${engine} is not installed`); return; }
      const browser = await browserType.launch({ headless: true });
      ownTestBrowser(t, browser);
      try {
        const page = await browser.newPage();
        await boot(page, true);
        await page.evaluate(() => { document.querySelector<HTMLVideoElement>('#first')!.dataset.theaterBoost = '2'; });
        await page.click('#gesture');
        await page.waitForFunction(() => window.audioRuntimeProbe.contexts[0]?.state === 'suspended');
        // Autoplay policy and statechange timing vary across native backends.
        // Exercise the browser's external auto-resume notification explicitly.
        await page.evaluate(() => window.audioRuntimeProbe.autoResume!());
        await page.waitForFunction(() => window.audioRuntimeProbe.contexts[0].state === 'suspended'
          && window.audioRuntimeProbe.suspendCalls === 1);
        assert.equal(await page.locator('#first').evaluate(video => (video as HTMLVideoElement).paused), true, 'auto-resume cannot restart paused media');
        for (const action of ['pause', 'remove'] as const) {
          await page.evaluate(async () => {
            window.audioRuntimeProbe.delayNextResume = true;
            const video = document.querySelector<HTMLVideoElement>('#first')!;
            video.loop = true;
            await video.play();
          });
          await page.waitForFunction(() => !!window.audioRuntimeProbe.releaseResume);
          await page.evaluate(action => {
            const video = document.querySelector<HTMLVideoElement>('#first')!;
            if (action === 'pause') video.pause(); else video.remove();
          }, action);
          if (action === 'remove') await page.waitForFunction(() => window.audioRuntimeProbe.contexts[0].state === 'closed');
          await page.evaluate(() => window.audioRuntimeProbe.releaseResume!());
          await page.waitForFunction(state => window.audioRuntimeProbe.contexts[0].state === state, action === 'pause' ? 'suspended' : 'closed');
        }
        assert.deepEqual(await page.evaluate(() => ({
          resumes: window.audioRuntimeProbe.resumeCalls, suspends: window.audioRuntimeProbe.suspendCalls
        })), { resumes: 2, suspends: 2 }, 'auto-resume and late completion suspend paused media and do no work after retirement');
      } finally { await browser.close(); }
    });

    it('starts saved effects on audible autoplay without activation only when the context may run', { timeout: 60_000 }, async t => {
      const browserType = (await import('playwright'))[engine];
      if (!existsSync(browserType.executablePath())) { t.skip(`${engine} is not installed`); return; }
      const browser = await browserType.launch({ headless: true });
      ownTestBrowser(t, browser);
      try {
        const page = await browser.newPage();
        await boot(page, true);
        const applySaved = (id: string) => page.evaluate(id => {
          const video = document.querySelector<HTMLVideoElement>(`#${id}`)!;
          video.dataset.theaterVoice = 'strong';
          video.dispatchEvent(new CustomEvent('theater-everywhere-audio', { bubbles: true, composed: true }));
        }, id);
        // Automatic theater entry: playback started without a gesture.
        await page.evaluate(async () => {
          const video = document.querySelector<HTMLVideoElement>('#first')!;
          video.loop = true;
          await video.play();
        });
        await applySaved('first');
        assert.deepEqual(await page.evaluate(() => ({
          contexts: window.audioRuntimeProbe.contexts.map(context => context.state), sources: window.audioRuntimeProbe.sources
        })), { contexts: ['closed'], sources: [] }, 'a context the policy holds suspended does not capture the media');
        await page.evaluate(() => { window.audioRuntimeProbe.startState = 'running'; });
        await applySaved('first');
        assert.deepEqual(await page.evaluate(() => window.audioRuntimeProbe.sources), ['first'], 'an allowed context starts with the saved settings');
        assert.equal(await page.locator('#first').getAttribute('data-theater-boost-ready'), 'true');

        await page.evaluate(async () => {
          const probe = window.audioRuntimeProbe;
          probe.startState = 'suspended';
          probe.autoplayPolicy = 'allowed';
          document.querySelector('#first')!.classList.remove('theater-everywhere-video-active');
          const second = document.querySelector<HTMLVideoElement>('#second')!;
          second.classList.add('theater-everywhere-video-active');
          second.loop = true;
          await second.play();
        });
        await applySaved('second');
        await page.waitForFunction(() => window.audioRuntimeProbe.contexts.at(-1)!.state === 'running');
        assert.deepEqual(await page.evaluate(() => window.audioRuntimeProbe.sources), ['first', 'second'], 'a reported policy allows a context that starts suspended');
      } finally { await browser.close(); }
    });

    it('uses the iframe session marker independently of its parent', { timeout: 60_000 }, async t => {
      const browserType = (await import('playwright'))[engine];
      if (!existsSync(browserType.executablePath())) { t.skip(`${engine} is not installed`); return; }
      const browser = await browserType.launch({ headless: true });
      ownTestBrowser(t, browser);
      try {
        const page = await browser.newPage();
        await boot(page);
        await page.route('https://frame.example/', route => route.fulfill({ contentType: 'text/html', body: '<button id="gesture">Apply</button><video class="theater-everywhere-video-active"></video>' }));
        await page.evaluate(() => {
          document.documentElement.classList.remove('theater-everywhere-html-active');
          const iframe = document.createElement('iframe');
          iframe.src = 'https://frame.example/';
          document.body.append(iframe);
        });
        const iframe = await page.waitForSelector('iframe');
        const frame = (await iframe.contentFrame())!;
        await frame.waitForSelector('video');
        await frame.evaluate(media => {
          const video = document.querySelector('video')!;
          video.src = media;
          video.dataset.theaterBoost = '2';
          Object.defineProperty(navigator, 'userActivation', { value: { isActive: false }, configurable: true });
        }, MEDIA);
        await frame.waitForFunction(() => document.querySelector('video')!.readyState >= 1);
        await frame.addScriptTag({ content: BUNDLE });
        await frame.evaluate(() => window.AudioRuntime.installMediaAudioRuntime());
        await frame.click('#gesture');
        assert.equal(await frame.locator('video').getAttribute('data-theater-boost-ready'), null);
        await frame.evaluate(() => document.documentElement.classList.add('theater-everywhere-html-active'));
        await frame.click('#gesture');
        assert.equal(await frame.locator('video').getAttribute('data-theater-boost-ready'), 'true');
      } finally { await browser.close(); }
    });

    it('discards metadata activation from a replaced player and leaves neutral media alone', { timeout: 60_000 }, async t => {
      const browserType = (await import('playwright'))[engine];
      if (!existsSync(browserType.executablePath())) { t.skip(`${engine} is not installed`); return; }
      const browser = await browserType.launch({ headless: true });
      ownTestBrowser(t, browser);
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
