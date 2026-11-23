import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { after, before, describe, it, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { Page } from 'playwright';

import { sharedEngineBrowsers } from '../test-utils/engine-browsers';
import { bundleModules } from '../test-utils/player-boot';
import { testEngines } from '../test-utils/test-engines';

// The real worklet module and the shipped DSP, served from 127.0.0.1 (a secure context, which
// AudioWorklet needs; Chromium does not route worklet requests through Playwright). The audio
// chain renders offline, so no audio device is involved.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHAIN = bundleModules(["export { createAudioChain } from './platform/audio-graph';", "export { createEchoLoader, echoStage } from './platform/echo-reduction';"], 'EchoChain');
const WORKLET = bundleModules(["import './platform/echo-reduction-worklet';"], 'EchoWorklet');
const WASM = readFileSync(path.join(HERE, '../../assembly/echo-reduction.wasm'));
// What a strict host sends: scripts from itself only, so WebAssembly may not compile.
const STRICT_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'";

const browsers = sharedEngineBrowsers();
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/echo-reduction.js') response.writeHead(200, { 'content-type': 'text/javascript' }).end(WORKLET);
  else if (url.pathname === '/echo-reduction.wasm') response.writeHead(200, { 'content-type': 'application/wasm' }).end(WASM);
  else {
    const headers: Record<string, string> = { 'content-type': 'text/html' };
    if (url.searchParams.has('strict')) headers['content-security-policy'] = STRICT_CSP;
    response.writeHead(200, headers).end('<!doctype html><title>echo</title>');
  }
});
let origin = '';
before(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  origin = `http://127.0.0.1:${address.port}`;
});
after(() => { server.closeAllConnections(); server.close(); });

async function open(test: TestContext, engine: 'chromium' | 'firefox', strict = false): Promise<Page> {
  const context = await browsers[engine].newContext(test);
  const page = await context.newPage();
  await page.goto(`${origin}/${strict ? '?strict' : ''}`);
  await page.addScriptTag({ content: CHAIN });
  return page;
}

type Result = { unavailable: boolean; delay: number; tail: number; voice: number; renderMs: number; seconds: number };

/**
 * Renders reverberant speech-like bursts through the chain with only `echo` set. Rendering starts
 * once the worklet has answered (Firefox has no OfflineAudioContext.suspend), so the stage is
 * already fading in at the first frame, as it would in a context that keeps playing.
 */
const RENDER = `(async ({ echo, seconds, origin }) => {
  const rate = 48000, n = rate * seconds;
  const ctx = new OfflineAudioContext(2, n, rate);
  const buffer = ctx.createBuffer(2, n, rate);
  let seed = 1;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 31 - 1;
  const dry = new Float32Array(n);
  let low = 0;
  for (let i = 0; i < n; i++) {
    const t = (i / rate) % 0.6;
    low += 0.2 * (random() - low);
    dry[i] = t < 0.25 ? 0.1 * low * Math.min(1, t / 0.005, (0.25 - t) / 0.005) : 0;
  }
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    data.set(dry);
    // An RT60 0.8 s tail, every 32nd tap, different per channel.
    for (let tap = 240; tap < 0.8 * rate; tap += 32) {
      const h = 0.12 * Math.sqrt(32) * random() * Math.exp(-3 * Math.LN10 * tap / rate / 0.8);
      for (let i = tap; i < n; i++) data[i] += h * dry[i - tap];
    }
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  let answered;
  const answer = new Promise(resolve => { answered = resolve; });
  let unavailable = false;
  const Native = AudioWorkletNode;
  window.AudioWorkletNode = class extends Native {
    constructor(...args) {
      super(...args);
      // One task later, after the stage's own handler in this same dispatch has connected the node.
      this.port.addEventListener('message', () => {
        const next = new MessageChannel();
        next.port1.onmessage = () => answered();
        next.port2.postMessage(0);
      });
    }
  };
  const chain = EchoChain.createAudioChain(ctx, {
    load: EchoChain.createEchoLoader(() => origin + '/echo-reduction.js'),
    onUnavailable: () => { unavailable = true; answered(); }
  });
  source.connect(chain.input);
  chain.output.connect(ctx.destination);
  chain.apply({ voice: 'off', leveling: 'off', bass: 'original', echo });
  source.start();
  if (echo !== 'off') await answer;
  const started = performance.now();
  const out = await ctx.startRendering();
  const renderMs = performance.now() - started;
  window.AudioWorkletNode = Native;
  chain.dispose();
  // The worklet adds 896 samples and the limiter that guards any effect its look-ahead; align on the dry voice.
  const L = out.getChannelData(0), input = buffer.getChannelData(0);
  let delay = 0, best = -Infinity;
  for (let lag = 0; lag < 1600; lag++) {
    let sum = 0;
    for (let i = rate; i < Math.min(2 * rate, n - 1600); i += 2) sum += L[i + lag] * dry[i];
    if (sum > best) { best = sum; delay = lag; }
  }
  let tailOut = 0, tailIn = 0, cross = 0, own = 0, crossIn = 0;
  for (let i = rate; i + delay < n; i++) {
    const t = (i / rate) % 0.6;
    if (t > 0.33 && t < 0.58) { tailOut += L[i + delay] ** 2; tailIn += input[i] ** 2; }
    if (t > 0.05 && t < 0.22) { cross += L[i + delay] * dry[i]; crossIn += input[i] * dry[i]; own += dry[i] ** 2; }
  }
  return { unavailable, delay, tail: 10 * Math.log10(tailOut / tailIn), voice: 20 * Math.log10(cross / crossIn), renderMs, seconds };
})`;

