import type { Page } from 'playwright';

import { compareSignatures, type DriftResult } from '../drift';
import type { HostFixture } from '../format';
import type { FixtureRecipe } from '../recipes';

import { openRecipePage } from './live';
import { readPageSignature } from './page-eval';

/**
 * Opens the recipe's page as the capture did and compares its probe signature with the
 * recording. An environment block is a skip; a page that never shows the recipe's ready
 * selector is drift, since the probes it waits for are what changed.
 */
export async function checkDrift(page: Page, url: string, fixture: HostFixture, recipe: FixtureRecipe): Promise<DriftResult> {
  try {
    const { blocked } = await openRecipePage(page, url, recipe);
    if (blocked) return { fixture: fixture.id, status: 'skipped', detail: `environment: ${blocked}` };
  } catch (error) {
    return { fixture: fixture.id, status: 'failed', detail: `page never settled: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}` };
  }
  const live = await readPageSignature(page, recipe.probes);
  const drift = compareSignatures(fixture.signature, live);
  return drift.length ? { fixture: fixture.id, status: 'failed', detail: drift.join('\n') } : { fixture: fixture.id, status: 'passed' };
}
