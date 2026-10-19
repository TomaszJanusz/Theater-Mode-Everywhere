// Invoked only by test-browser.test.ts: context cleanup must interrupt evaluation.
import { test } from 'node:test';
import { chromium } from 'playwright';
import { sharedTestBrowser } from '../../src/test-utils/test-browser.ts';

const shared = sharedTestBrowser(chromium);
test('timeout closes a shared browser context with a pending evaluation', { timeout: 1000 }, async t => {
  const context = await shared.newContext(t);
  context.browser().on('disconnected', () => console.log('timeout-browser-disconnected'));
  context.on('close', () => console.log('timeout-context-closed'));
  const page = await context.newPage();
  console.log('pending-evaluation-started');
  await page.evaluate(() => new Promise(() => {}));
});

test('a later test can use the same browser after the timeout', async t => {
  const context = await shared.newContext(t);
  const page = await context.newPage();
  await page.evaluate(() => document.title = 'survived');
  if (await page.title() !== 'survived') throw new Error('Browser did not survive timeout');
  console.log('shared-browser-survived-timeout');
});
