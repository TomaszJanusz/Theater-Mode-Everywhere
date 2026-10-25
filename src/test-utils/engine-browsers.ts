import { chromium, firefox } from 'playwright';

import { sharedTestBrowser } from './test-browser';
import type { TestEngine } from './test-engines';

/**
 * One lazy shared browser per engine for the calling file: each launches on its first context, so a
 * file that only uses `browsers.chromium` never starts Firefox. Call at module top level (or inside
 * the `describe` that owns the browsers) so the `after` hooks belong to that file or suite.
 */
export function sharedEngineBrowsers(): Record<TestEngine, ReturnType<typeof sharedTestBrowser>> {
  return { chromium: sharedTestBrowser(chromium), firefox: sharedTestBrowser(firefox) };
}
