import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';

import { chromium, firefox, type BrowserContext, type Page } from 'playwright';

import { AUDIO_RUNTIME_BUNDLE, fixtureDataUrl, installRuntime, openWatchPage } from '../test-utils/audio-runtime-harness';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { testEngines } from '../test-utils/test-engines';

// DOM wiring of the audio runtime (events, observers, activation, frames) against a
// controlled AudioContext. No native audio is involved, so these cases need no audio
// server. The suspend/resume/retire rules themselves are covered in node by
// media-audio-lifecycle.test.ts; real playback lives in media-audio-runtime.browser.test.ts.
const MEDIA = fixtureDataUrl('vod.webm');

type Probe = {
  contexts: Array<{ state: AudioContextState; setState(state: AudioContextState): void }>;
  sources: string[]; gains: Array<{ gain: { value: number } }>; ready: number;
  startState: AudioContextState; autoplayPolicy?: string; holdResume: boolean;
  resumeCalls: number; suspendCalls: number; releaseResume?: () => void;
};
declare global {
  interface Window { audioRuntimeProbe: Probe }
}

/** Page script: a context whose state, resume completion and policy the test controls. */
const CONTROLLED_AUDIO_CONTEXT = `(() => {
  const probe = window.audioRuntimeProbe = {
    contexts: [], sources: [], gains: [], ready: 0, startState: 'suspended', autoplayPolicy: undefined,
    holdResume: false, resumeCalls: 0, suspendCalls: 0, releaseResume: undefined
  };
  Object.defineProperty(navigator, 'getAutoplayPolicy', { value: () => probe.autoplayPolicy, configurable: true });
  const param = () => ({ value: 0, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} });
  const node = () => {
    const created = { connect: target => target, disconnect() {} };
    for (const name of ['gain', 'frequency', 'Q', 'threshold', 'knee', 'ratio', 'attack', 'release']) created[name] = param();
    return created;
  };
  window.AudioContext = class extends EventTarget {
    state = probe.startState;
    currentTime = 0;
    destination = node();
    constructor() { super(); probe.contexts.push(this); }
    setState(state) {
      if (this.state === state) return;
      this.state = state;
      this.dispatchEvent(new Event('statechange'));
    }
    resume() {
      probe.resumeCalls++;
      return new Promise(resolve => {
        const complete = () => { if (this.state !== 'closed') this.setState('running'); resolve(); };
        if (probe.holdResume) {
          probe.holdResume = false;
          probe.releaseResume = () => { delete probe.releaseResume; complete(); };
        } else complete();
      });
    }
    suspend() {
      probe.suspendCalls++;
      if (this.state !== 'closed') this.setState('suspended');
      return Promise.resolve();
    }
    close() { this.setState('closed'); return Promise.resolve(); }
    createGain() { const gain = node(); probe.gains.push(gain); return gain; }
    createBiquadFilter() { return node(); }
    createDynamicsCompressor() { return node(); }
    createWaveShaper() { return node(); }
    createChannelSplitter() { return node(); }
    createChannelMerger() { return node(); }
    createMediaElementSource(media) { probe.sources.push(media.id); return node(); }
  };
  window.addEventListener('theater-everywhere-boost-ready', () => probe.ready++);
})()`;

async function boot(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await openWatchPage(page);
  await page.evaluate(CONTROLLED_AUDIO_CONTEXT);
  await installRuntime(page, MEDIA);
  return page;
}

const engines = { chromium, firefox };
for (const engine of testEngines()) {
  describe(`media audio runtime wiring in ${engine}`, () => {
    const shared = sharedTestBrowser(engines[engine]);
    const open = async (t: Parameters<typeof shared.newContext>[0]) => {
      const context = await shared.newContext(t);
      return boot(context);
    };
    const installed = existsSync(engines[engine].executablePath());

    it('does not scan shadow trees outside theater and caches the active video', { timeout: 60_000, skip: !installed && `${engine} is not installed` }, async t => {
      const page = await open(t);
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
    });

    it('reconciles auto-resume, pause and removal around an asynchronous resume', { timeout: 60_000, skip: !installed && `${engine} is not installed` }, async t => {
      const page = await open(t);
      await page.evaluate(() => { document.querySelector<HTMLVideoElement>('#first')!.dataset.theaterBoost = '2'; });
      await page.click('#gesture');
      assert.equal(await page.evaluate(() => window.audioRuntimeProbe.contexts[0].state), 'suspended');
      // The browser can resume a context on a gesture even though the media is paused.
      await page.evaluate(() => window.audioRuntimeProbe.contexts[0].setState('running'));
      assert.deepEqual(await page.evaluate(() => ({
        state: window.audioRuntimeProbe.contexts[0].state, suspends: window.audioRuntimeProbe.suspendCalls
      })), { state: 'suspended', suspends: 1 }, 'the statechange listener suspends paused media again');
      assert.equal(await page.locator('#first').evaluate(video => (video as HTMLVideoElement).paused), true, 'auto-resume cannot restart paused media');
      for (const action of ['pause', 'remove'] as const) {
        await page.evaluate(async () => {
          window.audioRuntimeProbe.holdResume = true;
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
      })), { resumes: 2, suspends: 2 }, 'a pause during resume suspends again; a retired player is left alone');
    });

    it('starts saved effects on audible autoplay without activation only when the context may run', { timeout: 60_000, skip: !installed && `${engine} is not installed` }, async t => {
      const page = await open(t);
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
    });

    it('uses the iframe session marker independently of its parent', { timeout: 60_000, skip: !installed && `${engine} is not installed` }, async t => {
      const page = await open(t);
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
      await frame.evaluate(CONTROLLED_AUDIO_CONTEXT);
      await frame.evaluate(media => {
        const video = document.querySelector('video')!;
        video.src = media;
        video.dataset.theaterBoost = '2';
        Object.defineProperty(navigator, 'userActivation', { value: { isActive: false }, configurable: true });
      }, MEDIA);
      await frame.waitForFunction(() => document.querySelector('video')!.readyState >= 1);
      await frame.addScriptTag({ content: AUDIO_RUNTIME_BUNDLE });
      await frame.evaluate(() => window.AudioRuntime.installMediaAudioRuntime());
      await frame.click('#gesture');
      assert.equal(await frame.locator('video').getAttribute('data-theater-boost-ready'), null);
      await frame.evaluate(() => document.documentElement.classList.add('theater-everywhere-html-active'));
      await frame.click('#gesture');
      assert.equal(await frame.locator('video').getAttribute('data-theater-boost-ready'), 'true');
    });

    it('discards metadata activation from a replaced player and leaves neutral media alone', { timeout: 60_000, skip: !installed && `${engine} is not installed` }, async t => {
      const page = await open(t);
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
    });
  });
}
