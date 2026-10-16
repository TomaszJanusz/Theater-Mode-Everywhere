import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { it } from 'node:test';
import type { Page } from 'playwright';
import { readStylesheet } from '../test-utils/styles';
import { ownTestBrowser } from '../test-utils/test-browser';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild') as { buildSync(options: object): { outputFiles: Array<{ text: string }> } };
const BUNDLE = esbuild.buildSync({
  stdin: {
    contents: "export { bootstrapPlayerRuntime } from './ui/player-runtime'; export { setPlayerUiCss } from './ui/root'; export { showAutoTheaterNotice } from './ui/auto-theater-notice';",
    resolveDir: new URL('../', import.meta.url).pathname, loader: 'ts'
  },
  bundle: true, write: false, format: 'iife', globalName: 'ActivatorTest', platform: 'browser', target: 'es2022', logLevel: 'silent'
}).outputFiles[0].text;
const CSS = readStylesheet(new URL('./shadow.css', import.meta.url));
const MEDIA = `data:video/webm;base64,${readFileSync(new URL('../../test/fixtures/vod.webm', import.meta.url)).toString('base64')}`;

declare global {
  interface Window {
    ActivatorTest: {
      bootstrapPlayerRuntime(): void;
      setPlayerUiCss(css: string): void;
      showAutoTheaterNotice(paint: (element: HTMLElement) => void, cancel: () => void): () => void;
    };
    storageListeners: Array<(changes: Record<string, { newValue?: unknown }>, area: string) => void>;
    pointeroverListeners: number;
  }
}

const PAGE = `<style>
  body { margin: 0; }
  #player { position: absolute; left: 100px; top: 80px; width: 640px; height: 360px; background: #111; }
  video { display: block; width: 640px; height: 360px; }
  .ui { position: absolute; width: 48px; height: 48px; }
  #small { position: absolute; left: 800px; top: 80px; width: 120px; height: 68px; }
</style>
<div id="player"><video id="main"></video></div>
<video id="small"></video>
<p style="position:absolute;top:600px">Outside</p>`;

async function boot(page: Page, stored: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript(`window.__name = target => target; window.storageListeners = []; window.pointeroverListeners = 0;
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, ...rest) { if (type === 'pointerover') window.pointeroverListeners++; return add.call(this, type, ...rest); };
    window.chrome = { runtime: { onMessage: { addListener() {} } }, storage: {
      sync: { get: async () => (${JSON.stringify({ keepControlsVisible: true, ...stored })}), set: async () => {} },
      local: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener: fn => window.storageListeners.push(fn), removeListener() {} } } };`);
  await page.route('https://activator.test/**', route => route.fulfill({ contentType: 'text/html', body: PAGE }));
  await page.goto('https://activator.test/');
  await page.evaluate(media => {
    for (const video of document.querySelectorAll('video')) video.src = media;
  }, MEDIA);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('video')).every(video => video.readyState >= 1));
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(css => {
    window.ActivatorTest.setPlayerUiCss(css);
    window.ActivatorTest.bootstrapPlayerRuntime();
  }, CSS);
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
}

/** The launcher's box in viewport coordinates, or null while it is not in the extension's shadow root. */
async function launcher(page: Page): Promise<{ x: number; y: number; width: number; label: string | null } | null> {
  return page.evaluate(() => {
    const button = document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator');
    if (!button) return null;
    // Layout position: the entrance animation scales the painted box.
    const box = button as HTMLElement;
    return { x: box.offsetLeft, y: box.offsetTop, width: box.offsetWidth, label: button.getAttribute('aria-label') };
  });
}

async function hover(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(2, 590);
  await page.mouse.move(x, y);
}

