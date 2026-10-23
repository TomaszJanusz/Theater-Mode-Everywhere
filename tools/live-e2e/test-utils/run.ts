import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { chromium } from 'playwright';

import { RETRIES, loadQuarantine, parseTargets, splitQuarantine } from '../config';
import { runWithRetries, overall, type AttemptOutcome } from '../lane';
import type { SpecResult, Target } from '../model';
import { maskValues, redactorFor } from '../redact';
import { logLine, serializeResults, type PageTypeReport } from '../report';

import { runTarget } from './runner';

// Lane entry: LIVE_E2E_TARGETS (repository variable JSON) -> installed Chromium extension -> results.json.
// Usage: tsx tools/live-e2e/test-utils/run.ts <unpacked-extension-dir> <output-dir>
const [extensionDir, outDir] = process.argv.slice(2).map(p => path.resolve(p));
if (!extensionDir || !outDir) throw new Error('usage: run.ts <unpacked-extension-dir> <output-dir>');

const targets = parseTargets(process.env.LIVE_E2E_TARGETS);
// The repository and its logs are public: mask every target before anything is printed, and
// redact what is written afterwards. Repository variables are not masked by Actions.
if (process.env.GITHUB_ACTIONS === 'true') for (const value of maskValues(targets)) console.log(`::add-mask::${value}`);
const redact = redactorFor(targets);
const today = new Date().toISOString().slice(0, 10);
const { active, expired } = splitQuarantine(loadQuarantine(), today);
if (expired.length) {
  console.error(`Expired quarantine: ${expired.map(e => `${e.pageType} (owner ${e.owner}, ${e.expires})`).join(', ')}. Fix the page type or renew the entry.`);
  process.exitCode = 1;
}

/**
 * A fresh browser profile per attempt. No trace, video or screenshot is kept: the repository is
 * public, so those artifacts would publish the private target pages. Reproduce a failure locally
 * with the private list (docs/browser-tests.md).
 */
async function attemptTarget(target: Target): Promise<AttemptOutcome> {
  const scratch = mkdtempSync(path.join(tmpdir(), 'te-live-e2e-'));
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let results: SpecResult[];
  try {
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      headless: false,
      viewport: { width: 1280, height: 720 },
      args: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
        `--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
    });
    const page = context.pages()[0] ?? await context.newPage();
    results = await runTarget(page, target, { quarantine: active });
  } catch (error) {
    results = [{ pageType: target.pageType, capability: target.capabilities[0], status: 'failed', detail: redact(error instanceof Error ? error.message.split('\n')[0] : String(error)) }];
  } finally {
    await context?.close();
    rmSync(scratch, { recursive: true, force: true });
  }
  return { results };
}

async function main(): Promise<void> {
  const all: PageTypeReport[] = [];
  for (const target of targets) {
    const { results, attempts } = await runWithRetries(() => attemptTarget(target), RETRIES);
    all.push({ pageType: target.pageType, status: overall(results), attempts, results });
    for (const r of results) console.log(logLine(target.pageType, r, redact));
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'results.json'), serializeResults(today, all, redact));
  if (all.some(p => p.status === 'failed')) process.exitCode = 1;
}

void main().catch(error => { console.error(redact(error instanceof Error ? error.stack ?? error.message : String(error))); process.exitCode = 1; });
