import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { chromium, type Page } from 'playwright';

import { classifyPage } from '../../live-e2e/classify';
import { collectSignals } from '../../live-e2e/test-utils/signals';
import { signatureScript } from '../page-inspect';
import type { FixtureRecipe } from '../recipes';

const NAVIGATION_TIMEOUT_MS = 30_000;
const SETTLE_TIMEOUT_MS = 15_000;

/** The installed unpacked Chromium build in a throwaway profile, as the live E2E lane runs it. */
export async function withInstalledChromium<T>(extensionDir: string, viewport: FixtureRecipe['viewport'], use: (page: Page) => Promise<T>): Promise<T> {
  const scratch = mkdtempSync(path.join(tmpdir(), 'te-host-fixture-'));
  const context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
    headless: false,
    viewport,
    locale: 'en-US',
    args: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--mute-audio',
      `--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
  });
  try {
    return await use(context.pages()[0] ?? await context.newPage());
  } finally {
    await context.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Opens a recipe's page and waits until the probes have settled. A consent wall, challenge or
 * other environment block (the live E2E lane's classification) returns its reason instead:
 * such a page says nothing about the host's structure.
 */
export async function openRecipePage(page: Page, url: string, recipe: FixtureRecipe): Promise<{ blocked: string | null }> {
  let status = 0;
  try {
    status = (await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS }))?.status() ?? 0;
  } catch (error) {
    return { blocked: `navigation failed (${error instanceof Error ? error.message.split('\n')[0] : 'unknown'})` };
  }
  const verdict = classifyPage(await collectSignals(page, status));
  if (verdict.kind !== 'ok') return { blocked: `${verdict.kind.replace('-', ' ')} (${verdict.reason})` };
  await page.waitForSelector(recipe.ready, { state: 'attached', timeout: SETTLE_TIMEOUT_MS });
  if (recipe.prepare) {
    await page.click(recipe.prepare.click, { timeout: SETTLE_TIMEOUT_MS });
    await page.waitForSelector(recipe.prepare.until, { state: 'attached', timeout: SETTLE_TIMEOUT_MS });
  }
  // Hosts slide panels in after mounting them: wait until two polls see the same signature.
  // The reader is installed through the debugger protocol: Trusted Types and CSP forbid eval in the page.
  await page.evaluate(`(() => { window.__teSignature = () => JSON.stringify(${signatureScript(recipe.probes)}); })()`);
  await page.waitForFunction(() => {
    const state = window as unknown as { __teSignature: () => string; __teLastSignature?: string };
    const current = state.__teSignature();
    const settled = state.__teLastSignature === current;
    state.__teLastSignature = current;
    return settled;
  }, undefined, { polling: 300, timeout: SETTLE_TIMEOUT_MS });
  return { blocked: null };
}
