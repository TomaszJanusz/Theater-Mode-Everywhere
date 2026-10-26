import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { sharedEngineBrowsers } from '../test-utils/engine-browsers';
import { bundleModules } from '../test-utils/player-boot';
import { readStylesheet } from '../test-utils/styles';
import { testEngines } from '../test-utils/test-engines';

const SRC = new URL('../', import.meta.url).pathname;
const CSS = readStylesheet(path.join(SRC, 'content.css'));
const BUNDLE = bundleModules(["export { bootstrapPlayerRuntime } from './ui/player-runtime'; export { setPlayerUiCss } from './ui/root';"], 'FullscreenActivityTest');

type TestWindow = {
  FullscreenActivityTest: Pick<typeof import('./player-runtime'), 'bootstrapPlayerRuntime'>
    & Pick<typeof import('./root'), 'setPlayerUiCss'>;
  fullscreenActivity: { now: number; requests: number; change(active: boolean): void };
};

declare global {
  interface Window extends TestWindow {}
}

describe('fullscreen chrome activity', () => {
  const browsers = sharedEngineBrowsers();
  for (const engine of testEngines()) {
    for (const pinned of [false, true]) {
      it(`suppresses transition activity for 500 ms in ${engine}, pinned=${pinned}`, { timeout: 60_000 }, async t => {
        const page = await (await browsers[engine].newContext(t, { viewport: { width: 1280, height: 800 } })).newPage();
        page.setDefaultTimeout(5000);
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('http://fullscreen-activity.test/**', route => route.fulfill({
          contentType: 'text/html',
          body: '<title>Fullscreen activity regression</title><video muted playsinline style="width:960px;height:540px"></video>'
        }));
        await page.goto('http://fullscreen-activity.test/');
        await page.clock.install();
        await page.addScriptTag({ content: 'window.__name = fn => fn;' });
        await page.evaluate((keepControlsVisible) => {
          Object.defineProperty(window, 'chrome', { value: { storage: {
            sync: { get: async () => ({ keepControlsVisible, shortcuts: { playPause: 'k' } }), set: async () => {} },
            onChanged: { addListener() {} }
          } } });
          const canvas = document.createElement('canvas');
          canvas.width = 1280;
          canvas.height = 720;
          const context = canvas.getContext('2d')!;
          context.fillRect(0, 0, 1280, 720);
          const video = document.querySelector('video')!;
          video.srcObject = canvas.captureStream(12);
          setInterval(() => context.fillRect(0, 0, 1, 1), 100);
          void video.play();
        }, pinned);
        await page.addStyleTag({ content: CSS });
        await page.addScriptTag({ content: BUNDLE });
        await page.evaluate(css => {
          const api = window.FullscreenActivityTest;
          api.setPlayerUiCss(css);
          api.bootstrapPlayerRuntime();
        }, CSS);
        await page.waitForFunction(() => {
          const video = document.querySelector('video')!;
          return video.readyState >= 2 && !video.paused;
        });
        await page.keyboard.press('t');
        await page.locator('.theater-controls-wrapper.visible').waitFor();
        await page.mouse.move(80, 80);
        await page.evaluate(() => {
          let fullscreen: Element | null = null;
          let settle: (() => void) | null = null;
          const state = {
            now: 10_000, requests: 0,
            change(active: boolean) {
              fullscreen = active ? document.documentElement : null;
              document.dispatchEvent(new Event('fullscreenchange'));
              settle?.();
              settle = null;
            }
          };
          window.fullscreenActivity = state;
          Object.defineProperty(performance, 'now', { value: () => state.now });
          Object.defineProperty(document, 'fullscreenElement', { get: () => fullscreen });
          const request = () => {
            state.requests++;
            return new Promise<void>(resolve => { settle = resolve; });
          };
          document.documentElement.requestFullscreen = request;
          document.exitFullscreen = request;
        });
        const visibility = () => page.evaluate(() => {
          const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
          const header = root.querySelector<HTMLElement>('.theater-everywhere-header-hud')!;
          return {
            controls: root.querySelector('.theater-controls-wrapper')!.classList.contains('visible'),
            header: header.classList.contains('visible'), inert: header.inert,
            fullscreen: root.querySelector('.fullscreen-btn')!.getAttribute('aria-pressed')
          };
        });
        const idle = async (fullscreen: boolean) => {
          await page.clock.fastForward(2600);
          assert.deepEqual(await visibility(), { controls: pinned, header: false, inert: true, fullscreen: String(fullscreen) });
        };
        const activity = () => page.evaluate(() => {
          for (const type of ['pointermove', 'pointerdown', 'focusin']) {
            const target = type === 'focusin'
              ? document.getElementById('theater-everywhere-ui')!.shadowRoot! : document;
            target.dispatchEvent(new Event(type, { bubbles: true }));
          }
        });
        const advance = (ms: number) => page.evaluate(ms => { window.fullscreenActivity.now += ms; }, ms);
        const change = (active: boolean) => page.evaluate(active => { window.fullscreenActivity.change(active); }, active);

        await idle(false);
        await page.keyboard.press('f');
        assert.equal(await page.evaluate(() => window.fullscreenActivity.requests), 1);
        await activity();
        assert.equal((await visibility()).header, false, 'activity is blocked before fullscreenchange');
        await page.keyboard.press('k');
        assert.equal(await page.locator('video').evaluate((video: HTMLVideoElement) => video.paused), true, 'playback shortcuts remain usable');
        await page.keyboard.press('k');
        await advance(400);
        await change(true);
        assert.deepEqual(await visibility(), { controls: pinned, header: false, inert: true, fullscreen: 'true' });
        await advance(499);
        await activity();
        assert.equal((await visibility()).header, false, 'fullscreenchange renews the suppression window');
        await advance(1);
        await activity();
        assert.equal((await visibility()).header, true, 'new activity works at 500 ms');

        await idle(true);
        // Invoke the button handler without pointer activity first revealing the bar.
        await page.locator('.fullscreen-btn').evaluate(button => (button as HTMLButtonElement).click());
        await activity();
        assert.equal((await visibility()).header, false, 'button exit also blocks activity before completion');
        await change(false);
        await advance(499);
        await activity();
        assert.deepEqual(await visibility(), { controls: pinned, header: false, inert: true, fullscreen: 'false' });
        await advance(1);
        assert.equal((await visibility()).header, false, 'expiry alone never reveals UI');
        await activity();
        assert.equal((await visibility()).header, true);

        await idle(false);
        await change(true);
        await advance(600);
        await change(false); // Native exit (e.g. Esc), without an extension request.
        await activity();
        assert.equal((await visibility()).header, false, 'external exits get the same suppression');
        await page.keyboard.press('t');
        await page.clock.runFor(250); // Existing theater-entry debounce.
        await page.keyboard.press('t');
        await page.locator('.theater-controls-wrapper.visible').waitFor();
        await idle(false);
        await activity();
        assert.equal((await visibility()).header, true, 'teardown clears the old suppression window');
        assert.deepEqual(errors, []);
      });
    }
  }
});
