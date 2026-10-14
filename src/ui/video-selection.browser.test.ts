import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { it } from 'node:test';
import type { Frame, Page } from 'playwright';
import { ownTestBrowser } from '../test-utils/test-browser';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild') as { buildSync(options: object): { outputFiles: Array<{ text: string }> } };
const BUNDLE = esbuild.buildSync({
  stdin: {
    contents: "import { bootstrapPlayerRuntime } from './ui/player-runtime'; import { installWatchPlaybackQueries } from './providers/watch-playback'; installWatchPlaybackQueries(); bootstrapPlayerRuntime();",
    resolveDir: new URL('../', import.meta.url).pathname, loader: 'ts'
  },
  bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent'
}).outputFiles[0].text;
const MEDIA = `data:video/webm;base64,${readFileSync(new URL('../../test/fixtures/vod.webm', import.meta.url)).toString('base64')}`;

declare global {
  interface Window {
    setVideoSelectionEnabled(enabled: boolean): void;
  }
}

const PLAYERS = `<style>
  body { margin: 0; }
  video { display: block; width: 320px; height: 180px; }
  .player { position: absolute; left: 0; top: 0; width: 320px; height: 180px; }
  #first-player { left: 480px; top: 270px; }
  .overlay { position: absolute; inset: 0; }
</style>
<div class="player" id="first-player"><video id="first"></video></div>
<div class="player" id="pointer-player"><video id="pointed"></video><div class="overlay"><svg><path id="overlay-icon" d="M0 0h20v20z"/></svg></div></div>
<p id="outside">Outside</p>`;

async function boot(page: Page): Promise<void> {
  await page.addScriptTag({ content: 'window.__name = target => target;' });
  await page.addScriptTag({ content: BUNDLE });
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
}

async function point(frame: Page | Frame, selector: string): Promise<void> {
  await frame.locator(selector).dispatchEvent('mousemove', { bubbles: true, composed: true });
}

async function selected(frame: Page | Frame): Promise<string> {
  const video = frame.locator('video[data-theater-everywhere]');
  await video.waitFor({ state: 'attached' });
  return video.evaluate(video => video.id);
}

