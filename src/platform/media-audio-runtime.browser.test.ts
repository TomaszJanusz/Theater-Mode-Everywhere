import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it, type TestContext } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { fixtureDataUrl, installRuntime, openWatchPage } from '../test-utils/audio-runtime-harness';
import { nativeAudioLaunchOptions, requireAudioSink } from '../test-utils/audio-sink';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { testEngines } from '../test-utils/test-engines';

// The native lane: real Web Audio, real playback and a real output device. Keep it
// small. The suspend/resume/retire rules run in node (media-audio-lifecycle.test.ts)
// and the DOM wiring against a controlled context in
// media-audio-runtime-wiring.browser.test.ts; this file proves that the real browsers
// honour them and that the effects are audible in the spectrum.
const VOD = fixtureDataUrl('vod.webm');
const TONE = fixtureDataUrl('tone.webm');

type NativeProbe = {
  contexts: AudioContext[]; sources: string[]; gains: GainNode[]; outputs: AudioNode[]; ready: number;
  analysers?: AnalyserNode[];
};
declare global {
  interface Window { nativeAudioProbe: NativeProbe }
}

const engines = { chromium, firefox };

/** Records the runtime's contexts, sources, gains and the nodes it connects to the destination. */
async function observeAudio(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = window.nativeAudioProbe = { contexts: [], sources: [], gains: [], outputs: [], ready: 0 } as NativeProbe;
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor() {
        super();
        probe.contexts.push(this);
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
    const connect = AudioNode.prototype.connect as (this: AudioNode, ...args: unknown[]) => unknown;
    AudioNode.prototype.connect = function(this: AudioNode, ...args: unknown[]) {
      if (args[0] instanceof AudioDestinationNode) probe.outputs.push(this);
      return connect.apply(this, args);
    } as typeof AudioNode.prototype.connect;
    window.addEventListener('theater-everywhere-boost-ready', () => probe.ready++);
  });
}

async function boot(context: Awaited<ReturnType<ReturnType<typeof sharedTestBrowser>['newContext']>>, media: string): Promise<Page> {
  await requireAudioSink(context);
  const page = await context.newPage();
  await openWatchPage(page);
  await observeAudio(page);
  await installRuntime(page, media);
  return page;
}

const BANDS = [80, 440, 880] as const;
type Band = typeof BANDS[number];
/** Band power in dB per channel, comparable between readings of the same run. */
type Spectrum = Record<'left' | 'right', Record<Band, number>>;

/** Puts one analyser per channel after the runtime's last node, i.e. behind gain and effects. */
async function tapOutput(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = window.nativeAudioProbe;
    const output = probe.outputs[0];
    const context = output.context as AudioContext;
    const split = context.createChannelSplitter(2);
    probe.analysers = [0, 1].map(channel => {
      const analyser = context.createAnalyser();
      analyser.fftSize = 8192;
      analyser.smoothingTimeConstant = 0;
      split.connect(analyser, channel);
      return analyser;
    });
    output.connect(split);
  });
}

const SETTLE_STEP_SECONDS = 0.3;
const SETTLE_TOLERANCE_DB = 0.4;
/** Bands this far below the loudest one are leakage and codec noise, not signal. */
const AUDIBLE_FLOOR_DB = -45;

async function spectrumNow(page: Page): Promise<Spectrum> {
  return page.evaluate(bands => {
    const [left, right] = window.nativeAudioProbe.analysers!.map(analyser => {
      const data = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(data);
      const rate = analyser.context.sampleRate;
      return Object.fromEntries(bands.map(hz => {
        const center = Math.round(hz * analyser.fftSize / rate);
        let power = 0;
        for (let bin = center - 3; bin <= center + 3; bin++) power += 10 ** (data[bin] / 10);
        return [hz, 10 * Math.log10(power)];
      })) as Record<number, number>;
    });
    return { left, right } as Spectrum;
  }, BANDS);
}

const audibleBands = (spectrum: Spectrum) => [...Object.values(spectrum.left), ...Object.values(spectrum.right)];

/**
 * Reads the spectrum once fades, glides and compressors have settled: successive
 * readings, one step of audio time apart, agree on every audible band.
 */
async function settledSpectrum(page: Page): Promise<Spectrum> {
  let previous: Spectrum | undefined;
  for (let reads = 0; reads < 20; reads++) {
    const until = await page.evaluate(step => window.nativeAudioProbe.contexts[0].currentTime + step, SETTLE_STEP_SECONDS);
    await page.waitForFunction(until => window.nativeAudioProbe.contexts[0].currentTime >= until, until);
    const current = await spectrumNow(page);
    if (previous) {
      const before = audibleBands(previous);
      const now = audibleBands(current);
      const floor = Math.max(...now) + AUDIBLE_FLOOR_DB;
      if (now.every((level, index) => level < floor || Math.abs(level - before[index]) <= SETTLE_TOLERANCE_DB)) return current;
    }
    previous = current;
  }
  throw new Error(`The spectrum did not settle: ${JSON.stringify(previous)}`);
}

