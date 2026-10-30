import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import type { Page } from 'playwright';

import { sharedEngineBrowsers } from '../test-utils/engine-browsers';
import { bootPlayer, bundleModules, bundlePlayer, enterTheater, playerStylesheets } from '../test-utils/player-boot';
import { testEngines } from '../test-utils/test-engines';

const BUNDLE = bundlePlayer([
  "export { createPlayerSettings } from './ui/player-settings';",
  "export { DisposableScope } from './core/disposable-scope';"
]);

const BACKGROUND_BUNDLE = bundleModules(["import './entries/background';"], 'Background');

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
  await bootPlayer(page, { settings: { keepControlsVisible: true }, bundle: BUNDLE });
  await page.waitForFunction(() => [...document.querySelectorAll('video')].every(video => video.readyState >= 2 && !video.paused));
  await enterTheater(page);
  await page.locator('.player-settings-btn').click();
  await page.locator('.theater-settings-menu.visible').waitFor();
}

async function menuOrder(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const skip = new Set(['theater-control-btn', 'theater-settings-row', 'active']);
    const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
    return [...root.querySelectorAll('.theater-settings-menu :is(button, .theater-settings-stepper-row).theater-settings-row')].map(button => {
      return [...button.classList].find(item => !skip.has(item) && item !== 'theater-settings-stepper-row') ?? '';
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

const browsers = sharedEngineBrowsers();

async function withBrowser(test: TestContext, engine: 'chromium' | 'firefox', run: (page: Page) => Promise<void>): Promise<void> {
  const page = await (await browsers[engine].newContext(test, { viewport: { width: 1280, height: 800 } })).newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await run(page);
  assert.deepEqual(errors, []);
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
          assert.deepEqual(await button.evaluate(row => ({
            keys: row.querySelectorAll('kbd').length,
            value: row.querySelector('.theater-settings-detail')?.textContent ?? '',
            shortcut: row.getAttribute('aria-keyshortcuts')
          })), { keys: 0, value: '', shortcut: null });
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
        await page.addStyleTag({ content: playerStylesheets().ui });
        await page.addScriptTag({ content: BUNDLE });
        const order = await page.evaluate(`(() => {
          const api = TheaterTest;
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
          const stepper = (className) => {
            const row = document.createElement('div');
            row.className = className;
            row.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
            return row;
          };
          settings.addStepperRow(stepper('picture-layout-btn'), 'Layout', 'player', { onStep() {} });
          settings.addStepperRow(stepper('controls-visibility-toggle'), 'Pin controls', 'player', { onStep() {} });
          settings.addRow(button('help-btn'), 'Keyboard Shortcuts', 'shortcuts');
          settings.addRow(button('switch-video-btn'), 'Switch player');
          settings.addRow(button('extension-settings-btn'), 'Extension settings', 'footer');
          settings.button.click();
          const skip = new Set(['theater-control-btn', 'theater-settings-row', 'theater-settings-stepper-row', 'active']);
          return [...settings.panel.querySelectorAll(':is(button, .theater-settings-stepper-row).theater-settings-row')].map(row => {
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
