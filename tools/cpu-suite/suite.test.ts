import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { parseCli, parseConfig } from './config';
import { STATES, scenarios, type Config, type Manifest, type Measurement, type PlayerSnapshot, type Sample } from './model';
import { checkState, progress, validateMeasurement } from './validation';
import { assertResume, createExperiment, identifyBuild, readManifest, readSamples, saveManifest, record, verifyBuild } from './storage';
import { completeRows, csvCell, incomplete, pairedDeltas, renderReport } from './report';
import { acquireLock, cancellableClock, cpuDeltas, Resources, waitFor } from './processes';
import { metricDelta, parseProcesses } from './measurement';
import { runExperiment, type SampleRequest } from './runner';
import { DEFAULT_AUDIO_SETTINGS } from '../../src/audio-settings';

const raw = { videoUrl: 'https://www.youtube.com/watch?v=IGk17XQ7IrQ', videoId: 'IGk17XQ7IrQ',
  extension: { name: 'checkout', path: 'dist/chrome-unpacked' }, states: ['neutral'] };
function config(): Config { return parseConfig(raw, '/repo'); }
function snapshot(): PlayerSnapshot {
  return { href: raw.videoUrl, videoId: raw.videoId, videoToken: 1, theater: true, integrationOff: false, rteSignal: true,
    focus: true, inner: [1440, 900], dpr: 1, barVisible: false, sliderFocused: false, sliderFocusVisible: false,
    ad: false, captionsVisible: false, nativeVolume: 100, quality: 'medium', fmt: '134', afmt: '140', streamFps: 30,
    native: { stable: false, voice: false, cinematic: false, cinematicChildren: 0, theme: 'USER_INTERFACE_THEME_DARK' },
    video: { paused: false, muted: false, volume: 1, readyState: 4, currentTime: 20, rate: 1, error: null,
      width: 640, height: 360, boost: 1, audio: { ...DEFAULT_AUDIO_SETTINGS }, graphReady: false, graph: null, dropped: 1, frames: 100 } };
}
function measurement(seconds = 20): Measurement {
  const pre = snapshot(), post = snapshot(); post.video!.currentTime += seconds; post.video!.frames! += 600;
  return { pre, post, wallSec: seconds, rendererPct: 10, threadPct: 5, familyPct: 20, gpuPct: 3,
    nonChromePct: 0, counterError: null, processSetChanged: false };
}
function manifest(compare = false): Manifest {
  const cfg = config();
  return { formatVersion: 1, id: 'test-run', mode: compare ? 'compare' : 'run', createdAt: '2026-10-12', config: cfg,
    scenarios: scenarios(cfg), builds: (compare ? ['A', 'B'] : ['checkout']).map(id => ({ id, path: `/build/${id}`, hash: id, version: '1.0', sourceSha: null })),
    environment: { platform: 'linux', host: 'Linux', cpu: 'CPU', cores: 4, memoryBytes: 1000, chromePath: '/chrome',
      chromeVersion: 'Chromium 1', displayBackend: 'owned-Xvfb', gpu: null, viewport: [1440, 900], dpr: 1, audioMutedByBrowser: true },
    threshold: 40, load: { median: 0, p95: 0, samples: [] } };
}
function sample(m: Manifest, id = m.builds[0].id, round = 1, attempt = 1): Sample {
  return { experimentId: m.id, scenarioId: m.scenarios[0].id, state: 'neutral', buildId: id, round, attempt,
    pairId: `${m.id}/${round}/${attempt}`, accepted: true, reason: null, measuredAt: '2026-10-12', measurement: measurement(), warmup: null };
}
function temp(): string { return mkdtempSync(path.join(os.tmpdir(), 'cpu-suite-test-')); }

