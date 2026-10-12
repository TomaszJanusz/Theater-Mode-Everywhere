// Invoked only by test-browser.test.ts: this child must fail and exit promptly.
import { test } from 'node:test';
import { chromium } from 'playwright';
import { ownTestBrowser } from '../../src/test-utils/test-browser.ts';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
browser.on('disconnected', () => console.log('timeout-browser-disconnected'));
test('timeout closes a browser with a pending evaluation', { timeout: 100 }, async t => {
  ownTestBrowser(t, browser);
  console.log('pending-evaluation-started');
  await page.evaluate(() => new Promise(() => {}));
});
