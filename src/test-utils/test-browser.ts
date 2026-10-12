import type { TestContext } from 'node:test';
import type { Browser } from 'playwright';

/** A timed-out body may never reach its finally block while evaluation is pending. */
export function ownTestBrowser(test: TestContext, browser: Browser): void {
  test.after(() => browser.close(), { timeout: 10_000 });
}
