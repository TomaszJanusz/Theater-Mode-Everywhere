import { appendFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { validateMeasurement } from './validation';
import { object, parseConfig } from './config';
import { STATES, scenarios, type Build, type Environment, type Manifest, type Sample } from './model';

export function identifyBuild(id: string, directory: string, sourceSha?: string): Build {
  const root = path.resolve(directory), hash = createHash('sha256');
  const visit = (relative: string) => {
    for (const name of readdirSync(path.join(root, relative)).sort()) {
      const entry = path.join(relative, name), stat = lstatSync(path.join(root, entry));
      if (stat.isSymbolicLink()) throw new Error(`Build contains a symlink: ${entry}`);
      if (stat.isDirectory()) visit(entry);
      else if (stat.isFile()) {
        const data = readFileSync(path.join(root, entry));
        hash.update(`${entry.split(path.sep).join('/')}\0${data.length}\0`).update(data);
      } else throw new Error(`Unsupported build entry: ${entry}`);
    }
  };
  const manifest = object(JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8')), 'extension manifest');
  if (typeof manifest.version !== 'string' || typeof manifest.manifest_version !== 'number') throw new Error('Invalid extension manifest');
  for (const name of ['mainWorld.js', 'content.js', 'background.js']) readFileSync(path.join(root, name));
  visit('');
  return { id, path: root, hash: hash.digest('hex'), version: manifest.version, sourceSha: sourceSha ?? null };
}
export function verifyBuild(build: Build): void {
  const current = identifyBuild(build.id, build.path, build.sourceSha ?? undefined);
  if (current.hash !== build.hash || current.version !== build.version) throw new Error('Build changed during the experiment; start a new run');
}
export function createExperiment(parent = path.join(os.tmpdir(), 'te-cpu-suite', 'results')): string {
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(path.join(parent, 'run-'));
}
export function saveManifest(dir: string, manifest: Manifest): void {
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
}

// Validate persisted data before using it as typed input. Numbers may be null only
// where measurement failure genuinely makes the metric unavailable.
type Schema = 'string' | 'number' | 'boolean' | 'unknown' | { nullable: Schema } | { array: Schema } | { [key: string]: Schema };
const nullable = (schema: Schema): Schema => ({ nullable: schema });
const array = (schema: Schema): Schema => ({ array: schema });
function matches(value: unknown, schema: Schema): boolean {
  if (schema === 'unknown') return true;
  if (typeof schema === 'string') return typeof value === schema && (schema !== 'number' || Number.isFinite(value));
  if ('nullable' in schema) return value === null || matches(value, schema.nullable);
  if ('array' in schema) return Array.isArray(value) && value.every(v => matches(v, schema.array));
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.entries(schema).every(([key, child]) => Object.hasOwn(record, key) && matches(record[key], child));
}
const audio: Schema = { voice: 'string', leveling: 'string', bass: 'string' };
const video: Schema = { url: 'string', id: 'string', quality: 'string', width: 'number', height: 'number', fps: nullable('number'), startSec: 'number' };
const state: Schema = { extension: 'boolean', theater: 'boolean', rte: 'boolean', audio, boost: 'number', paused: 'boolean', bar: 'string',
  native: { stable: 'boolean', voice: 'boolean', cinematic: 'boolean' }, transition: 'string' };
const player: Schema = { href: 'string', videoId: nullable('string'), videoToken: nullable('number'), theater: 'boolean', integrationOff: 'boolean',
  rteSignal: 'boolean', focus: 'boolean', inner: array('number'), dpr: 'number', barVisible: 'boolean', sliderFocused: 'boolean',
  sliderFocusVisible: 'boolean', ad: 'boolean', nativeVolume: nullable('number'), quality: nullable('string'), fmt: nullable('string'), afmt: nullable('string'), streamFps: nullable('number'),
  native: { stable: nullable('boolean'), voice: nullable('boolean'), cinematic: nullable('boolean'), cinematicChildren: 'number', theme: nullable('string') },
  video: nullable({ paused: 'boolean', muted: 'boolean', volume: 'number', readyState: 'number', currentTime: 'number', rate: 'number', error: nullable('string'),
    width: 'number', height: 'number', boost: nullable('number'), audio: nullable(audio), graphReady: 'boolean', graph: nullable({ state: 'string', gain: nullable('number') }),
    dropped: nullable('number'), frames: nullable('number') }) };
const build: Schema = { id: 'string', path: 'string', hash: 'string', version: 'string', sourceSha: nullable('string') };
const environment: Schema = { platform: 'string', host: 'string', cpu: 'string', cores: 'number', memoryBytes: 'number', chromePath: 'string',
  chromeVersion: 'string', displayBackend: 'string', gpu: 'unknown', viewport: array('number'), dpr: nullable('number'), audioMutedByBrowser: 'boolean' };
const manifestSchema: Schema = { formatVersion: 'number', id: 'string', createdAt: 'string', mode: 'string',
  config: { video, navigationVideo: nullable(video), states: array('string'), profile: 'string', warmupMs: 'number', windowMs: 'number', rounds: 'number',
    attempts: 'number', scatterPp: 'number', scatterExtra: 'number', extension: { name: 'string', path: 'string' } },
  scenarios: array({ id: 'string', state: 'string', video, target: video, expected: state }), builds: array(build), environment,
  threshold: 'number', load: { median: 'number', p95: 'number', samples: array('number') } };
const sampleSchema: Schema = { experimentId: 'string', scenarioId: 'string', state: 'string', buildId: 'string', round: 'number', attempt: 'number',
  pairId: nullable('string'), accepted: 'boolean', reason: nullable({ code: 'string', detail: 'string' }), measuredAt: 'string',
  measurement: nullable({ wallSec: 'number', rendererPct: nullable('number'), threadPct: nullable('number'), familyPct: nullable('number'), gpuPct: nullable('number'),
    nonChromePct: nullable('number'), counterError: nullable('string'), processSetChanged: 'boolean', pre: player, post: player }),
  warmup: nullable({ pre: player, post: player, wallSec: 'number' }) };
function assertManifest(value: unknown): asserts value is Manifest {
  if (!matches(value, manifestSchema)) throw new Error('Invalid experiment manifest');
  const m = value as Manifest;
  if (m.formatVersion !== 1 || !['run', 'compare', 'probe'].includes(m.mode) || !['default', 'extended'].includes(m.config.profile)
      || m.config.states.some(s => !Object.hasOwn(STATES, s)) || !m.scenarios.length
      || m.scenarios.some(s => !Object.hasOwn(STATES, s.state) || JSON.stringify(s.expected) !== JSON.stringify(STATES[s.state]))
      || !Number.isInteger(m.config.rounds) || m.config.rounds <= 0 || !Number.isInteger(m.config.attempts) || m.config.attempts <= 0
      || m.config.warmupMs <= 0 || m.config.windowMs <= 0 || m.threshold < 0
      || m.environment.viewport.length !== 2 || m.builds.length !== (m.mode === 'compare' ? 2 : 1)) throw new Error('Invalid experiment semantics');
  const c = m.config;
  const verified = parseConfig({ videoUrl: c.video.url, videoId: c.video.id, startSec: c.video.startSec,
    navigationVideo: c.navigationVideo, states: c.states, profile: c.profile, extension: c.extension,
    warmupMs: c.warmupMs, windowMs: c.windowMs, rounds: c.rounds, attempts: c.attempts, scatterPp: c.scatterPp, scatterExtra: c.scatterExtra }, '/');
  if (JSON.stringify(verified) !== JSON.stringify(c) || JSON.stringify(scenarios(verified)) !== JSON.stringify(m.scenarios)
    || new Set(m.builds.map(b => b.id)).size !== m.builds.length || m.builds.some(b => b.id === 'native' || !/^[\w-]+$/.test(b.id))) {
    throw new Error('Invalid resolved experiment configuration');
  }
}
export function readManifest(dir: string): Manifest {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')); }
  catch { throw new Error('Missing/legacy experiment manifest. Start a new run; old results remain untouched.'); }
  assertManifest(raw);
  return raw;
}
function assertSample(value: unknown): asserts value is Sample {
  if (!matches(value, sampleSchema)) throw new Error('Invalid sample record');
  const row = value as Sample;
  if (!Object.hasOwn(STATES, row.state) || row.round < 1 || row.attempt < 1 || !Number.isInteger(row.round) || !Number.isInteger(row.attempt)
      || (row.accepted && (!row.measurement || row.reason || row.measurement.counterError || row.measurement.processSetChanged
        || (['rendererPct', 'familyPct', 'gpuPct', 'threadPct', 'nonChromePct'] as const).some(key => {
          const metric = row.measurement![key]; return typeof metric !== 'number' || metric < 0;
        }))) || (!row.accepted && !row.reason)) throw new Error('Invalid sample semantics');
}
export function readSamples(dir: string, manifest: Manifest): Sample[] {
  const rows = readFileSync(path.join(dir, 'samples.jsonl'), 'utf8').split('\n').filter(Boolean).map((line, index) => {
    const raw: unknown = JSON.parse(line);
    try { assertSample(raw); } catch (error) { throw new Error(`Sample ${index + 1}: ${String(error)}`); }
    if (raw.experimentId !== manifest.id || !manifest.scenarios.some(s => s.id === raw.scenarioId && s.state === raw.state)
        || !(manifest.scenarios.find(s => s.id === raw.scenarioId)!.expected.extension ? manifest.builds.map(b => b.id) : ['native']).includes(raw.buildId)) throw new Error('Sample belongs to another experiment');
    const scenario = manifest.scenarios.find(s => s.id === raw.scenarioId)!;
    if (raw.accepted && validateMeasurement(scenario, raw.measurement!, manifest.threshold, manifest.config.windowMs)) {
      throw new Error('Accepted sample does not satisfy the saved scenario');
    }
    return raw;
  });
  return rows;
}
export function record(dir: string, row: Sample): void {
  assertSample(row);
  appendFileSync(path.join(dir, 'samples.jsonl'), JSON.stringify(row) + '\n');
}
export function assertResume(saved: Manifest, builds: Build[], current: Environment, config = saved.config): void {
  if (JSON.stringify(config) !== JSON.stringify(saved.config)) throw new Error('Config changed; start a new experiment');
  if (builds.length !== saved.builds.length || builds.some((b, i) => b.hash !== saved.builds[i].hash || b.version !== saved.builds[i].version || b.id !== saved.builds[i].id)) {
    throw new Error('Build changed; start a new experiment');
  }
  // Free memory changes naturally. Total memory and rendering conditions do not.
  if (JSON.stringify(current) !== JSON.stringify(saved.environment)) throw new Error('Environment changed; start a new experiment');
}