for (const engine of ['chromium', 'firefox'] as const) {
  const launch = async (t: Parameters<typeof ownTestBrowser>[0], stored?: Record<string, unknown>) => {
    const browser = await (await import('playwright'))[engine].launch({ headless: true });
    ownTestBrowser(t, browser);
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    page.setDefaultTimeout(6_000);
    await boot(page, stored);
    return page;
  };

  it(`${engine}: activator appears in the top-right corner on hover and leaves with the pointer`, { timeout: 40_000 }, async t => {
    const page = await launch(t);
    assert.equal(await launcher(page), null);
    await hover(page, 400, 260);
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
    const box = (await launcher(page))!;
    assert.equal(box.label, 'Enter theater mode');
    assert.equal(box.x, 100 + 640 - 12 - 40);
    assert.equal(box.y, 80 + 12);
    await page.mouse.move(400, 600);
    await page.waitForFunction(() => !document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
  });

  it(`${engine}: activator avoids page UI and covered corners, and appears nowhere when all are covered`, { timeout: 40_000 }, async t => {
    const page = await launch(t);
    await page.evaluate(() => {
      const share = document.createElement('button');
      share.className = 'ui'; share.id = 'share'; share.textContent = 'Share';
      share.style.cssText = 'right:0;top:0';
      document.getElementById('player')!.append(share);
    });
    await hover(page, 400, 260);
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
    assert.equal((await launcher(page))!.x, 100 + 12, 'top-right is occupied, so the top-left corner is used');
    // A transparent click-catcher over the whole player is not page UI.
    await page.evaluate(() => {
      const shield = document.createElement('div');
      shield.style.cssText = 'position:absolute;inset:0';
      document.getElementById('player')!.append(shield);
    });
    await hover(page, 420, 280);
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
    // Cover the remaining corners with a toolbar: nothing is free, so nothing is shown.
    await page.evaluate(() => {
      for (const css of ['left:0;top:0', 'left:0;bottom:0', 'right:0;bottom:0']) {
        const ui = document.createElement('a');
        ui.href = '#'; ui.className = 'ui'; ui.style.cssText = css; ui.textContent = 'x';
        document.getElementById('player')!.append(ui);
      }
    });
    await hover(page, 450, 300);
    await page.waitForTimeout(150);
    assert.equal(await launcher(page), null);
  });

  it(`${engine}: previews, tiny videos and extension UI never get an activator`, { timeout: 40_000 }, async t => {
    const page = await launch(t);
    await hover(page, 860, 114);
    await page.waitForTimeout(150);
    assert.equal(await launcher(page), null, 'a 120x68 video is not a player');
    await page.evaluate(() => {
      const main = document.getElementById('main') as HTMLVideoElement;
      main.muted = true; main.loop = true;
    });
    await hover(page, 400, 260);
    await page.waitForTimeout(150);
    assert.equal(await launcher(page), null, 'muted looping video is a preview');
    await page.evaluate(() => { const main = document.getElementById('main') as HTMLVideoElement; main.muted = false; main.loop = false; });
    await hover(page, 400, 270);
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
    // Pointing at the extension's own interface hides it instead of re-evaluating the video beneath.
    await page.evaluate(() => {
      const hud = window.ActivatorTest.showAutoTheaterNotice(() => {}, () => {});
      (window as unknown as { hideNotice: () => void }).hideNotice = hud;
    });
    const notice = page.locator('#theater-everywhere-ui .theater-auto-notice');
    const noticeBox = (await notice.boundingBox())!;
    await page.mouse.move(noticeBox.x + noticeBox.width / 2, noticeBox.y + noticeBox.height / 2);
    await page.waitForFunction(() => !document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
  });

  it(`${engine}: click opens theater for the hovered video once and the launcher stays out of theater`, { timeout: 40_000 }, async t => {
    const page = await launch(t);
    await hover(page, 400, 260);
    const box = await (async () => { await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator')); return (await launcher(page))!; })();
    await page.mouse.click(box.x + 20, box.y + 20);
    await page.waitForSelector('video[data-theater-everywhere]');
    assert.equal(await page.locator('video[data-theater-everywhere]').evaluate(video => video.id), 'main');
    assert.equal(await launcher(page), null);
    await page.mouse.move(300, 300);
    await page.mouse.move(500, 320);
    await page.waitForTimeout(150);
    assert.equal(await launcher(page), null, 'no launcher while theater is open');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('video[data-theater-everywhere]'));
    await hover(page, 400, 260);
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
  });

  it(`${engine}: keyboard focus and Escape`, { timeout: 40_000 }, async t => {
    const page = await launch(t);
    await hover(page, 400, 260);
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
    await page.evaluate(() => (document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-video-activator') as HTMLElement).focus());
    await page.keyboard.press('Escape');
    assert.equal(await launcher(page), null);
    await hover(page, 420, 280);
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
    await page.evaluate(() => (document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-video-activator') as HTMLElement).focus());
    await page.keyboard.press('Enter');
    await page.waitForSelector('video[data-theater-everywhere]');
  });

  it(`${engine}: replacing or removing the video, and navigating, clear the launcher`, { timeout: 40_000 }, async t => {
    const page = await launch(t);
    await hover(page, 400, 260);
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
    await page.evaluate(() => document.getElementById('main')!.remove());
    await page.waitForFunction(() => !document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
  });

  it(`${engine}: the setting off installs no listener and no DOM, and applies live`, { timeout: 40_000 }, async t => {
    const page = await launch(t, { videoActivator: false });
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
    const before = await page.evaluate(() => window.pointeroverListeners);
    await hover(page, 400, 260);
    await page.waitForTimeout(150);
    assert.equal(await launcher(page), null);
    await page.evaluate(() => { for (const listener of window.storageListeners) listener({ videoActivator: { newValue: true } }, 'sync'); });
    await page.waitForFunction(count => window.pointeroverListeners > count, before);
    await hover(page, 420, 280);
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
    await page.evaluate(() => { for (const listener of window.storageListeners) listener({ videoActivator: { newValue: false } }, 'sync'); });
    await page.waitForFunction(() => !document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
  });

  it(`${engine}: the entry notice is opaque with a thinner border`, { timeout: 40_000 }, async t => {
    const page = await launch(t);
    await page.evaluate(() => { window.ActivatorTest.showAutoTheaterNotice(() => {}, () => {}); });
    const style = await page.evaluate(() => {
      const notice = document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-auto-notice')!;
      const css = getComputedStyle(notice);
      return { background: css.backgroundColor, filter: css.backdropFilter || css.getPropertyValue('-webkit-backdrop-filter'), border: css.borderTopWidth,
        frost: getComputedStyle(notice, '::before').content };
    });
    assert.equal(style.background, 'rgb(24, 24, 27)');
    assert.ok(style.filter === 'none' || style.filter === '', style.filter);
    assert.equal(style.border, '2px');
    assert.ok(style.frost === 'none' || style.frost === 'normal', style.frost);
  });
}
