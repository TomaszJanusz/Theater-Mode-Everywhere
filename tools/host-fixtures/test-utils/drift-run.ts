import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { RETRIES, parseTargets } from '../../live-e2e/config';
import { runWithRetries } from '../../live-e2e/lane';
import { maskValues, redactorFor } from '../../live-e2e/redact';
import { COMMITTED_FIXTURES } from '../committed';
import { driftLine, type DriftResult } from '../drift';
import type { HostFixture } from '../format';
import { recipeFor } from '../recipes';

import { checkDrift } from './drift-check';
import { withInstalledChromium } from './live';

// Nightly drift hook: every committed recording against its live page type -> drift.json.
// Usage: tsx tools/host-fixtures/test-utils/drift-run.ts <unpacked-extension-dir> <output-dir>
// Non-blocking: drift is reported (log, annotation, summary, rolling issue), never a failed step.
const [extensionDir, outDir] = process.argv.slice(2).map(p => path.resolve(p));
if (!extensionDir || !outDir) throw new Error('usage: drift-run.ts <unpacked-extension-dir> <output-dir>');

const targets = parseTargets(process.env.LIVE_E2E_TARGETS);
// Same rule as the live lane: the target list is private and every output is public.
if (process.env.GITHUB_ACTIONS === 'true') for (const value of maskValues(targets)) console.log(`::add-mask::${value}`);
const redact = redactorFor(targets);

async function attempt(fixture: HostFixture, url: string): Promise<DriftResult> {
  const recipe = recipeFor(fixture.id);
  try {
    return await withInstalledChromium(extensionDir, recipe.viewport, page => checkDrift(page, url, fixture, recipe));
  } catch (error) {
    return { fixture: fixture.id, status: 'failed', detail: `check crashed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}` };
  }
}

/** A drift gets the live lane's single retry in a fresh profile; a pass on retry stays visible. */
async function check(fixture: HostFixture): Promise<DriftResult> {
  const { pageType } = recipeFor(fixture.id);
  const target = targets.find(candidate => candidate.pageType === pageType);
  if (!target) return { fixture: fixture.id, status: 'skipped', detail: `no LIVE_E2E_TARGETS entry for page type ${pageType}` };
  const { results: [result] } = await runWithRetries(async () => ({ results: [await attempt(fixture, target.url)] }), RETRIES);
  return result.detail === undefined ? result : { ...result, detail: redact(result.detail) };
}

async function main(): Promise<void> {
  const results: DriftResult[] = [];
  for (const fixture of COMMITTED_FIXTURES) {
    const result = await check(fixture);
    results.push(result);
    const line = redact(driftLine(result));
    console.log(line);
    if (result.status === 'failed' && process.env.GITHUB_ACTIONS === 'true') console.log(`::warning title=Host drift::${line}. Refresh the recording, then fix the provider.`);
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'drift.json'), redact(JSON.stringify({ date: new Date().toISOString().slice(0, 10), fixtures: results }, null, 2)));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Host drift\n\n${results.map(result => `- ${redact(driftLine(result))}`).join('\n')}\n`);
  }
}

void main().catch(error => { console.error(redact(error instanceof Error ? error.stack ?? error.message : String(error))); process.exitCode = 1; });
