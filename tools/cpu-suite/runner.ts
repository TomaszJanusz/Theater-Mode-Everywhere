import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { captureDiagnostics, launchBrowser, prepareScenario, readPlayer, type Session } from './browser';
import { measure } from './measurement';
import { checkPlayer, progress, validateMeasurement, validatePair } from './validation';
import { reason, type Build, type Manifest, type Sample, type Scenario } from './model';
import { clock, Resources, type Clock } from './processes';
import { completeRows, countRounds, scatter } from './report';
import { record, verifyBuild } from './storage';
export type SampleRequest = { manifest: Manifest; scenario: Scenario; build: Build | null; round: number; attempt: number; pairId: string; dir: string };
export async function takeSample(request: SampleRequest, resources: Resources, timer: Clock = clock): Promise<Sample> {
  const { manifest, scenario, build, round, attempt, pairId, dir } = request;
  const row: Sample = { experimentId: manifest.id, scenarioId: scenario.id, state: scenario.state, buildId: build?.id ?? 'native', round,
    attempt, pairId, accepted: false, reason: null, measuredAt: new Date().toISOString(), measurement: null, warmup: null };
  const prefix = path.join(dir, 'diagnostics', `${scenario.id}-${build?.id ?? 'native'}-${round}-${attempt}`);
  let session: Session | null = null;
  try {
    if (resources.abort.signal.aborted) throw new Error('Experiment interrupted');
    if (build) verifyBuild(build);
    // A fresh profile per slot avoids cookies/settings from a previous condition.
    const profile = path.join(dir, 'profiles', `${scenario.id}-${build?.id ?? 'native'}-${round}-${attempt}`);
    session = await launchBrowser(profile, manifest.environment.chromePath, build, resources, prefix, s => prepareScenario(s, scenario));
    const pre = await readPlayer(session.page), start = timer.now();
    await timer.sleep(manifest.config.warmupMs);
    const wallSec = (timer.now() - start) / 1000, post = await readPlayer(session.page);
    row.warmup = { pre, post, wallSec };
    row.reason = checkPlayer(scenario, pre) || checkPlayer(scenario, post) || progress(pre, post, wallSec, scenario.expected.paused);
    if (!row.reason) {
      row.measurement = await measure(session, manifest.config.windowMs, timer);
      row.reason = validateMeasurement(scenario, row.measurement, manifest.threshold, manifest.config.windowMs);
    }
    if (build) verifyBuild(build);
    row.accepted = !row.reason;
  } catch (error) {
    const detail = String(error).slice(0, 4000);
    row.reason = reason(detail.includes('native-unavailable') ? 'native-unavailable' : detail.includes('Build changed') ? 'build-changed' : 'setup-error', detail);
    if (session) await captureDiagnostics(session.page, prefix, error);
  } finally {
    try { await session?.close(); } catch (error) { row.accepted = false; row.reason = reason('cleanup-error', String(error)); }
  }
  return row;
}
export type Sampler = (request: SampleRequest) => Promise<Sample>;
export async function runExperiment(manifest: Manifest, dir: string, rows: Sample[], sampler: Sampler,
  signal: AbortSignal = new AbortController().signal): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const config = manifest.config;
  async function slot(scenario: Scenario, round: number) {
    const previousAttempts = rows.filter(r => r.scenarioId === scenario.id && r.round === round).map(r => r.attempt);
    const firstAttempt = Math.max(0, ...previousAttempts) + 1;
    const builds = scenario.expected.extension ? manifest.builds : [null];
    for (let offset = 0; offset < config.attempts; offset++) {
      if (signal.aborted) throw new Error('Experiment interrupted');
      const attempt = firstAttempt + offset;
      const pairId = `${manifest.id}/${scenario.id}/${round}/${attempt}`;
      const order = (round + attempt) % 2 === 0 ? builds : [...builds].reverse();
      const pair: Sample[] = [];
      try {
        for (const build of order) {
          if (signal.aborted) throw new Error('Experiment interrupted');
          pair.push(await sampler({ manifest, scenario, build, round, attempt, pairId, dir }));
        }
      } finally {
        const mismatch = validatePair(pair);
        for (const row of pair) {
          if (mismatch) { row.accepted = false; row.reason = mismatch; }
          record(dir, row); rows.push(row);
          console.log(`${scenario.id} ${row.buildId} round ${round} attempt ${attempt}: ${row.accepted ? 'accepted' : `${row.reason?.code}: ${row.reason?.detail.split('\n')[0]}`}`);
        }
      }
      if (pair.every(r => r.accepted)) return;
    }
  }
  for (let round = 1; round <= config.rounds; round++) {
    const offset = (round - 1) % manifest.scenarios.length;
    const rotated = [...manifest.scenarios.slice(offset), ...manifest.scenarios.slice(0, offset)];
    const order = round % 2 ? rotated : rotated.reverse();
    for (const scenario of order) {
      if (completeRows(manifest, rows).some(r => r.scenarioId === scenario.id && r.round === round)) continue;
      await slot(scenario, round);
    }
  }
  // Extras never substitute for failed required slots. They only characterize scatter.
  for (const scenario of manifest.scenarios) {
    if (countRounds(manifest, rows, scenario.id) < config.rounds || !scatter(manifest, rows, scenario.id)) continue;
    for (let extra = 1; extra <= config.scatterExtra; extra++) {
      const round = config.rounds + extra;
      if (completeRows(manifest, rows).some(r => r.scenarioId === scenario.id && r.round === round)) continue;
      await slot(scenario, round);
    }
  }
}