describe('configuration and command boundaries', () => {
  it('rejects unknown commands, invalid flags and ambiguous resume overrides', () => {
    assert.throws(() => parseCli(['rnu']));
    assert.throws(() => parseCli(['run', '--states']));
    assert.throws(() => parseCli(['report']));
    assert.throws(() => parseCli(['compare', '--build-a', 'a']));
    assert.throws(() => parseCli(['topup', '--run-dir', '/tmp/run', '--states', 'active']));
    assert.equal(parseCli(['--help']).command, 'help');
  });
  it('validates durations, identifiers, states and SPA targets before launch', () => {
    for (const windowMs of [0, -1, NaN, '2000']) assert.throws(() => parseConfig({ ...raw, windowMs }, '/repo'));
    assert.throws(() => parseConfig({ ...raw, rounds: 1.5 }, '/repo'));
    assert.throws(() => parseConfig({ ...raw, videoId: 'different' }, '/repo'));
    assert.throws(() => parseConfig({ ...raw, states: ['disabled'] }, '/repo'));
    assert.throws(() => parseConfig({ ...raw, states: ['neutral', 'neutral'] }, '/repo'));
    assert.throws(() => parseConfig({ ...raw, states: ['after-navigation'] }, '/repo'));
    const cfg = parseConfig({ ...raw, profile: 'extended', states: ['after-navigation'],
      navigationVideo: { url: 'https://www.youtube.com/watch?v=abcdefghijk', id: 'abcdefghijk' } }, '/repo');
    assert.equal(scenarios(cfg).length, 2);
    assert.equal(scenarios(cfg)[1].target.fps, 60);
    assert.equal(parseConfig(raw, '/repo').states.includes('captions'), false);
    const captions = parseConfig(raw, '/repo', parseCli(['compare', '--build-a', 'a', '--build-b', 'b', '--states', 'captions']));
    assert.deepEqual(captions.states, ['captions']);
    assert.equal(STATES.captions.captions, true);
  });
});
describe('sample validity', () => {
  it('accepts short healthy windows and applies proportional progress to warmup', () => {
    const m = manifest();
    for (const seconds of [0.5, 2, 10, 20]) {
      const data = measurement(seconds);
      assert.equal(validateMeasurement(m.scenarios[0], data, 40, seconds * 1000), null);
      assert.equal(progress(data.pre, data.post, seconds, false), null);
      data.post.video!.currentTime = data.pre.video!.currentTime;
      if (seconds > 0.5) assert.equal(progress(data.pre, data.post, seconds, false)?.code, 'playback-progress');
    }
  });
  it('rejects seek jumps, identity replacement, rate changes and paused drift', () => {
    const data = measurement(); data.post.videoToken = 2;
    assert.equal(progress(data.pre, data.post, 20, false)?.code, 'video-replaced');
    data.post.videoToken = 1; data.post.video!.rate = 2;
    assert.equal(progress(data.pre, data.post, 20, false)?.code, 'playback-rate');
    data.post.video!.rate = 1; data.post.video!.currentTime += 10;
    assert.equal(progress(data.pre, data.post, 20, false)?.code, 'playback-progress');
    data.pre.video!.paused = data.post.video!.paused = true;
    assert.equal(progress(data.pre, data.post, 20, true)?.code, 'pause-drift');
  });
  it('rejects absent/reset CPU counters and process churn', () => {
    const m = manifest(), data = measurement(); data.rendererPct = null;
    assert.equal(validateMeasurement(m.scenarios[0], data, 40, 20000)?.code, 'cpu-counter');
    data.rendererPct = 0; data.processSetChanged = true;
    assert.equal(validateMeasurement(m.scenarios[0], data, 40, 20000)?.code, 'process-set-changed');
    assert.equal(metricDelta({}, { ProcessTime: 1 }, 'ProcessTime'), null);
    assert.equal(metricDelta({ ProcessTime: 2 }, { ProcessTime: 1 }, 'ProcessTime'), null);
    assert.equal(cpuDeltas(new Map([[1, 10]]), new Map([[2, 20]]), 1).changed, true);
    assert.equal(cpuDeltas(new Map([[1, 20]]), new Map([[1, 10]]), 1).seconds, null);
    assert.throws(() => parseProcesses([{ id: 1, type: 'renderer', cpuTime: '1' }]));
  });
  it('checks real focus and every neutral audio effect at both endpoints', () => {
    const p = snapshot(); p.video!.boost = 3; p.video!.graphReady = true; p.video!.graph = { state: 'running', gain: 3 }; p.barVisible = true;
    assert.equal(checkState(STATES['boost-focused'], p)?.code, 'slider-focus');
    p.sliderFocused = p.sliderFocusVisible = true;
    assert.equal(checkState(STATES['boost-focused'], p), null);
    p.video!.boost = 1;
    assert.equal(checkState(STATES.neutral, p)?.code, 'audio-graph', 'existing graph gain must agree with neutral metadata');
    p.video!.graph!.gain = 1;
    p.video!.audio!.leveling = 'strong';
    assert.equal(checkState(STATES['effects-disabled'], p)?.code, 'audio-settings');
    p.video!.audio!.leveling = 'off';
    assert.equal(checkState(STATES['effects-disabled'], p), null, 'running neutral graph is intentionally retained');
    assert.equal(checkState(STATES.captions, p)?.code, 'captions-hidden');
    p.captionsVisible = true;
    assert.equal(checkState(STATES.captions, p), null);
    assert.equal(checkState(STATES.neutral, p)?.code, 'captions-visible');
    p.captionsVisible = false;
    const m = manifest(), data = measurement(); data.post.video!.audio!.bass = 'more';
    assert.equal(validateMeasurement(m.scenarios[0], data, 40, 20000)?.code, 'audio-settings');
  });
  it('rejects unavailable native features, absent RTE signals and changing codec/quality', () => {
    const m = manifest(), data = measurement(); data.post.native.voice = null;
    assert.equal(validateMeasurement(m.scenarios[0], data, 40, 20000)?.code, 'native-unavailable');
    data.post.native.voice = false; data.post.rteSignal = false;
    assert.equal(validateMeasurement(m.scenarios[0], data, 40, 20000)?.code, 'rte-signal');
    data.post.rteSignal = true; data.post.fmt = 'other';
    assert.equal(validateMeasurement(m.scenarios[0], data, 40, 20000)?.code, 'codec-changed');
    data.post.fmt = null;
    assert.equal(validateMeasurement(m.scenarios[0], data, 40, 20000)?.code, 'codec-unavailable');
  });
});
describe('experiment persistence and reporting', () => {
  it('isolates experiments, hashes all build files, rejects legacy and cross-run data', () => {
    const parent = temp();
    try {
      const a = createExperiment(parent), b = createExperiment(parent); assert.notEqual(a, b);
      const m = manifest(); saveManifest(a, m); writeFileSync(path.join(a, 'samples.jsonl'), ''); record(a, sample(m));
      assert.deepEqual(readManifest(a), m); assert.equal(readSamples(a, m).length, 1);
      assert.throws(() => readSamples(a, { ...m, id: 'another' }));
      assert.throws(() => readManifest(b), /legacy/);
      const legacy = structuredClone(m);
      for (const scenario of legacy.scenarios) delete (scenario.expected as { captions?: boolean }).captions;
      const legacySample = sample(m);
      delete (legacySample.measurement!.pre as { captionsVisible?: boolean }).captionsVisible;
      delete (legacySample.measurement!.post as { captionsVisible?: boolean }).captionsVisible;
      saveManifest(b, legacy);
      writeFileSync(path.join(b, 'samples.jsonl'), JSON.stringify(legacySample) + '\n');
      assert.equal(readManifest(b).scenarios[0].expected.captions, false);
      assert.equal(readSamples(b, readManifest(b))[0].measurement?.pre.captionsVisible, false);
      const buildDir = path.join(parent, 'build'); mkdirSync(buildDir);
      writeFileSync(path.join(buildDir, 'manifest.json'), JSON.stringify({ version: '1', manifest_version: 3 }));
      for (const file of ['content.js', 'background.js', 'mainWorld.js']) writeFileSync(path.join(buildDir, file), '//build');
      const first = identifyBuild('A', buildDir); assert.equal(first.sourceSha, null); verifyBuild(first);
      writeFileSync(path.join(buildDir, 'content.css'), 'new');
      assert.notEqual(identifyBuild('A', buildDir).hash, first.hash);
      assert.throws(() => verifyBuild(first), /Build changed/);
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
  it('requires the saved build/config/environment for topup', () => {
    const m = manifest(); assertResume(m, m.builds, m.environment);
    assert.throws(() => assertResume(m, [{ ...m.builds[0], hash: 'changed' }], m.environment));
    assert.throws(() => assertResume(m, m.builds, { ...m.environment, chromeVersion: 'new' }));
    assert.throws(() => assertResume(m, m.builds, m.environment, { ...m.config, windowMs: 10 }));
  });
  it('excludes incomplete pairs and pairs across retry attempts', () => {
    const m = manifest(true), a = sample(m, 'A'), b = sample(m, 'B', 1, 2);
    assert.equal(completeRows(m, [a, b]).length, 0);
    b.attempt = 1; b.pairId = a.pairId; b.measurement!.rendererPct = 15;
    const rows = [a, b]; assert.equal(completeRows(m, rows).length, 2);
    assert.deepEqual(pairedDeltas(m, rows, a.scenarioId, 'rendererPct'), { pp: 5, relative: 50, n: 1 });
    a.measurement!.rendererPct = 0;
    assert.equal(pairedDeltas(m, rows, a.scenarioId, 'rendererPct').relative, null);
    b.measurement!.pre.fmt = 'another-codec';
    assert.equal(completeRows(m, rows).length, 0, 'different decoders cannot form a comparison pair');
    b.measurement!.pre.fmt = a.measurement!.pre.fmt;
    assert.equal(incomplete(m, rows), true);
    assert.match(renderReport(m, rows).markdown, /INCOMPLETE/);
  });
  it('reports saved build identity and escapes multiline/quoted CSV diagnostics', () => {
    assert.equal(csvCell('a,"b"\n'), '"a,""b""\n"');
    const m = manifest(), row = sample(m); row.accepted = false; row.reason = { code: 'setup', detail: 'a,"b"\nnext' };
    const report = renderReport(m, [row]);
    assert.match(report.markdown, /declared source SHA: unavailable/);
    assert.ok(report.csv.includes('"a,""b""\nnext"'));
  });
});
describe('runner and owned resources', () => {
  it('retries whole pairs within bounds and preserves rejected metadata', async () => {
    const dir = temp(), m = manifest(true); m.config.rounds = 1; m.config.attempts = 2; m.config.scatterExtra = 0;
    const calls: SampleRequest[] = [], rows: Sample[] = []; writeFileSync(path.join(dir, 'samples.jsonl'), '');
    try {
      await runExperiment(m, dir, rows, async r => {
        calls.push(r); const row = sample(m, r.build!.id, r.round, r.attempt); row.pairId = r.pairId;
        if (r.attempt === 1 && r.build!.id === 'B') { row.accepted = false; row.reason = { code: 'warmup-stall', detail: 'stalled' }; row.measurement = null; }
        return row;
      });
      assert.equal(calls.length, 4); assert.equal(completeRows(m, rows).length, 2);
      assert.equal(readSamples(dir, m).filter(r => !r.accepted)[0].scenarioId, m.scenarios[0].id);
      assert.equal(incomplete(m, rows), false);
      await runExperiment(m, dir, rows, async () => { throw new Error('Must not repeat completed rounds'); });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('bounds scatter extras as complete pairs and never counts extras as required rounds', async () => {
    const dir = temp(), m = manifest(true), rows: Sample[] = [];
    m.config.attempts = 1; m.config.scatterExtra = 2;
    writeFileSync(path.join(dir, 'samples.jsonl'), '');
    try {
      await runExperiment(m, dir, rows, async r => {
        const row = sample(m, r.build!.id, r.round, r.attempt); row.pairId = r.pairId;
        row.measurement!.rendererPct = r.round * 10; return row;
      });
      assert.equal(rows.length, 10);
      assert.equal(incomplete(m, rows), false);
      const missingRequired = rows.filter(r => r.round !== 2);
      assert.equal(incomplete(m, missingRequired), true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('cleans in reverse order once, including when one disposer fails', async () => {
    const resources = new Resources(), calls: string[] = [];
    resources.add(() => { calls.push('foreign untouched'); });
    resources.add(() => { calls.push('owned browser'); throw new Error('close failed'); });
    resources.add(() => { calls.push('owned display'); });
    await assert.rejects(resources.close(), /Cleanup failed/);
    await assert.rejects(resources.close());
    assert.deepEqual(calls, ['owned display', 'owned browser', 'foreign untouched']);
    assert.equal(resources.abort.signal.aborted, true);
  });
  it('interrupts pending waits without waiting for their duration', async () => {
    const abort = new AbortController();
    const pending = cancellableClock(abort.signal).sleep(20000);
    abort.abort();
    await assert.rejects(pending);
  });
  it('waits for observable readiness with an injected clock and protects live locks', async () => {
    let now = 0, ready = false;
    await waitFor(() => ready, 500, { now: () => now, sleep: async ms => { now += ms; ready = now >= 200; } });
    assert.equal(now, 200);
    const dir = temp();
    try {
      const unlock = acquireLock(dir); assert.throws(() => acquireLock(dir), /locked/);
      assert.equal(readFileSync(path.join(dir, 'executor.lock'), 'utf8'), `${process.pid}\n`);
      unlock(); unlock(); acquireLock(dir)();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