async function applyAudio(page: Page, settings: Record<string, string>): Promise<void> {
  await page.evaluate(settings => {
    const video = document.querySelector<HTMLVideoElement>('#first')!;
    Object.assign(video.dataset, settings);
    video.dispatchEvent(new CustomEvent('theater-everywhere-audio', { bubbles: true, composed: true }));
  }, settings);
}

for (const engine of testEngines()) {
  describe(`media audio runtime in ${engine}`, () => {
    const shared = sharedTestBrowser(engines[engine], nativeAudioLaunchOptions(engine));
    const installed = existsSync(engines[engine].executablePath());
    const open = async (t: TestContext, media = VOD) => boot(await shared.newContext(t), media);

    it('creates one graph on activation and reuses it for gain, effects and reentry', { timeout: 60_000, skip: !installed && `${engine} is not installed` }, async t => {
      const page = await open(t);
      await page.evaluate(() => {
        const video = document.querySelector<HTMLVideoElement>('#first')!;
        video.dataset.theaterVoice = 'light';
        video.dataset.theaterBoost = '1.8';
        video.dispatchEvent(new CustomEvent('theater-everywhere-audio', { bubbles: true, composed: true }));
        window.dispatchEvent(new CustomEvent('theater-everywhere-boost-event'));
      });
      assert.equal(await page.evaluate(() => window.nativeAudioProbe.contexts.length), 0, 'synthetic settings do not start a context');
      await page.click('#gesture');
      assert.equal(await page.locator('#first').getAttribute('data-theater-boost-ready'), 'true');
      assert.equal(await page.evaluate(() => window.nativeAudioProbe.gains.at(-1)?.gain.value), Math.fround(1.8));
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
        const released = window.nativeAudioProbe.gains.at(-1)!.gain.value;
        video.classList.add('theater-everywhere-video-active');
        document.documentElement.classList.add('theater-everywhere-html-active');
        video.dataset.theaterBoost = '2';
        window.dispatchEvent(new CustomEvent('theater-everywhere-boost-event'));
        return released;
      });
      assert.equal(releasedGain, 1, 'neutral reset restores native gain before reentry');
      await page.click('#gesture');
      assert.deepEqual(await page.evaluate(() => ({
        contexts: window.nativeAudioProbe.contexts.length,
        sources: window.nativeAudioProbe.sources,
        ready: window.nativeAudioProbe.ready
      })), { contexts: 1, sources: ['first'], ready: 1 });
      assert.equal(await page.evaluate(() => window.nativeAudioProbe.gains.at(-1)?.gain.value), 2);
    });

    it('suspends paused media, resumes playback, and retires only detached players', { timeout: 60_000, skip: !installed && `${engine} is not installed` }, async t => {
      const page = await open(t);
      const contextState = () => page.evaluate(() => window.nativeAudioProbe.contexts[0].state);
      const untilState = (state: AudioContextState, index = 0) => page.waitForFunction(
        ([state, index]) => window.nativeAudioProbe.contexts[index as number].state === state, [state, index] as const);
      await page.evaluate(() => { document.querySelector<HTMLVideoElement>('#first')!.dataset.theaterBoost = '2'; });
      await page.click('#gesture');
      await untilState('suspended');
      await page.click('#gesture');
      await untilState('suspended');
      assert.equal(await page.locator('#first').evaluate(video => (video as HTMLVideoElement).paused), true, 'gestures do not restart paused media');
      await page.evaluate(async () => {
        const video = document.querySelector<HTMLVideoElement>('#first')!;
        video.loop = true;
        await video.play();
      });
      await untilState('running');
      await page.evaluate(() => document.querySelector<HTMLVideoElement>('#first')!.load());
      await untilState('suspended');
      await page.evaluate(async () => { await document.querySelector<HTMLVideoElement>('#first')!.play(); });
      await untilState('running');
      await page.evaluate(() => {
        const video = document.querySelector<HTMLVideoElement>('#first')!;
        video.pause();
        // Resume immediately to exercise asynchronous suspend/resume reconciliation.
        void video.play();
      });
      await page.waitForFunction(() => !document.querySelector<HTMLVideoElement>('#first')!.paused && window.nativeAudioProbe.contexts[0].state === 'running');
      await page.evaluate(() => document.querySelector<HTMLVideoElement>('#first')!.pause());
      await untilState('suspended');
      await page.evaluate(() => {
        const video = document.querySelector<HTMLVideoElement>('#first')!;
        const host = document.createElement('div');
        document.body.append(host);
        host.attachShadow({ mode: 'open' }).append(video);
      });
      await page.evaluate(() => Promise.resolve());
      assert.equal(await contextState(), 'suspended', 'moving a player preserves its source');
      await page.evaluate(async () => {
        const video = document.querySelector('div')!.shadowRoot!.querySelector<HTMLVideoElement>('video')!;
        await video.play();
      });
      await untilState('running');
      await page.evaluate(() => {
        const video = document.querySelector('div')!.shadowRoot!.querySelector<HTMLVideoElement>('video')!;
        video.remove(); // Removal inside the shadow tree must be observed too.
        const second = document.querySelector<HTMLVideoElement>('#second')!;
        second.classList.add('theater-everywhere-video-active');
        second.dataset.theaterBoost = '1.5';
      });
      await untilState('closed');
      await page.click('#gesture');
      assert.deepEqual(await page.evaluate(() => window.nativeAudioProbe.sources), ['first', 'second']);
      await page.evaluate(async () => { await document.querySelector<HTMLVideoElement>('#second')!.play(); });
      await untilState('running', 1);
    });

    it('plays the stereo tone fixture through gain, bass and voice, audible in the spectrum', { timeout: 60_000, skip: !installed && `${engine} is not installed` }, async t => {
      const page = await open(t, TONE);
      await page.evaluate(() => { document.querySelector<HTMLVideoElement>('#first')!.dataset.theaterBoost = '1.5'; });
      await page.click('#gesture');
      await page.evaluate(async () => {
        const video = document.querySelector<HTMLVideoElement>('#first')!;
        video.loop = true;
        await video.play();
      });
      await page.waitForFunction(() => window.nativeAudioProbe.contexts[0]?.state === 'running');
      await tapOutput(page);

      // Fixture: left 440 Hz and right 880 Hz at 0.3, both channels 80 Hz at 0.15 (6 dB lower).
      // Levels are compared inside one run; absolute dB depends on the engine's FFT scaling.
      const plain = await settledSpectrum(page);
      assert.ok(Math.abs(plain.left[440] - plain.left[80] - 6) < 1.5 && Math.abs(plain.right[880] - plain.right[80] - 6) < 1.5,
        'the fixture decodes with its designed levels');
      assert.ok(plain.left[440] - plain.right[440] > 40 && plain.right[880] - plain.left[880] > 40, 'the channels stay separate through the neutral graph');

      await applyAudio(page, { theaterBoost: '3' });
      const boosted = await settledSpectrum(page);
      for (const [channel, hz] of [['left', 80], ['left', 440], ['right', 80], ['right', 880]] as const) {
        const lift = boosted[channel][hz] - plain[channel][hz];
        assert.ok(Math.abs(lift - 6.02) < 1, `doubling the boost lifts ${channel} ${hz} Hz by 6 dB, not ${lift.toFixed(2)}`);
      }

      await applyAudio(page, { theaterBoost: '1.5', theaterBass: 'more' });
      const bass = await settledSpectrum(page);
      for (const channel of ['left', 'right'] as const) {
        const lift = bass[channel][80] - plain[channel][80];
        assert.ok(lift > 4 && lift < 7, `bass +6 dB lifts ${channel} 80 Hz by about 5.5 dB, not ${lift.toFixed(2)}`);
      }
      assert.ok(Math.abs(bass.left[440] - plain.left[440]) < 1 && Math.abs(bass.right[880] - plain.right[880]) < 1, 'bass leaves the tones above the shelf alone');

      await applyAudio(page, { theaterBass: 'original', theaterVoice: 'strong' });
      const voice = await settledSpectrum(page);
      // Voice narrows the stereo image: part of each channel's tone moves into the other one (about -5 dB and -3 dB).
      const leak = [voice.right[440] - voice.left[440], voice.left[880] - voice.right[880]];
      assert.ok(leak.every(difference => difference > -9 && difference < -2), `voice narrows the stereo image, leaking ${leak.map(difference => difference.toFixed(1))} dB`);
      // and lifts the dialogue band relative to the centred bass (about +3 dB).
      const dialogue = (voice.right[880] - voice.right[80]) - (plain.right[880] - plain.right[80]);
      assert.ok(dialogue > 1.5 && dialogue < 5, `voice lifts 880 Hz over 80 Hz by about 3 dB, not ${dialogue.toFixed(2)}`);

      await applyAudio(page, { theaterVoice: 'off' });
      const reset = await settledSpectrum(page);
      for (const [channel, hz] of [['left', 80], ['left', 440], ['right', 80], ['right', 880]] as const) {
        assert.ok(Math.abs(reset[channel][hz] - plain[channel][hz]) < 1, `neutral settings restore ${channel} ${hz} Hz`);
      }
      assert.ok(reset.left[440] - reset.right[440] > 40, 'neutral settings restore the channel separation');
    });
  });
}
