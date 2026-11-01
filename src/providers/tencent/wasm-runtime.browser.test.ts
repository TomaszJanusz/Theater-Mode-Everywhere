import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { chromium, type BrowserContext, type Page } from 'playwright';

import { closeInstallSetup } from '../../../scripts/smoke/first-run-setup';

import { PAGE_URL, VIDEO_PAGE, PLAYER_HTML, FRAME_HTML, PLAIN_HTML } from './test-utils/wasm-fixture';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname, '..');
const EXTENSION = path.join(ROOT, 'dist', 'chrome-unpacked');

function extensionReady(): boolean {
  return existsSync(path.join(EXTENSION, 'content.js')) && existsSync(path.join(EXTENSION, 'manifest.json'));
}

async function dismissDialog(page: Page): Promise<void> {
  const button = page.locator('.te-dialog-btn-primary');
  if (await button.count()) await button.first().click();
}

describe('tencent wasm theater runtime', () => {
  it('drives the fake player from the page and from the wasm frame', async (t) => {
    if (!extensionReady()) {
      t.skip('dist/chrome-unpacked is missing; run pnpm build');
      return;
    }
    const userData = mkdtempSync(path.join(tmpdir(), 'te-wasm-'));
    let context: BrowserContext | null = null;
    try {
      context = await chromium.launchPersistentContext(userData, {
        headless: false,
        viewport: { width: 1280, height: 720 },
        args: [
          '--headless=new',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          `--disable-extensions-except=${EXTENSION}`,
          `--load-extension=${EXTENSION}`
        ]
      });
      await (context.serviceWorkers()[0] ? Promise.resolve() : context.waitForEvent('serviceworker'));
      // The install opens Settings asynchronously; fullscreen needs the player tab to be active.
      await closeInstallSetup(context);
      await context.route('https://v.qq.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: PLAYER_HTML
      }));
      await context.route('https://vm.gtimg.cn/**', (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: FRAME_HTML
      }));
      await context.route('https://example.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: PLAIN_HTML
      }));
      const page = await context.newPage();
      await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
      await dismissDialog(page);

      await page.keyboard.press('t');
      await page.waitForFunction(() => document.documentElement.classList.contains('theater-everywhere-html-active'));
      const enteredOnFake = await page.evaluate(() => ({
        fake: document.getElementById('player')?.hasAttribute('data-theater-everywhere') === true,
        empty: document.getElementById('empty')?.hasAttribute('data-theater-everywhere') === true,
        width: document.getElementById('player')?.getBoundingClientRect().width || 0,
        chrome: getComputedStyle(document.getElementById('chrome')!).visibility,
        nextDisplay: getComputedStyle(document.getElementById('next')!).display
      }));
      assert.equal(enteredOnFake.fake, true);
      assert.equal(enteredOnFake.empty, false);
      assert.ok(enteredOnFake.width > 200);
      assert.equal(enteredOnFake.chrome, 'hidden');
      assert.notEqual(enteredOnFake.nextDisplay, 'none');
      const nextClicks = await page.evaluate(() => {
        const button = document.getElementById('next')!;
        let clicks = 0;
        button.addEventListener('click', () => { clicks += 1; });
        button.click();
        return clicks;
      });
      assert.equal(nextClicks, 1);

      await page.keyboard.press(' ');
      await page.waitForFunction(() => (document.getElementById('player') as { pauseCalls?: number }).pauseCalls === 1);
      await page.keyboard.press(' ');
      await page.waitForFunction(() => (document.getElementById('player') as { playCalls?: number }).playCalls === 1);
      await page.evaluate(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, repeat: true }));
      });
      const afterHold = await page.evaluate(() => (window as unknown as {
        __counts(id: string): { play: number; pause: number; seeks: number[] };
      }).__counts('player'));
      assert.deepEqual(afterHold, { play: 1, pause: 1, seeks: [] });

      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => (document.getElementById('player') as { seekSets?: number[] }).seekSets?.length === 1);
      const afterSeek = await page.evaluate(() => (window as unknown as {
        __counts(id: string): { play: number; pause: number; seeks: number[] };
      }).__counts('player'));
      assert.equal(afterSeek.seeks.length, 1);
      assert.equal(afterSeek.seeks[0], 15);

      await page.keyboard.press('f');
      await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('theater-everywhere-html-active')), true);
      await page.keyboard.press('f');
      await page.waitForFunction(() => document.fullscreenElement == null);

      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
      assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('chrome')!).visibility), 'visible');

      const frame = page.frames().find((item) => item.url().startsWith('https://vm.gtimg.cn/'));
      assert.ok(frame);
      await frame.evaluate(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true }));
      });
      await page.waitForFunction(() => document.getElementById('player')?.hasAttribute('data-theater-everywhere') === true);
      assert.equal(await frame.evaluate(() => document.documentElement.classList.contains('theater-everywhere-html-active')), false);

      await page.evaluate(() => {
        const current = document.getElementById('player')!;
        const next = document.createElement('fake-iframe-video') as HTMLElement;
        next.id = 'player-2';
        next.style.cssText = 'display:block;width:800px;height:450px';
        current.replaceWith(next);
      });
      await page.waitForFunction(() => document.getElementById('player-2')?.hasAttribute('data-theater-everywhere') === true);
      await page.evaluate(() => {
        const current = document.getElementById('player-2')!;
        const next = document.createElement('fake-iframe-video') as HTMLElement;
        next.id = 'player-3';
        next.style.cssText = 'display:block;width:800px;height:450px';
        current.replaceWith(next);
      });
      await page.waitForFunction(() => document.getElementById('player-3')?.hasAttribute('data-theater-everywhere') === true);
      // Exit immediately, then re-enter through the replacement's own frame.
      // This verifies reverse states without depending on the page toggle guard.
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
      await page.frameLocator('#player-3 iframe').locator('body').press('t');
      await page.waitForFunction(() => document.getElementById('player-3')?.hasAttribute('data-theater-everywhere') === true);
      await page.keyboard.press('Escape');

      const plain = await context.newPage();
      await plain.goto(VIDEO_PAGE, { waitUntil: 'domcontentloaded' });
      await plain.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
      await dismissDialog(plain);
      await plain.keyboard.press('t');
      await plain.waitForFunction(() => document.getElementById('plain')?.hasAttribute('data-theater-everywhere') === true);
      assert.equal(await plain.evaluate(() => document.documentElement.classList.contains('theater-everywhere-tencent-stage')), false);
    } finally {
      await context?.close();
      rmSync(userData, { recursive: true, force: true });
    }
  });
});