for (const engine of ['chromium', 'firefox'] as const) {
  it(`${engine}: 100 mousemoves on a large page do no discovery or geometry reads`, { timeout: 30_000 }, async t => {
    const browser = await (await import('playwright'))[engine].launch({ headless: true });
    ownTestBrowser(t, browser);
    const page = await browser.newPage();
    await page.addScriptTag({ content: 'window.__name = target => target;' });
    await page.setContent('<main><section><span id="pointer">Pointer</span></section></main>');
    await page.evaluate(() => {
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < 20_000; i++) fragment.append(document.createElement('div'));
      document.body.append(fragment);
    });
    await page.addScriptTag({ content: BUNDLE });
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
    const counts = await page.evaluate(() => {
      const pointer = document.getElementById('pointer')!;
      const counts = { queries: 0, body: 0, html: 0, geometry: 0 };
      const restores: Array<() => void> = [];
      for (const prototype of [Element.prototype, Document.prototype, DocumentFragment.prototype]) {
        for (const name of ['querySelector', 'querySelectorAll'] as const) {
          const original = Object.getOwnPropertyDescriptor(prototype, name)!;
          Object.defineProperty(prototype, name, { ...original, value: function (this: Node, ...args: unknown[]) {
            counts.queries++;
            if (this === document.body) counts.body++;
            if (this === document.documentElement) counts.html++;
            return Reflect.apply(original.value, this, args);
          } });
          restores.push(() => Object.defineProperty(prototype, name, original));
        }
      }
      for (const [prototype, names] of [
        [Element.prototype, ['getBoundingClientRect', 'getClientRects', 'clientWidth', 'clientHeight']],
        [HTMLElement.prototype, ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft']]
      ] as const) {
        for (const name of names) {
          const original = Object.getOwnPropertyDescriptor(prototype, name)!;
          const wrapped = original.get
            ? { get(this: Element) { counts.geometry++; return original.get!.call(this); } }
            : { value(this: Element) { counts.geometry++; return original.value.call(this); } };
          Object.defineProperty(prototype, name, { ...original, ...wrapped });
          restores.push(() => Object.defineProperty(prototype, name, original));
        }
      }
      try {
        for (let i = 0; i < 100; i++) {
          pointer.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, composed: true }));
        }
      } finally {
        for (const restore of restores) restore();
      }
      return counts;
    });
    assert.deepEqual(counts, { queries: 0, body: 0, html: 0, geometry: 0 });
  });

  it(`${engine}: theater and fullscreen defer pointer discovery without changing selection`, { timeout: 90_000 }, async t => {
    const browser = await (await import('playwright'))[engine].launch({ headless: true });
    ownTestBrowser(t, browser);
    const newPage = async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      page.setDefaultTimeout(5000);
      await page.route(/^https:\/\/(selection|embedded)\.test\//, route => route.fulfill({ contentType: 'text/html', body: PLAYERS }));
      await page.goto('https://selection.test/watch');
      return page;
    };

    for (const key of ['t', 'f']) {
      for (const surface of ['video', 'overlay', 'shadow video', 'shadow overlay', 'shadow host']) {
        await t.test(`${key}: ${surface} preserves composed-path selection`, async () => {
          const page = await newPage();
          if (surface.startsWith('shadow')) {
            await page.evaluate(() => {
              const host = document.createElement('div');
              host.id = 'shadow-host';
              const shadow = host.attachShadow({ mode: 'open' });
              // A first sibling in the same root catches event.target retargeting:
              // resolving only the host would incorrectly select this decoy.
              shadow.innerHTML = '<video id="decoy" style="position:absolute;left:480px;top:270px;width:320px;height:180px"></video>';
              shadow.append(document.getElementById('pointer-player')!);
              const style = document.createElement('style');
              style.textContent = document.querySelector('style')!.textContent;
              shadow.append(style);
              document.getElementById('first-player')!.remove();
              document.body.append(host);
            });
          }
          await boot(page);
          await point(page, surface === 'shadow host' ? '#shadow-host'
            : surface.includes('overlay') ? '#overlay-icon' : '#pointed');
          await page.keyboard.press(key);
          assert.equal(await selected(page), surface === 'shadow host' ? 'decoy' : 'pointed');
          if (key === 'f') {
            await page.waitForFunction(() => Boolean(document.fullscreenElement));
            // Firefox consumes native Escape in fullscreen. Use the extension's
            // fullscreen toggle, then exercise theater exit in both engines.
            await page.keyboard.press('f');
            await page.waitForFunction(() => !document.fullscreenElement);
          }
          await page.keyboard.press('Escape');
          await page.locator('video[data-theater-everywhere]').waitFor({ state: 'detached' });
          await page.close();
        });
      }
    }

    await t.test('keyboard without a pointer keeps geometric ranking', async () => {
      const page = await newPage();
      await boot(page);
      await page.keyboard.press('t');
      assert.equal(await selected(page), 'first');
      await page.close();
    });

    await t.test('playing beats hover in theater ranking', async () => {
      const page = await newPage();
      await boot(page);
      await page.evaluate(() => {
        const video = document.getElementById('first')!;
        Object.defineProperties(video, { paused: { value: false }, readyState: { value: 4 } });
      });
      await point(page, '#pointed');
      await page.keyboard.press('t');
      assert.equal(await selected(page), 'first');
      await page.close();
    });

    await t.test('later play wins over an unresolved pointer for fullscreen', async () => {
      const page = await newPage();
      await boot(page);
      await point(page, '#pointed');
      await page.locator('#first').dispatchEvent('play');
      await page.keyboard.press('f');
      assert.equal(await selected(page), 'first');
      await page.close();
    });

    await t.test('later pointer wins over an earlier play for fullscreen', async () => {
      const page = await newPage();
      await boot(page);
      await page.locator('#first').dispatchEvent('play');
      await point(page, '#pointed');
      await page.keyboard.press('f');
      assert.equal(await selected(page), 'pointed');
      await page.close();
    });

    for (const change of ['remove target', 'remove video', 'popstate', 'pushState']) {
      await t.test(`${change} rejects a stale pointer`, async () => {
        const page = await newPage();
        await boot(page);
        await point(page, '#overlay-icon');
        await page.evaluate(change => {
          if (change === 'remove target') document.getElementById('overlay-icon')!.remove();
          if (change === 'remove video') document.getElementById('pointed')!.remove();
          if (change === 'popstate') window.dispatchEvent(new PopStateEvent('popstate'));
          if (change === 'pushState') history.pushState({}, '', '/next');
        }, change);
        await page.keyboard.press('f');
        assert.equal(await selected(page), 'first');
        await page.close();
      });
    }

    await t.test('pointer miss preserves playback selection and detached active video is discarded', async () => {
      const page = await newPage();
      await page.clock.install();
      await page.evaluate(() => {
        const host = document.createElement('div');
        host.id = 'shadow-host';
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.append(document.querySelector('style')!, document.getElementById('first-player')!, document.getElementById('pointer-player')!);
        document.body.append(host);
      });
      await boot(page);
      await page.locator('#pointed').dispatchEvent('play', { composed: true });
      await point(page, '#outside');
      await page.keyboard.press('t');
      assert.equal(await selected(page), 'pointed');
      await page.keyboard.press('Escape');
      await page.clock.runFor(200); // The runtime's theater toggle transition latch.
      // The first resolution retained the playback choice; another miss must
      // retain a previously resolved hover choice too.
      await point(page, '#pointed');
      await page.keyboard.press('t');
      assert.equal(await selected(page), 'pointed');
      await page.keyboard.press('Escape');
      await page.clock.runFor(200);
      await point(page, '#outside');
      await page.keyboard.press('t');
      assert.equal(await selected(page), 'pointed');
      await page.keyboard.press('Escape');
      await page.clock.runFor(200);
      await page.locator('#pointed').evaluate(video => video.remove());
      await page.keyboard.press('f');
      assert.equal(await selected(page), 'first');
      await page.close();
    });

    await t.test('disabling and reenabling discards the old pointer and active video', async () => {
      const page = await newPage();
      await page.addScriptTag({ content: 'window.__name = target => target;' });
      await page.evaluate(() => {
        let blacklist: string[] = [];
        let notify = (_changes: Record<string, unknown>, _area: string) => {};
        Object.defineProperty(window, 'chrome', { configurable: true, value: {
          storage: {
            sync: { get: async () => ({ blacklist }), set: async () => {} },
            onChanged: { addListener(listener: typeof notify) { notify = listener; } }
          }
        } });
        window.setVideoSelectionEnabled = enabled => {
          blacklist = enabled ? [] : ['selection.test'];
          notify({ blacklist: { newValue: blacklist } }, 'sync');
        };
      });
      await boot(page);
      await page.locator('#pointed').dispatchEvent('play');
      await point(page, '#overlay-icon');
      await page.evaluate(() => window.setVideoSelectionEnabled(false));
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
      await page.evaluate(() => window.setVideoSelectionEnabled(true));
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
      await page.keyboard.press('f');
      assert.equal(await selected(page), 'first');
      await page.close();
    });

    for (const key of ['t', 'f']) {
      for (const origin of ['child', 'parent']) {
        await t.test(`iframe ${key} from ${origin} resolves the child path and expands the parent frame`, async () => {
          const page = await newPage();
          await page.setContent('<iframe src="https://embedded.test/child" style="width:1200px;height:650px"></iframe>');
          const child = page.frames().find(frame => frame !== page.mainFrame())!;
          await child.waitForLoadState();
          await boot(page);
          await child.addScriptTag({ content: 'window.__name = target => target;' });
          await child.addScriptTag({ content: BUNDLE });
          await child.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
          await point(child, '#overlay-icon');
          if (origin === 'child') await child.locator('body').press(key);
          else await page.keyboard.press(key);
          assert.equal(await selected(child), 'pointed');
          await page.locator('iframe[data-theater-everywhere]').waitFor({ state: 'attached' });
          await page.close();
        });
      }
    }

    await t.test('auto entry uses the pending pointer through the normal discovery ranking', async () => {
      const page = await newPage();
      await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: PLAYERS }));
      await page.goto('https://www.youtube.com/watch?v=abcdefghijk');
      await page.addScriptTag({ content: 'window.__name = target => target;' });
      await page.evaluate(media => {
        Object.defineProperty(window, 'chrome', { configurable: true, value: {
          storage: { sync: { get: async () => ({ autoEnterTheater: true }), set: async () => {} } }
        } });
        const watch = document.createElement('ytd-watch-flexy');
        const player = document.createElement('div');
        player.id = 'movie_player';
        Object.assign(player, { getVideoData: () => ({ video_id: 'abcdefghijk' }) });
        player.append(document.getElementById('pointer-player')!);
        watch.append(player);
        document.body.append(watch);
        document.getElementById('pointed')!.className = 'html5-main-video';
        for (const video of document.querySelectorAll('video')) {
          video.src = media;
          video.muted = true;
          video.preload = 'auto';
        }
      }, MEDIA);
      await page.waitForFunction(() => [...document.querySelectorAll('video')].every(video => video.readyState > 2));
      await boot(page);
      assert.equal(await page.locator('video[data-theater-everywhere]').count(), 0);
      await point(page, '#overlay-icon');
      await page.evaluate(() => {
        // Both candidates are playing, so the pointer decides their shared
        // ranking. Only the pointed video is confirmed as YouTube content.
        for (const video of document.querySelectorAll('video')) {
          Object.defineProperty(video, 'paused', { configurable: true, value: false });
        }
        document.getElementById('pointed')!.dispatchEvent(new Event('playing'));
      });
      assert.equal(await selected(page), 'pointed');
      await page.close();
    });
  });
}
