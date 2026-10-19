import { testEngines } from '../test-utils/test-engines';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import { ownTestBrowser } from '../test-utils/test-browser';
import type { Browser, Page } from 'playwright';
import { readStylesheet } from '../test-utils/styles';

const require = createRequire(import.meta.url);
const SRC = new URL('../', import.meta.url).pathname;
const UI_CSS = readStylesheet(path.join(SRC, 'ui/shadow.css'));
const PAGE_CSS = readStylesheet(path.join(SRC, 'content.css'));
const esbuild = require('esbuild') as { buildSync(options: object): { outputFiles: Array<{ text: string }> } };
const BUNDLE = esbuild.buildSync({
  stdin: {
    contents: [
      "export { bootstrapPlayerRuntime } from './ui/player-runtime';",
      "export { setPlayerUiCss } from './ui/root';",
      "export { createPlayerSettings } from './ui/player-settings';",
      "export { DisposableScope } from './core/disposable-scope';"
    ].join('\n'),
    resolveDir: SRC,
    loader: 'ts'
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'PlayerSettingsOrder',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'silent'
}).outputFiles[0].text;

const BACKGROUND_BUNDLE = esbuild.buildSync({
  entryPoints: [path.join(SRC, 'entries/background.ts')],
  bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022'
}).outputFiles[0].text;

type MenuCase = {
  autoTheater: boolean;
  playerSwitch: boolean;
};

function fixture(options: { secondVideo: boolean; playlist: boolean }): string {
  const playlist = options.playlist
    ? '<button type="button" class="vjs-previous-video">Previous</button><button type="button" class="vjs-next-video">Next</button>'
    : '';
  const second = options.secondVideo
    ? '<video id="other" muted playsinline style="width:320px;height:180px"></video>'
    : '';
  return `<!doctype html><html><head><title>Player settings order</title>
    <style>body { margin:0; background:#111; } video { width:960px; height:540px; background:#000; }</style>
    </head><body>
    <div class="video-js">
      <video id="player" title="Player settings order" muted playsinline></video>
      ${second}
      ${playlist}
    </div>
    <script>
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 180;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#1c2634';
      ctx.fillRect(0, 0, 320, 180);
      const stream = canvas.captureStream(12);
      setInterval(() => { ctx.fillRect(0, 0, 1, 1); }, 100);
      for (const video of document.querySelectorAll('video')) {
        video.srcObject = stream;
        video.play();
      }
    </script></body></html>`;
}

async function boot(page: Page, html: string): Promise<void> {
  await page.route('http://player-settings-order.test/**', route => route.fulfill({
    contentType: 'text/html',
    body: html
  }));
  await page.goto('http://player-settings-order.test/');
  await page.evaluate(`window.chrome = { storage: { sync: { get: async () => ({ keepControlsVisible: true }), set: async () => {} }, onChanged: { addListener() {} } } };`);
  await page.addStyleTag({ content: PAGE_CSS });
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(`PlayerSettingsOrder.setPlayerUiCss(${JSON.stringify(UI_CSS)}); PlayerSettingsOrder.bootstrapPlayerRuntime();`);
  await page.waitForFunction(() => [...document.querySelectorAll('video')].every(video => video.readyState >= 2 && !video.paused));
  await page.keyboard.press('t');
  await page.locator('.theater-controls-wrapper.visible').waitFor();
  await page.locator('.player-settings-btn').click();
  await page.locator('.theater-settings-menu.visible').waitFor();
}

async function menuOrder(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const skip = new Set(['theater-control-btn', 'theater-settings-row', 'active']);
    const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
    return [...root.querySelectorAll('.theater-settings-menu button.theater-settings-row')].map(button => {
      return [...button.classList].find(item => !skip.has(item)) ?? '';
    });
  });
}

