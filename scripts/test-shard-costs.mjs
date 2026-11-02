import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { FILE_CONCURRENCY } from './run-tests.mjs';

// Builds the cost table that `pnpm test --shard-costs=` balances shards with (see balanceShard in run-tests.mjs)
// from the `--report-dir` of finished runs: `<node|tsx>-seconds.json` holds each file process's time, and Vitest's
// `vitest.xml` the time of each component file. CI uploads these as the `test-reports-<engine>-<shard>` artifacts, and
// the two engines have their own tables (a file costs different seconds in each browser):
//
//   gh run download <run-id> -D /tmp/reports -p 'test-reports-chromium-*'
//   node scripts/test-shard-costs.mjs --overhead=1:35 /tmp/reports/* > scripts/test-shard-costs.chromium.json
//
// Pass one directory per shard (or per run). A file seen in several directories gets the median, which damps one
// noisy run. `--overhead=<shard>:<seconds>` records non-test work the workflow runs in a shard, such as the
// Storybook step, as wall-clock seconds; the table counts file-seconds, so they are scaled by the runner's file concurrency.

export function vitestSeconds(xml) {
  return Object.fromEntries([...xml.matchAll(/<testsuite\b[^>]*?\bname="([^"]+)"[^>]*?\btime="([\d.]+)"/g)].map(([, name, time]) => [name, Number(time)]));
}

export function buildCosts(runs, overhead = {}) {
  const samples = new Map();
  for (const run of runs) {
    for (const [file, seconds] of Object.entries(run)) samples.set(file, [...(samples.get(file) ?? []), seconds]);
  }
  const median = values => {
    const sorted = [...values].sort((a, b) => a - b);
    return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
  };
  const files = Object.fromEntries([...samples].sort(([a], [b]) => (a < b ? -1 : 1)).map(([file, values]) => [file, Number(median(values).toFixed(1))]));
  return { files, ...(Object.keys(overhead).length > 0 && { overhead }) };
}

export function readRun(directory) {
  const run = {};
  for (const name of readdirSync(directory).filter(name => name.endsWith('-seconds.json'))) {
    Object.assign(run, JSON.parse(readFileSync(join(directory, name), 'utf8')));
  }
  const vitest = join(directory, 'vitest.xml');
  if (existsSync(vitest)) Object.assign(run, vitestSeconds(readFileSync(vitest, 'utf8')));
  return run;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const overhead = {};
  const directories = [];
  for (const arg of process.argv.slice(2)) {
    const [, shard, seconds] = /^--overhead=(\d+):([\d.]+)$/.exec(arg) ?? [];
    if (shard) overhead[shard] = Number(seconds) * FILE_CONCURRENCY;
    else directories.push(arg);
  }
  if (directories.length === 0) {
    console.error('Usage: node scripts/test-shard-costs.mjs [--overhead=<shard>:<seconds>] <report-dir>...');
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(buildCosts(directories.map(readRun), overhead), null, 2) + '\n');
}