const render = (page: Page, echo: 'off' | 'light' | 'strong', seconds = 4) =>
  page.evaluate(`${RENDER}(${JSON.stringify({ echo, seconds, origin })})`) as Promise<Result>;

type Entry = { unavailable: boolean; lowest: number; step: number };

/**
 * A steady level through the echo stage alone, which is turned off and, at 0.5 s, on again while the
 * context renders. Reports the lowest output and the largest step between two samples in the 60 ms after
 * it comes on. Without an echo to remove, the DSP passes the level for longer than that.
 */
const ENTER = `(async ({ origin }) => {
  const rate = 48000, n = rate;
  const ctx = new OfflineAudioContext(2, n, rate);
  const buffer = ctx.createBuffer(2, n, rate);
  for (let ch = 0; ch < 2; ch++) buffer.getChannelData(ch).fill(0.4);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  let answered;
  const answer = new Promise(resolve => { answered = resolve; });
  let unavailable = false;
  const Native = AudioWorkletNode;
  window.AudioWorkletNode = class extends Native {
    constructor(...args) {
      super(...args);
      this.port.addEventListener('message', () => {
        const next = new MessageChannel();
        next.port1.onmessage = () => answered();
        next.port2.postMessage(0);
      });
    }
  };
  const stage = EchoChain.echoStage(ctx, {
    load: EchoChain.createEchoLoader(() => origin + '/echo-reduction.js'),
    onUnavailable: () => { unavailable = true; answered(); }
  });
  source.connect(stage.input);
  stage.output.connect(ctx.destination);
  // On once before rendering, so the worklet has compiled by the time it is turned on again.
  stage.set('strong');
  source.start();
  await answer;
  let on = 0;
  void ctx.suspend(0.2).then(() => { stage.set('off'); void ctx.resume(); });
  // Resumed first: the stage fades only in a running context.
  void ctx.suspend(0.5).then(() => { void ctx.resume(); on = Math.round(ctx.currentTime * rate); stage.set('strong'); });
  const out = (await ctx.startRendering()).getChannelData(0);
  window.AudioWorkletNode = Native;
  stage.dispose();
  let lowest = Infinity, step = 0;
  for (let i = on; i < on + 0.06 * rate; i++) {
    lowest = Math.min(lowest, out[i]);
    step = Math.max(step, Math.abs(out[i + 1] - out[i]));
  }
  return { unavailable, lowest, step };
})`;

describe('echo reduction in the audio chain', () => {
  for (const engine of testEngines()) {
    it(`${engine}: compiles the shipped DSP in the worklet and shortens the room tail`, async (test) => {
      const page = await open(test, engine);
      const off = await render(page, 'off');
      assert.equal(off.unavailable, false);
      assert.ok(Math.abs(off.tail) < 0.05 && Math.abs(off.voice) < 0.05, `off is a bypass (${off.tail.toFixed(2)} dB)`);
      const light = await render(page, 'light');
      const strong = await render(page, 'strong');
      assert.equal(light.unavailable || strong.unavailable, false, 'the DSP loads on a page without a CSP');
      assert.ok(light.tail < -4, `Light lowers the tail (${light.tail.toFixed(1)} dB)`);
      assert.ok(strong.tail < light.tail - 2, `Strong lowers it further (${strong.tail.toFixed(1)} dB)`);
      assert.ok(light.voice > -2.5 && strong.voice > -4.5, `the voice stays (${light.voice.toFixed(1)}, ${strong.voice.toFixed(1)} dB)`);
    });

    // Firefox has no OfflineAudioContext.suspend, so nothing can change while it renders offline.
    if (engine === 'chromium') it(`${engine}: comes on during sound without a dip or a jump`, async (test) => {
      const page = await open(test, engine);
      const entry = await page.evaluate(`${ENTER}(${JSON.stringify({ origin })})`) as Entry;
      assert.equal(entry.unavailable, false);
      // Fading to the worklet before its 896 samples of latency had passed took the level from 0.4 to 0.15
      // and let it jump back in one sample.
      assert.ok(entry.lowest > 0.39, `the level holds while the stage fades in (lowest ${entry.lowest.toFixed(3)} of 0.4)`);
      assert.ok(entry.step < 0.01, `and nothing jumps (largest step ${entry.step.toFixed(4)})`);
    });

    it(`${engine}: reports echo reduction unavailable where the page CSP forbids WebAssembly`, async (test) => {
      const page = await open(test, engine, true);
      const strong = await render(page, 'strong', 2);
      assert.equal(strong.unavailable, true, 'the stage reports the failed compile');
      assert.ok(Math.abs(strong.tail) < 0.05 && Math.abs(strong.voice) < 0.05, `and stays a bypass (${strong.tail.toFixed(2)} dB)`);
    });
  }
});