function assertShortcutsLast(order: string[], expected: MenuCase): void {
  const extension = order.lastIndexOf('extension-settings-btn');
  assert.equal(extension, order.length - 1, JSON.stringify(order));
  const actions = order.slice(0, extension);
  assert.equal(actions.at(-1), 'help-btn', JSON.stringify(order));
  assert.equal(order[extension - 1], 'help-btn', JSON.stringify(order));
  if (expected.autoTheater) {
    assert.ok(actions.includes('auto-theater-btn'), JSON.stringify(order));
    assert.ok(actions.indexOf('auto-theater-btn') < actions.indexOf('help-btn'), JSON.stringify(order));
  } else {
    assert.equal(actions.includes('auto-theater-btn'), false, JSON.stringify(order));
  }
  if (expected.playerSwitch) {
    assert.ok(actions.includes('switch-video-btn'), JSON.stringify(order));
    assert.ok(actions.indexOf('switch-video-btn') < actions.indexOf('help-btn'), JSON.stringify(order));
  }
}

async function assertTabFollowsDom(page: Page): Promise<void> {
  const indexes = await page.evaluate(() => {
    const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
    return [...root.querySelectorAll<HTMLButtonElement>('.theater-settings-menu button.theater-settings-row')]
      .map(button => button.tabIndex);
  });
  assert.ok(indexes.length > 1 && indexes.every(index => index === 0), JSON.stringify(indexes));
  await page.locator('.help-btn').focus();
  const before = await page.evaluate(() => {
    const active = document.getElementById('theater-everywhere-ui')!.shadowRoot!.activeElement;
    return active instanceof HTMLButtonElement && active.classList.contains('help-btn');
  });
  assert.equal(before, true);
  await page.keyboard.press('Tab');
  const after = await page.evaluate(() => {
    const active = document.getElementById('theater-everywhere-ui')!.shadowRoot!.activeElement;
    return active instanceof HTMLButtonElement && active.classList.contains('extension-settings-btn');
  });
  assert.equal(after, true, 'Tab from Keyboard Shortcuts must reach Extension settings');
}

