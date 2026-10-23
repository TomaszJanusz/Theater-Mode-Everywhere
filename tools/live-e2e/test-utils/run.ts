import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { chromium } from 'playwright';

import { RETRIES, loadQuarantine, parseTargets, splitQuarantine } from '../config';
import { runWithRetries, overall, type AttemptOutcome } from '../lane';
import type { SpecResult, Target } from '../model';

import { runTarget } from './runner';

// Lane entry: LIVE_E2E_TARGETS (private JSON) -> installed Chromium extension -> results.json.
// Usage: tsx tools/live-e2e/test-utils/run.ts <unpacked-extension-dir> <output-dir>
const [extensionDir, outDir] = process.argv.slice(2).map(p => path.resolve(p));
if (!extensionDir || !outDir) throw new Error('usage: run.ts <unpacked-extension-dir> <output-dir>');

const targets = parseTargets(process.env.LIVE_E2E_TARGETS);
const today = new Date().toISOString().slice(0, 10);
const { active, expired } = splitQuarantine(loadQuarantine(), today);
if (expired.length) {
  console.error(`Expired quarantine: ${expired.map(e => `${e.pageType} (owner ${e.owner}, ${e.expires})`).join(', ')}. Fix the page type or renew the entry.`);
  process.exitCode = 1;
}

/** A fresh browser profile per attempt, with trace and video on; they are kept only when the attempt fails. */
async function attemptTarget(target: Target, n: number): Promise<AttemptOutcome> {
  const scratch = mkdtempSync(path.join(tmpdir(), 'te-live-e2e-'));
  const videoDir = path.join(scratch, 'video');
  const context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
    headless: false,
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
    args: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
      `--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
  });
  let results: SpecResult[] = [];
  try {
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = context.pages()[0] ?? await context.newPage();
    results = await runTarget(page, target, { quarantine: active });
  } catch (error) {
    results = [{ pageType: target.pageType, capability: target.capabilities[0], status: 'failed', detail: error instanceof Error ? error.message.split('\n')[0] : String(error) }];
  }
  const failed = results.some(r => r.status === 'failed');
  const kept = path.join(outDir, target.pageType, `attempt-${n}`);
  if (failed) {
    mkdirSync(kept, { recursive: true });
    await context.tracing.stop({ path: path.join(kept, 'trace.zip') });
  } else {
    await context.tracing.stop();
  }
  await context.close(); // finalizes the video
  if (failed) {
    cpSync(videoDir, path.join(kept, 'video'), { recursive: true });
  }
  rmSync(scratch, { recursive: true, force: true });
  return { results, artifacts: failed ? kept : undefined };
}

async function main(): Promise<void> {
  const all: Array<{ pageType: string; status: string; attempts: number; results: SpecResult[]; artifacts: string[] }> = [];
  for (const target of targets) {
    const { results, attempts, artifacts } = await runWithRetries(n => attemptTarget(target, n), RETRIES);
    all.push({ pageType: target.pageType, status: overall(results), attempts, results, artifacts });
    for (const r of results) console.log(`${r.status.toUpperCase().padEnd(7)} ${target.pageType} ${r.capability}${r.detail ? ` - ${r.detail}` : ''}`);
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ date: today, pageTypes: all }, null, 2));
  if (all.some(p => p.status === 'failed')) process.exitCode = 1;
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
