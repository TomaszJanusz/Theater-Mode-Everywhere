import type { Page } from 'playwright';

import type { Signature } from '../format';
import { inspectHostPage, type InspectOptions, type PageInspection, SKIPPED_TAGS } from '../page-inspect';

/**
 * tsx wraps named functions in `__name()`, which a page lacks; Playwright sends the functions above as
 * written. Run before every evaluation, since a navigation drops it. Only function arguments cross to
 * the page: Trusted Types and CSP on hosts forbid building code from strings there.
 */
const defineNameShim = (page: Page): Promise<void> => page.evaluate(() => { (globalThis as { __name?: <T>(target: T) => T }).__name = target => target; });

const readPage = (page: Page, options: InspectOptions, withTree: boolean) =>
  page.evaluate(inspectHostPage, { ...options, skippedTags: SKIPPED_TAGS, withTree });

export async function readPageSignature(page: Page, probes: Record<string, string>): Promise<Signature> {
  await defineNameShim(page);
  return (await readPage(page, { probes, keepDepth: 0, maxChildren: 0, attributes: [] }, false)).signature;
}

/** The tree and the signature come from one evaluation, so a mutating host cannot make them disagree. */
export async function inspectPage(page: Page, options: InspectOptions): Promise<PageInspection> {
  await defineNameShim(page);
  const { signature, tree } = await readPage(page, options, true);
  if (!tree) throw new Error('The page evaluation returned no tree.');
  return { ...tree, signature };
}
