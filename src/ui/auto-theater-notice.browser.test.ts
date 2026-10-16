import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { it } from 'node:test';
import type { Page } from 'playwright';
import { readStylesheet } from '../test-utils/styles';
import { ownTestBrowser } from '../test-utils/test-browser';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild') as { buildSync(options: object): { outputFiles: Array<{ text: string }> } };
const BUNDLE = esbuild.buildSync({
  stdin: {
    contents: "export { showAutoTheaterNotice } from './ui/auto-theater-notice'; export { setPlayerUiCss } from './ui/root';",
    resolveDir: new URL('../', import.meta.url).pathname, loader: 'ts'
  },
  bundle: true, write: false, format: 'iife', globalName: 'NoticeTest', platform: 'browser', target: 'es2022', logLevel: 'silent'
}).outputFiles[0].text;
const CSS = readStylesheet(new URL('./shadow.css', import.meta.url));

declare global {
  interface Window {
    NoticeTest: {
      showAutoTheaterNotice(paint: (element: HTMLElement) => void, cancel: () => void, remainingMs: () => number): () => void;
      setPlayerUiCss(css: string): void;
    };
    noticeHide: () => void;
  }
}

/** Shows the notice with a 3 s deadline on the page's fake clock. */
async function mountNotice(page: Page): Promise<void> {
  await page.addInitScript('window.__name = target => target;');
  await page.goto('about:blank');
  await page.addScriptTag({ content: BUNDLE });
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  await page.evaluate(css => {
    window.NoticeTest.setPlayerUiCss(css);
    const deadline = performance.now() + 3000;
    window.noticeHide = window.NoticeTest.showAutoTheaterNotice(() => {}, () => {}, () => Math.max(0, deadline - performance.now()));
  }, CSS);
}

const readout = (page: Page) => page.evaluate(() => {
  const count = document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-auto-notice-count');
  return count ? { text: count.querySelector('.theater-time-glyph:not(.is-leaving)')!.textContent, ariaHidden: count.getAttribute('aria-hidden'), rolling: count.querySelectorAll('.is-rolling').length } : null;
});

for (const engine of ['chromium', 'firefox'] as const) {
  it(`${engine}: the notice counts the remaining seconds with the shared digit roll and stops on cleanup`, { timeout: 40_000 }, async t => {
    const browser = await (await import('playwright'))[engine].launch({ headless: true });
    ownTestBrowser(t, browser);
    const page = await browser.newPage();
    await mountNotice(page);
    assert.deepEqual(await readout(page), { text: '3', ariaHidden: 'true', rolling: 0 });
    await page.clock.runFor(999);
    assert.equal((await readout(page))!.text, '3');
    await page.clock.runFor(1);
    assert.deepEqual(await readout(page), { text: '2', ariaHidden: 'true', rolling: 1 }, 'a changed second rolls through the slot');
    await page.clock.runFor(1000);
    assert.equal((await readout(page))!.text, '1');
    await page.clock.runFor(5000);
    assert.equal((await readout(page))!.text, '1', 'the last second holds while entry waits for playback');
    const notice = page.locator('#theater-everywhere-ui .theater-auto-notice');
    assert.equal(await notice.getAttribute('aria-live'), 'polite');
    assert.match((await notice.getAttribute('aria-label'))!, /Entering theater mode/);

    // Reduced motion swaps the digit without a roll.
    await page.evaluate(() => { document.documentElement.dataset.motion = 'reduced'; window.noticeHide(); });
    await page.evaluate(() => {
      const end = performance.now() + 3000;
      window.noticeHide = window.NoticeTest.showAutoTheaterNotice(() => {}, () => {}, () => Math.max(0, end - performance.now()));
    });
    await page.clock.runFor(1000);
    assert.deepEqual(await readout(page), { text: '2', ariaHidden: 'true', rolling: 0 });

    // Cleanup removes the notice and leaves no timer to touch it again.
    await page.evaluate(() => { window.noticeHide(); window.noticeHide(); });
    assert.equal(await readout(page), null);
    await page.clock.runFor(5000);
    assert.equal(await readout(page), null);
  });
}
