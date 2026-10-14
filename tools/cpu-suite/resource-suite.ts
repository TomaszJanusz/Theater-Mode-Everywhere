import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { chromium, firefox } from 'playwright';
import { identifyBuild } from './storage';
import { completeResourcePair, resourceOptions, resourceReport, type ResourceSample } from './resource-model';
import { fixtureServer, runFixture } from './resource-browser';
async function main() {
  const options = resourceOptions(process.argv.slice(2));
  const builds = [identifyBuild('A', options.buildA, options.sha), ...(options.buildB ? [identifyBuild('B', options.buildB)] : [])];
  mkdirSync(options.output, { recursive: true });
  const dir = path.join(options.output, `resource-${options.browser}-${Date.now()}`); mkdirSync(dir);
  const browser = await (options.browser === 'chromium' ? chromium : firefox).launch({ headless: true });
  const server = await fixtureServer();
  const interrupt = () => { void browser.close(); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const rows: ResourceSample[] = [];
  try {
    writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ formatVersion: 1, createdAt: new Date().toISOString(), options, builds,
      harnessHash: createHash('sha256').update(['resource-suite.ts','resource-model.ts','resource-browser.ts','resource-fixtures.ts','resource-probe.ts'].map(name => readFileSync(path.join(import.meta.dirname, name))).join('')).digest('hex'),
      mediaHash: createHash('sha256').update(readFileSync(path.resolve(import.meta.dirname, '../../test/fixtures/vod.webm'))).digest('hex'),
      installation: 'diagnostic-injection-single-world; background/permissions/isolated-world not exercised',
      environment: { platform: process.platform, release: os.release(), cpu: os.cpus()[0]?.model, cores: os.cpus().length,
        memory: os.totalmem(), browser: options.browser, version: browser.version(), headless: true, gpu: 'unverified',
        viewport: [1440, 900], dpr: 1, clock: 'controlled', audio: 'muted fixture', media: 'test/fixtures/vod.webm; no decoding performance claim',
        firefoxCpu: 'unsupported', authenticatedHosts: 'not measured' }, fixtures: options.fixtures }, null, 2));
    for (let round = 1; round <= options.rounds; round++) for (const fixture of options.fixtures) {
      const pair: ResourceSample[] = [];
      for (const build of round % 2 ? builds : [...builds].reverse()) {
        const row = await runFixture(browser, build, fixture, server.origin, options.cycles, round, options.heap ? dir : undefined);
        pair.push(row);
        console.log(`${fixture} ${build.id} ${round}: ${row.accepted ? 'accepted' : row.reason}`);
      }
      completeResourcePair(pair, builds.length);
      for (const row of pair) { rows.push(row); appendFileSync(path.join(dir, 'samples.jsonl'), JSON.stringify(row) + '\n'); }
    }
  } finally {
    writeFileSync(path.join(dir, 'server-requests.json'), JSON.stringify(server.requests, null, 2));
    writeFileSync(path.join(dir, 'SUMMARY.md'), resourceReport(rows));
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    await browser.close(); await server.close();
  }
  console.log(dir);
  if (rows.some(row => !row.accepted)) process.exitCode = 2;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
