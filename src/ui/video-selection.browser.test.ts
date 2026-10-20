import { testEngines } from '../test-utils/test-engines';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { it } from 'node:test';
import { chromium, firefox, type Frame, type Page } from 'playwright';
import { sharedTestBrowser } from '../test-utils/test-browser';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild') as { buildSync(options: object): { outputFiles: Array<{ text: string }> } };
const BUNDLE = esbuild.buildSync({
  stdin: {
    contents: "import { bootstrapPlayerRuntime } from './ui/player-runtime'; import { installWatchPlaybackQueries } from './providers/watch-playback'; export { isInactiveStandbyVideo } from './providers/video-candidates'; installWatchPlaybackQueries(); bootstrapPlayerRuntime();",
    resolveDir: new URL('../', import.meta.url).pathname, loader: 'ts'
  },
  bundle: true, write: false, format: 'iife', globalName: 'VideoSelectionTest', platform: 'browser', target: 'es2022', logLevel: 'silent'
}).outputFiles[0].text;
const MEDIA = `data:video/webm;base64,${readFileSync(new URL('../../test/fixtures/vod.webm', import.meta.url)).toString('base64')}`;

declare global {
  interface Window {
    setVideoSelectionEnabled(enabled: boolean): void;
    VideoSelectionTest: { isInactiveStandbyVideo(video: HTMLVideoElement): boolean };
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

async function selected(frame: Page | Frame, timeout = 5000): Promise<string> {
  const video = frame.locator('video[data-theater-everywhere]');
  await video.waitFor({ state: 'attached', timeout });
  return video.evaluate(video => video.id);
}

for (const engine of testEngines()) {
  const shared = sharedTestBrowser(({ chromium, firefox })[engine]);
  it(`${engine}: standby detection includes hidden hosts and wrappers`, async t => {
    const page = await (await shared.newContext(t)).newPage();
    await page.setContent('<main></main>');
    await boot(page);
    const result = await page.evaluate(() => {
      const inactive = window.VideoSelectionTest.isInactiveStandbyVideo;
      return ['disney-web-player', 'div.txp_videos_container'].map(selector => {
        const outer = document.createElement('section');
        const host = document.createElement(selector.split('.')[0]);
        host.className = selector.split('.')[1] ?? '';
        const wrapper = document.createElement('div');
        const video = document.createElement('video');
        video.style.display = 'block';
        wrapper.append(video); host.append(wrapper); outer.append(host); document.body.append(outer);
        const visible = inactive(video);
        host.style.display = 'none'; const hiddenHost = inactive(video);
        host.style.display = ''; wrapper.style.display = 'none'; const hiddenWrapper = inactive(video);
        wrapper.style.display = ''; outer.style.display = 'none'; const hiddenOuter = inactive(video);
        // Generic players retain their existing eligibility rules.
        document.body.append(wrapper); const generic = inactive(video);
        wrapper.remove(); outer.remove();
        return { visible, hiddenHost, hiddenWrapper, hiddenOuter, generic };
      });
    });
    assert.deepEqual(result, Array.from({ length: 2 }, () => ({
      visible: false, hiddenHost: true, hiddenWrapper: true, hiddenOuter: true, generic: false
    })));
  });

  it(`${engine}: Disney episode replacement waits past the hidden standby and restores on exit`, { timeout: 30_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
    await page.route('https://www.disneyplus.com/**', route => route.fulfill({
      contentType: 'text/html',
      body: '<style>disney-web-player { display:block; width:640px; height:360px } video { width:640px; height:360px }</style><disney-web-player><video id="first" class="hive-video"></video></disney-web-player>'
    }));
    await page.goto('https://www.disneyplus.com/play/86e14fdb-3841-4282-ad38-07c8c4aab4b6');
    await boot(page);
    await page.keyboard.press('t');
    assert.equal(await selected(page), 'first');
    await page.evaluate(() => {
      document.querySelector('disney-web-player')!.remove();
      history.pushState({}, '', '/play/180356b5-0596-4333-891f-e48c526a0803');
      const shell = document.createElement('disney-web-player');
      shell.innerHTML = '<video id="standby" class="btm-media-client-element" style="display:none"></video>';
      document.body.append(shell);
    });
    // Flush the structural observer and its animation-frame rebind, without
    // mounting the real player yet: discovery must reject its empty fallback.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('#standby[data-theater-everywhere]').count(), 0);
    await page.evaluate(media => {
      const video = document.createElement('video');
      video.id = 'episode';
      video.className = 'hive-video';
      video.style.cssText = 'width:100%;height:100%';
      video.muted = true;
      video.loop = true;
      video.src = media;
      document.querySelector('disney-web-player')!.append(video);
    }, MEDIA);
    await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('#episode')!.readyState >= 2);
    await page.waitForFunction(() => document.querySelector('video[data-theater-everywhere]')?.id === 'episode');
    assert.equal(await page.locator('#episode').evaluate(video => getComputedStyle(video).display !== 'none'), true);
    // Also cover a host switching away from a still-connected media node.
    await page.evaluate(media => {
      const current = document.querySelector<HTMLVideoElement>('#episode')!;
      const replacement = current.cloneNode() as HTMLVideoElement;
      replacement.id = 'connected-replacement';
      replacement.removeAttribute('data-theater-everywhere');
      replacement.className = 'hive-video';
      replacement.style.cssText = 'width:100%;height:100%';
      replacement.src = media;
      current.after(replacement);
      const retired = document.createElement('div');
      retired.id = 'retired-player';
      retired.style.display = 'none';
      current.before(retired);
      retired.append(current);
    }, MEDIA);
    await page.waitForFunction(() => document.querySelector('video[data-theater-everywhere]')?.id === 'connected-replacement');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('video[data-theater-everywhere]'));
    assert.equal(await page.locator('#standby').getAttribute('style'), 'display:none');
    assert.equal(await page.locator('#retired-player').evaluate(host => host.style.display), 'none');
    assert.equal(await page.locator('#connected-replacement').evaluate(video => video.style.position), '');
    await page.locator('#episode').dispatchEvent('loadedmetadata');
    assert.equal(await page.locator('video[data-theater-everywhere]').count(), 0);
  });

  it(`${engine}: YouTube theater leaves a hidden watch page and moves to a visible replacement`, { timeout: 30_000 }, async t => {
    const openWatchPage = async (extra: string): Promise<Page> => {
      const page = await (await shared.newContext(t)).newPage();
      await page.route('https://www.youtube.com/**', route => route.fulfill({
        contentType: 'text/html',
        body: '<style>video { display:block; width:640px; height:360px }</style>'
          + '<ytd-watch-flexy><div id="movie_player" class="html5-video-player"><video id="watch" class="html5-main-video"></video></div></ytd-watch-flexy>'
          + extra
      }));
      await page.goto('https://www.youtube.com/watch?v=aaaaaaaaaaa');
      await page.evaluate(media => {
        for (const video of document.querySelectorAll('video')) { video.muted = true; video.loop = true; video.src = media; }
      }, MEDIA);
      await page.waitForFunction(() => [...document.querySelectorAll('video')].every(video => video.readyState >= 2));
      await boot(page);
      await page.keyboard.press('t');
      assert.equal(await selected(page), 'watch');
      return page;
    };
    const hideWatchPage = (page: Page) => page.evaluate(() => document.querySelector('ytd-watch-flexy')!.setAttribute('hidden', ''));

    // SPA navigation to Home hides the watch page while its video stays connected.
    const home = await openWatchPage('');
    await hideWatchPage(home);
    await home.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
    assert.equal(await home.locator('video[data-theater-everywhere]').count(), 0);
    assert.equal(await home.locator('.theater-everywhere-parent-active').count(), 0);
    await home.close();

    // With another playable video, theater follows it instead of exiting.
    const other = await openWatchPage('<video id="other" style="position:absolute;top:2000px"></video>');
    await hideWatchPage(other);
    await other.waitForFunction(() => document.querySelector('video[data-theater-everywhere]')?.id === 'other');
    await other.close();
  });

  it(`${engine}: YouTube theater survives a transient hidden watch page but exits when it stays lost`, { timeout: 30_000 }, async t => {
    const openWatchPage = async (): Promise<Page> => {
      const page = await (await shared.newContext(t)).newPage();
      await page.route('https://www.youtube.com/**', route => route.fulfill({
        contentType: 'text/html',
        body: '<style>video { display:block; width:640px; height:360px }</style>'
          + '<ytd-watch-flexy><div id="movie_player" class="html5-video-player"><video id="watch" class="html5-main-video"></video></div></ytd-watch-flexy>'
      }));
      await page.goto('https://www.youtube.com/watch?v=aaaaaaaaaaa');
      await page.evaluate(media => {
        const video = document.querySelector('video')!; video.muted = true; video.loop = true; video.src = media;
      }, MEDIA);
      await page.waitForFunction(() => document.querySelector('video')!.readyState >= 2);
      // A paused clock makes every grace-period step exact; a running one also advances with real time under load.
      await page.clock.install();
      await page.clock.pauseAt(new Date(Date.now() + 60_000));
      await boot(page);
      await toggle(page);
      assert.equal(await selected(page), 'watch');
      return page;
    };
    // The toggle ignores presses for 200 ms; run that debounce on the fake clock so it never depends on real speed.
    const toggle = async (page: Page): Promise<void> => {
      await page.keyboard.press('t');
      await page.clock.runFor(300);
    };
    const setHidden = (page: Page, hidden: boolean) => page.evaluate(hidden => document.querySelector('ytd-watch-flexy')!.toggleAttribute('hidden', hidden), hidden);
    const active = (page: Page) => page.evaluate(() => document.documentElement.classList.contains('theater-everywhere-html-active'));

    // The host hides the watch page for a moment, then restores it: the session keeps going.
    const transient = await openWatchPage();
    for (const ms of [50, 300]) {
      await setHidden(transient, true);
      await transient.clock.runFor(ms);
      await setHidden(transient, false);
      await transient.clock.runFor(2000);
      assert.equal(await active(transient), true, `hidden for ${ms} ms`);
    }
    // The first loss's recheck must not fire against a later, still-recovering one.
    await setHidden(transient, true);
    await transient.clock.runFor(600);
    await setHidden(transient, false);
    await transient.clock.runFor(100);
    await setHidden(transient, true);
    await transient.clock.runFor(600);
    await setHidden(transient, false);
    await transient.clock.runFor(2000);
    assert.equal(await active(transient), true);

    // A surface that stays lost ends theater after the grace period.
    await setHidden(transient, true);
    await transient.clock.runFor(2000);
    assert.equal(await active(transient), false);

    // Leaving theater cancels a pending recheck: re-entering is not closed by the old timer.
    await setHidden(transient, false);
    await toggle(transient);
    assert.equal(await selected(transient), 'watch');
    await setHidden(transient, true);
    await transient.clock.runFor(300);
    await toggle(transient);
    await transient.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
    await setHidden(transient, false);
    await toggle(transient);
    assert.equal(await selected(transient), 'watch');
    await transient.clock.runFor(2000);
    assert.equal(await active(transient), true);
  });

  it(`${engine}: 100 mousemoves on a large page do no discovery or geometry reads`, { timeout: 30_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
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
    const newPage = async () => {
      const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
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
      assert.equal(await selected(page, 15_000), 'pointed'); // Waits out the AutoTheater countdown.
      await page.close();
    });
  });
}
