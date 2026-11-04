import type { Page } from 'playwright';

import type { Signature } from '../format';
import { inspectHostPage, type InspectOptions, type PageInspection, readSignature, SKIPPED_TAGS } from '../page-inspect';

/**
 * tsx wraps named functions in `__name()`, which a page lacks; Playwright sends the functions above as
 * written. Run before every evaluation, since a navigation drops it. Only function arguments cross to
 * the page: Trusted Types and CSP on hosts forbid building code from strings there.
 */
const defineNameShim = (page: Page): Promise<void> => page.evaluate(() => { (globalThis as { __name?: <T>(target: T) => T }).__name = target => target; });

export async function readPageSignature(page: Page, probes: Record<string, string>): Promise<Signature> {
  await defineNameShim(page);
  return page.evaluate(readSignature, probes);
}

export async function inspectPage(page: Page, options: InspectOptions): Promise<PageInspection> {
  await defineNameShim(page);
  const tree = await page.evaluate(inspectHostPage, { ...options, skippedTags: SKIPPED_TAGS });
  return { ...tree, signature: await page.evaluate(readSignature, options.probes) };
}
