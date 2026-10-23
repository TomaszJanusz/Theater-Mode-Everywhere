import { after, type TestContext } from 'node:test';

import type { Browser, BrowserContext, BrowserContextOptions, BrowserType, LaunchOptions } from 'playwright';

/** A timed-out body may never reach its finally block while evaluation is pending. */
export function ownTestBrowser(test: TestContext, browser: Browser): void {
  test.after(() => browser.close(), { timeout: 10_000 });
}

/** One lazy browser per file/suite; each test owns an isolated context. */
export function sharedTestBrowser(engine: BrowserType, launchOptions: LaunchOptions = { headless: true }): {
  newContext(test: TestContext, options?: BrowserContextOptions): Promise<BrowserContext>;
} {
  let pending: Promise<Browser> | undefined;
  after(async () => { await (await pending)?.close(); }, { timeout: 10_000 });
  return {
    async newContext(test, options) {
      let context: BrowserContext | undefined;
      test.after(() => context?.close(), { timeout: 10_000 });
      pending ??= engine.launch(launchOptions);
      const browser = await pending;
      context = await browser.newContext(options);
      // Creation can finish after a timeout has already run the cleanup hook.
      if (test.signal.aborted) {
        await context.close();
        throw new Error('Test ended while creating its browser context');
      }
      return context;
    }
  };
}
