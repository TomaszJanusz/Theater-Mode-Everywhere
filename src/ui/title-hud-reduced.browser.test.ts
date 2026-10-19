import { testEngines } from '../test-utils/test-engines';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { it } from 'node:test';
import type { Locator, Page } from 'playwright';
import { readStylesheet } from '../test-utils/styles';
import { ownTestBrowser } from '../test-utils/test-browser';

const require = createRequire(import.meta.url);
const SRC = new URL('../', import.meta.url).pathname;
const PAGE_CSS = readStylesheet(path.join(SRC, 'content.css'));
const UI_CSS = readStylesheet(path.join(SRC, 'ui/shadow.css'));
const esbuild = require('esbuild') as { buildSync(options: object): { outputFiles: Array<{ text: string }> } };
const BUNDLE = esbuild.buildSync({
  stdin: {
    contents: "export { bootstrapPlayerRuntime } from './ui/player-runtime';\nexport { setPlayerUiCss } from './ui/root';",
    resolveDir: SRC, loader: 'ts'
  },
  bundle: true, write: false, format: 'iife', globalName: 'TitleHudTest', platform: 'browser', target: 'es2022', logLevel: 'silent'
}).outputFiles[0].text;
const TITLE = 'A Remarkably Long Documentary About Mountain Weather Systems, Part 12 - Summit Day';
const FIXTURE = `<!doctype html><html><head><title>${TITLE}</title>
  <style>body { margin:0; background:#111; } video { width:960px; height:540px; }</style></head>
  <body><video id="player" title="${TITLE}" muted playsinline></video><script>
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#1c2634'; ctx.fillRect(0, 0, 1280, 720);
    const video = document.querySelector('video'); video.srcObject = canvas.captureStream(12);
    setInterval(() => { ctx.fillRect(0, 0, 1, 1); }, 100); video.play();
  </script></body></html>`;

const style = (hud: Locator, selector: string, property: string) =>
  hud.evaluate((el, [sel, prop]) => getComputedStyle(el.querySelector(sel)!).getPropertyValue(prop), [selector, property]);

const titleFocused = (page: Page, visibly = false) => page.evaluate(visible => {
  const title = document.querySelector('#theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-everywhere-title-hud')!;
  return title.getRootNode() instanceof ShadowRoot && (title.getRootNode() as ShadowRoot).activeElement === title && (!visible || title.matches(':focus-visible'));
}, visibly);

async function boot(page: Page, dir: 'ltr' | 'rtl'): Promise<void> {
  await page.route('http://title-hud.test/**', route => route.fulfill({ contentType: 'text/html', body: FIXTURE }));
  await page.goto('http://title-hud.test/');
  await page.evaluate(`window.__listeners = new Set(); window.chrome = { runtime: {}, storage: {
    sync: { get: (_keys, callback) => { const data = { keepControlsVisible: true, reduceMotion: 'on' }; callback?.(data); return Promise.resolve(data); }, set: async () => {} },
    onChanged: { addListener: fn => window.__listeners.add(fn), removeListener: fn => window.__listeners.delete(fn) }
  } };`);
  await page.addStyleTag({ content: PAGE_CSS });
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(`TitleHudTest.setPlayerUiCss(${JSON.stringify(UI_CSS)}); TitleHudTest.bootstrapPlayerRuntime();`);
  await page.waitForFunction(() => { const v = document.querySelector('video'); return Boolean(v && v.readyState >= 2 && !v.paused); });
  await page.keyboard.press('t');
  await page.locator('.theater-controls-wrapper.visible').waitFor();
  await page.locator('.theater-everywhere-title-hud.marquee').waitFor();
  await page.evaluate(d => document.querySelector('#theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-everywhere-title-hud')!.setAttribute('dir', d), dir);
}

for (const engine of testEngines()) for (const dir of ['ltr', 'rtl'] as const) {
  it(`${engine}/${dir}: reduced-motion title keeps head and tail, reveals in full, and follows the setting live`, { timeout: 60_000 }, async t => {
    const browser = await (await import('playwright'))[engine].launch({ headless: true });
    ownTestBrowser(t, browser);
    const page = await browser.newPage({ viewport: { width: 700, height: 600 } });
    await boot(page, dir);
    const hud = page.locator('.theater-everywhere-title-hud');

    // Resting: static head…tail; the real text stays in the accessibility tree.
    assert.equal(await style(hud, '.theater-title-hud-smart', 'display'), 'flex');
    assert.equal(await style(hud, '.theater-title-hud-track', 'animation-name'), 'none');
    const rest = await hud.evaluate(el => {
      const head = el.querySelector<HTMLElement>('.theater-title-hud-head')!;
      const tail = el.querySelector<HTMLElement>('.theater-title-hud-tail')!;
      const box = el.getBoundingClientRect(), tailBox = tail.getBoundingClientRect();
      return { truncated: head.scrollWidth > head.clientWidth, tail: tail.textContent, inside: tailBox.left >= box.left && tailBox.right <= box.right,
        label: el.querySelector('.theater-title-hud-text')!.textContent, tab: el.getAttribute('tabindex'), title: el.getAttribute('title') };
    });
    assert.equal(rest.truncated, true);
    assert.ok(rest.tail && TITLE.endsWith(rest.tail.trim()) && rest.inside, JSON.stringify(rest));
    assert.equal(rest.label, TITLE);
    assert.equal(rest.tab, '0');
    assert.equal(rest.title, null);
    const restHeight = (await hud.boundingBox())!.height;

    // Keyboard focus reveals it; the first Escape closes the reveal and theater stays open.
    // Backwards from the page start, focus wraps to the last item: the title (Chromium first leaves the page).
    for (let i = 0; i < 6 && !(await titleFocused(page)); i++) await page.keyboard.press('Shift+Tab');
    assert.equal(await titleFocused(page, true), true, 'Shift+Tab reaches the title');
    assert.equal(await style(hud, '.theater-title-hud-smart', 'display'), 'none');
    await page.keyboard.press('Escape');
    assert.equal(await style(hud, '.theater-title-hud-smart', 'display'), 'flex');
    assert.equal(await page.locator('.theater-controls-wrapper').count(), 1, 'theater was not exited');

    // Hover reveals the whole title on wrapped lines, without motion.
    await hud.hover();
    assert.equal(await style(hud, '.theater-title-hud-smart', 'display'), 'none');
    // Poll the settled layout: the wrapped height lands a frame after :hover applies.
    await page.waitForFunction(rest => {
      const title = document.querySelector('#theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-everywhere-title-hud')!;
      return title.getBoundingClientRect().height > rest * 1.4;
    }, restHeight, { timeout: 5000 });
    assert.equal(await style(hud, '.theater-title-hud-text-clone', 'display'), 'none', 'the scroll clone never shows twice');
    await page.mouse.move(5, 500);
    assert.equal(await style(hud, '.theater-title-hud-smart', 'display'), 'flex');

    // Turning the setting off restores the scrolling title live.
    await page.evaluate(() => window.__listeners.forEach((fn) => fn({ reduceMotion: { newValue: 'off' } }, 'sync')));
    await page.waitForFunction(() => !document.querySelector('#theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-everywhere-title-hud')!.hasAttribute('tabindex'));
    assert.equal(await style(hud, '.theater-title-hud-track', 'animation-name'), dir === 'rtl' ? 'theater-title-marquee-rtl' : 'theater-title-marquee');
    assert.equal(await style(hud, '.theater-title-hud-smart', 'display'), 'none');
    assert.equal(await hud.getAttribute('title'), TITLE);
  });
}

declare global { interface Window { __listeners: Set<(changes: object, area: string) => void> } }
