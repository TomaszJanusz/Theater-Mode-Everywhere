import type { Page } from 'playwright';

import { classifyPage, type PageKind } from '../classify';
import type { QuarantineEntry, SpecResult, Target } from '../model';

import { collectSignals } from './signals';
import { SPECS } from './specs';

export interface RunTargetOptions {
  /** Runs after navigation and before classification; tests use it to boot the player on a fixture. */
  afterNavigate?: (page: Page) => Promise<void>;
  quarantine?: readonly QuarantineEntry[];
}

const NAVIGATION_TIMEOUT_MS = 30_000;

function skipAll(target: Target, detail: string): SpecResult[] {
  return target.capabilities.map(capability => ({ pageType: target.pageType, capability, status: 'skipped', detail }));
}

/**
 * Navigates, classifies the page, and only then runs the target's specs. An environment
 * problem (consent wall, challenge, geo block, ad break) or a quarantined page type yields
 * `skipped` results with the reason, never `failed`.
 */
export async function runTarget(page: Page, target: Target, { afterNavigate, quarantine = [] }: RunTargetOptions = {}): Promise<SpecResult[]> {
  const held = quarantine.find(entry => entry.pageType === target.pageType);
  if (held) return skipAll(target, `quarantined until ${held.expires} (owner ${held.owner}): ${held.reason}`);

  let status = 0;
  try {
    const response = await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
    status = response?.status() ?? 0;
  } catch (error) {
    // A page that never loads says nothing about the extension; the network is the environment.
    return skipAll(target, `environment: navigation failed (${error instanceof Error ? error.message.split('\n')[0] : 'unknown'})`);
  }
  await afterNavigate?.(page);

  const verdict = classifyPage(await collectSignals(page, status));
  if (verdict.kind !== 'ok') return skipAll(target, `environment: ${describeKind(verdict.kind)} (${verdict.reason})`);

  const results: SpecResult[] = [];
  for (const [index, capability] of target.capabilities.entries()) {
    try {
      // A new document per spec keeps the key repeat guard and leftover state of the previous one out.
      if (index > 0) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
        await afterNavigate?.(page);
      }
      await SPECS[capability](page, target);
      results.push({ pageType: target.pageType, capability, status: 'passed' });
    } catch (error) {
      results.push({ pageType: target.pageType, capability, status: 'failed', detail: describeError(error) });
      // Later specs would start from an undefined state.
      break;
    }
  }
  return results;
}

/** The first lines of Playwright's message: enough to triage without the full call log. */
function describeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n').slice(0, 8).join(' | ').slice(0, 700);
}

function describeKind(kind: PageKind): string {
  return kind.replace('-', ' ');
}
