#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { parseCli, parseConfig } from './config';
import { scenarios, type Manifest } from './model';
import { acquireLock, cancellableClock, ensureDisplay, Resources } from './processes';
import { environment, launchBrowser } from './browser';
import { observeLoad } from './measurement';
import { assertResume, createExperiment, identifyBuild, readManifest, readSamples, saveManifest } from './storage';
import { writeReport } from './report';
import { runExperiment, takeSample } from './runner';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_CONFIG = path.join(ROOT, 'tools/cpu-suite/suite.config.json');
export const HELP = `YouTube CPU suite (Linux, headed Chromium)
  pnpm cpu:suite run [--config file] [--states name,...] [--profile default|extended]
  pnpm cpu:suite compare --build-a directory --build-b directory [run options]
  pnpm cpu:suite probe [--config file]
  pnpm cpu:suite topup --run-dir directory [--config file]
  pnpm cpu:suite report --run-dir directory
  pnpm cpu:suite --help
CHROME_PATH overrides Chromium; CPU_SUITE_CONFIG overrides the default config.
Build unpacked extensions first. New experiments live in the system temp directory.
Exit 0: complete; 1: configuration/execution failure; 2: incomplete/mismatched results.
See docs/cpu-suite.md for states, extended profile, and interpretation.
`;
export async function main(args = process.argv.slice(2)): Promise<number> {
  const cli = parseCli(args);
  if (cli.command === 'help') { console.log(HELP); return 0; }
  if (cli.command === 'report') {
    const manifest = readManifest(cli.runDir!);
    const unlock = acquireLock(cli.runDir!);
    try {
      const code = writeReport(cli.runDir!, manifest, readSamples(cli.runDir!, manifest));
      console.log(path.join(cli.runDir!, 'SUMMARY.md')); return code;
    } finally { unlock(); }
  }
  if (process.platform !== 'linux') throw new Error('CPU suite supports Linux headed Chromium only; Firefox and other platforms are unsupported');
  const saved = cli.command === 'topup' ? readManifest(cli.runDir!) : null;
  if (saved?.mode === 'probe') throw new Error('Probe cannot be topped up; run probe again');
  const configPath = cli.configPath ?? process.env.CPU_SUITE_CONFIG ?? DEFAULT_CONFIG;
  const config = saved && !cli.configPath && !process.env.CPU_SUITE_CONFIG ? saved.config
    : parseConfig(JSON.parse(readFileSync(configPath, 'utf8')), ROOT, cli);
  const builds = saved ? saved.builds.map(b => identifyBuild(b.id, b.path, b.sourceSha ?? undefined))
    : cli.command === 'compare' ? [identifyBuild('A', cli.buildA!), identifyBuild('B', cli.buildB!)]
      : [identifyBuild(config.extension.name, config.extension.path, config.extension.sha)];
  if (builds.some(b => b.id === 'native' || !/^[\w-]+$/.test(b.id))) throw new Error('Build names must be safe identifiers other than native');
  const chrome = path.resolve(process.env.CHROME_PATH || chromium.executablePath());
  const browserVersion = execFileSync(chrome, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim();
  if (!/Chromium|Chrome/.test(browserVersion)) throw new Error('CHROME_PATH must point to Chromium/Chrome; Firefox is unsupported');
  const resources = new Resources(), dir = saved ? path.resolve(cli.runDir!) : createExperiment();
  const unlock = acquireLock(dir);
  const timer = cancellableClock(resources.abort.signal);
  const interrupted = () => { void resources.close().catch(error => console.error(error)); };
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  let manifest: Manifest | null = null;
  try {
    const display = await ensureDisplay(resources);
    const calibration = await launchBrowser(path.join(dir, 'profiles', 'environment'), chrome, null, resources, path.join(dir, 'diagnostics', 'environment'));
    const env = await environment(calibration, chrome, display.backend);
    await calibration.close();
    if (saved) assertResume(saved, builds, env, config);
    console.log(`Experiment: ${dir}`);
    if (!saved) {
      if (cli.command !== 'probe') console.log('Observing background load for 60 seconds…');
      const load = cli.command === 'probe' ? { median: 0, p95: 0, samples: [], threshold: Number.MAX_SAFE_INTEGER } : await observeLoad(timer);
      const effective = cli.command === 'probe' ? { ...config, rounds: 1, attempts: 1, scatterExtra: 0,
        states: ['reference', 'native-cinematic', 'native-voice', 'native-stable', 'native-all'] as const } : config;
      const resolved = { ...effective, states: [...effective.states] };
      manifest = { formatVersion: 1, id: path.basename(dir), createdAt: new Date().toISOString(), mode: cli.command === 'compare' ? 'compare' : cli.command === 'probe' ? 'probe' : 'run',
        config: resolved, scenarios: scenarios(resolved), builds, environment: env, threshold: load.threshold, load };
      saveManifest(dir, manifest);
      writeFileSync(path.join(dir, 'samples.jsonl'), '', { flag: 'wx' });
    } else manifest = saved;
    const rows = readSamples(dir, manifest);
    await runExperiment(manifest, dir, rows, r => takeSample(r, resources, timer), resources.abort.signal);
    const code = writeReport(dir, manifest, rows);
    console.log(`Report: ${path.join(dir, 'SUMMARY.md')}`); return code;
  } finally {
    try {
      if (manifest) writeReport(dir, manifest, readSamples(dir, manifest));
    } finally {
      try { await resources.close(); } finally {
        unlock();
        process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
      }
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(String(error)); process.exitCode = 1; });
}