async function withBrowser(test: TestContext, engine: 'chromium' | 'firefox', run: (page: Page) => Promise<void>): Promise<void> {
  const browserType = (await import('playwright'))[engine];
  assert.ok(existsSync(browserType.executablePath()), `${engine} must be installed`);
  const browser: Browser = await browserType.launch({ headless: true });
  ownTestBrowser(test, browser);
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await run(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

describe('player settings action order', () => {
  for (const engine of testEngines()) {
    it(`opens Extension settings through the background in ${engine}`, { timeout: 60_000 }, async test => {
      await withBrowser(test, engine, async page => {
        await boot(page, fixture({ secondVideo: false, playlist: false }));
        await page.evaluate(`(() => {
          let listener;
          const ignore = { addListener() {} };
          const calls = [];
          const runtime = {
            id: 'extension', getManifest: () => ({ version: '2.0.0' }), onInstalled: ignore,
            onMessage: { addListener(fn) { listener = fn; } },
            async openOptionsPage() { calls.push('openOptionsPage'); }
          };
          // Background APIs live in a separate scope; content scripts only get messaging.
          new Function('chrome', ${JSON.stringify(BACKGROUND_BUNDLE)})({
            runtime, tabs: { onActivated: ignore, onUpdated: ignore }, storage: { onChanged: ignore }
          });
          Object.assign(chrome, { runtime: {
            sendMessage(message, reply) {
              calls.push(message);
              listener(message, { id: 'extension', tab: { id: 1 }, frameId: 0 }, reply);
            }
          } });
          Object.assign(window, { optionsCalls: calls });
        })()`);
        for (const activation of ['pointer', 'keyboard']) {
          const button = page.locator('.extension-settings-btn');
          assert.equal(await button.getAttribute('aria-label'), 'Extension settings');
          if (activation === 'pointer') await button.click();
          else { await button.focus(); await page.keyboard.press('Enter'); }
          await page.locator('.theater-settings-menu').waitFor({ state: 'hidden' });
          await page.locator('.player-settings-btn').click();
        }
        assert.deepEqual(await page.evaluate('window.optionsCalls'), [
          { action: 'open-options-page' }, 'openOptionsPage',
          { action: 'open-options-page' }, 'openOptionsPage'
        ]);
      });
    });

    it(`keeps Keyboard Shortcuts last when auto theater is present in ${engine}`, { timeout: 60_000 }, async test => {
      await withBrowser(test, engine, async page => {
        await boot(page, fixture({ secondVideo: false, playlist: false }));
        const order = await menuOrder(page);
        assert.equal(order.includes('switch-video-btn'), false, JSON.stringify(order));
        assertShortcutsLast(order, { autoTheater: true, playerSwitch: false });
        await assertTabFollowsDom(page);
      });
    });

    it(`keeps Keyboard Shortcuts last when playlist and player switching are present in ${engine}`, { timeout: 60_000 }, async test => {
      await withBrowser(test, engine, async page => {
        await boot(page, fixture({ secondVideo: true, playlist: true }));
        await page.locator('.switch-video-btn').waitFor();
        await page.locator('.playlist-prev-btn').waitFor();
        await page.locator('.playlist-next-btn').waitFor();
        const placement = await page.evaluate(() => {
          const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
          const menu = root.querySelector('.theater-settings-menu')!;
          return ['playlist-prev-btn', 'playlist-next-btn'].map(name => {
            const button = root.querySelector(`.${name}`);
            return {
              name,
              present: Boolean(button),
              inMenu: Boolean(button?.closest('.theater-settings-menu')),
              inToolbar: Boolean(button?.closest('.theater-controls-row'))
            };
          }).concat([{
            name: 'menu-contains-playlist',
            present: Boolean(menu.querySelector('.playlist-prev-btn, .playlist-next-btn')),
            inMenu: false,
            inToolbar: false
          }]);
        });
        assert.deepEqual(placement, [
          { name: 'playlist-prev-btn', present: true, inMenu: false, inToolbar: true },
          { name: 'playlist-next-btn', present: true, inMenu: false, inToolbar: true },
          { name: 'menu-contains-playlist', present: false, inMenu: false, inToolbar: false }
        ]);
        assertShortcutsLast(await menuOrder(page), { autoTheater: true, playerSwitch: true });
        await assertTabFollowsDom(page);
      });
    });

    it(`keeps Keyboard Shortcuts last when auto theater is absent and a later action arrives in ${engine}`, { timeout: 60_000 }, async test => {
      await withBrowser(test, engine, async page => {
        await page.setContent('<div id="mount" style="position:fixed;left:40px;bottom:80px;width:640px"></div>');
        await page.addStyleTag({ content: UI_CSS });
        await page.addScriptTag({ content: BUNDLE });
        const order = await page.evaluate(`(() => {
          const api = PlayerSettingsOrder;
          const scope = new api.DisposableScope();
          const settings = api.createPlayerSettings({
            t: (key) => key,
            actions: { setIcon(element, svg) { element.innerHTML = svg; }, showToolbar() {}, updateCaptionDock() {} },
            paintOverlay() {}
          }, scope);
          document.getElementById('mount').append(settings.container);
          const button = (className) => {
            const row = document.createElement('button');
            row.className = 'theater-control-btn ' + className;
            row.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
            return row;
          };
          settings.addRow(button('picture-layout-btn'), 'Layout');
          settings.addRow(button('controls-visibility-toggle'), 'Pin controls');
          settings.addRow(button('help-btn'), 'Keyboard Shortcuts', 'shortcuts');
          settings.addRow(button('switch-video-btn'), 'Switch player');
          settings.addRow(button('extension-settings-btn'), 'Extension settings', 'footer');
          settings.button.click();
          const skip = new Set(['theater-control-btn', 'theater-settings-row', 'active']);
          return [...settings.panel.querySelectorAll('button.theater-settings-row')].map(row => {
            return [...row.classList].find(item => !skip.has(item)) ?? '';
          });
        })()`) as string[];
        assertShortcutsLast(order, { autoTheater: false, playerSwitch: true });
        await page.locator('.help-btn').focus();
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => document.activeElement?.classList.contains('extension-settings-btn'));
        assert.equal(focused, true, JSON.stringify(order));
      });
    });
  }
});
