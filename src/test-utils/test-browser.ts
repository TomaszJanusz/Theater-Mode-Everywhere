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
  // A failed launch is already reported by the tests that asked for it. Rethrowing it here would fail this
  // hook and skip the teardown of every other browser in the file, leaving a live process that holds the
  // runner open until the CI step times out.
  after(async () => { await (await pending?.catch(() => undefined))?.close(); }, { timeout: 10_000 });
  return {
    async newContext(test, options) {
      let context: BrowserContext | undefined;
      test.after(() => context?.close(), { timeout: 10_000 });
      pending ??= engine.launch(launchOptions).catch((error: unknown) => {
        // The runner prints failure details only when it finishes; say what happened at once.
        console.error(`[test-browser] launch failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
        throw error;
      });
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
