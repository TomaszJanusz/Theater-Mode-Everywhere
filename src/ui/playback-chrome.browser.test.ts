import { testEngines } from '../test-utils/test-engines';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { chromium, firefox, type Page } from 'playwright';
import { readStylesheet } from '../test-utils/styles';
import { sharedTestBrowser } from '../test-utils/test-browser';

const require = createRequire(import.meta.url);
const SRC = new URL('../', import.meta.url).pathname;
const CSS = readStylesheet(path.join(SRC, 'content.css'));
const UI_CSS = readStylesheet(path.join(SRC, 'ui/shadow.css'));
const VOD = readFileSync(new URL('../../test/fixtures/vod.webm', import.meta.url)).toString('base64');
const esbuild = require('esbuild') as { buildSync(options: object): { outputFiles: Array<{ text: string }> } };
const BUNDLE = esbuild.buildSync({
  stdin: {
    contents: [
      "export { bootstrapPlayerRuntime } from './ui/player-runtime';",
      "export { setPlayerUiCss } from './ui/root';",
      "export { playbackWindow, seekToMediaTime } from './playback-window';"
    ].join('\n'),
    resolveDir: SRC, loader: 'ts'
  },
  bundle: true, write: false, format: 'iife', globalName: 'PlaybackChromeTest',
  platform: 'browser', target: 'es2022', logLevel: 'silent'
}).outputFiles[0].text;

const FIXTURE = `<!doctype html><html><head><title>Playback chrome fixture</title>
  <style>body { margin:0; background:#111; } video { width:960px; height:540px; }</style>
  </head><body><video id="player" title="Playback chrome" muted playsinline src="data:video/webm;base64,${VOD}"></video>
  </body></html>`;

/** Boots theater on the paused VOD clip; `keepControlsVisible: false` lets the bar auto-hide. */
async function boot(page: Page, keepControlsVisible: boolean, dockGeometry = false): Promise<void> {
  await page.evaluate(`window.chrome = { storage: {
    sync: {
      get: async () => ({ keepControlsVisible: ${keepControlsVisible}, ...${dockGeometry ? JSON.stringify({ pictureAlign: 'center', raiseOnlyWithSubtitles: false }) : '{}'}, shortcuts: { playPause: 'k' } }),
      set: async () => {}
    },
    onChanged: { addListener() {} }
  } };`);
  // tsx wraps named functions in __name(); the serialized page callbacks need it defined.
  await page.addScriptTag({ content: 'window.__name = (fn) => fn;' });
  await page.addStyleTag({ content: CSS });
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(`PlaybackChromeTest.setPlayerUiCss(${JSON.stringify(UI_CSS)}); PlaybackChromeTest.bootstrapPlayerRuntime();`);
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return Boolean(video && video.readyState >= 2 && Number.isFinite(video.duration));
  });
  await page.evaluate(() => { document.querySelector('video')!.pause(); });
  await page.keyboard.press('t');
  await page.locator('.theater-controls-wrapper.visible').waitFor();
}

/** Counts `video.duration` reads; every playback snapshot reads it a fixed number of times. */
async function instrumentDurationReads(page: Page): Promise<number> {
  return page.evaluate(() => {
    const video = document.querySelector('video')!;
    const native = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration')!.get!;
    const w = window as unknown as {
      __reads: number;
      __duration: () => number;
      PlaybackChromeTest: { playbackWindow(video: HTMLVideoElement): unknown };
    };
    w.__reads = 0;
    w.__duration = () => native.call(video);
    Object.defineProperty(video, 'duration', { configurable: true, get: () => { w.__reads++; return w.__duration(); } });
    w.__reads = 0;
    w.PlaybackChromeTest.playbackWindow(video);
    const perSnapshot = w.__reads;
    w.__reads = 0;
    return perSnapshot;
  });
}

const reads = (page: Page) => page.evaluate(() => (window as unknown as { __reads: number }).__reads);
const resetReads = (page: Page) => page.evaluate(() => { (window as unknown as { __reads: number }).__reads = 0; });

/** The painted bar, read straight from the player's shadow root. */
const barState = (page: Page) => page.evaluate(() => {
  const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
  const clock = (selector: string) => [...root.querySelectorAll<HTMLElement>(`${selector} .theater-time-slot`)]
    .map(slot => slot.dataset.ch ?? '').join('');
  const elapsed = root.querySelector<HTMLElement>('.theater-time-elapsed')!;
  return {
    fill: root.querySelector<HTMLElement>('.theater-scrubber-fill')!.style.width,
    buffer: root.querySelector<HTMLElement>('.theater-scrubber-buffer')!.style.width,
    elapsed: elapsed.classList.contains('theater-time-live') ? 'LIVE' : clock('.theater-time-elapsed'),
    behindLive: elapsed.classList.contains('theater-time-live-behind'),
    edge: clock('.theater-time-end')
  };
});

async function snapshot(page: Page, name: string): Promise<void> {
  const dir = process.env.THEATER_CHROME_SCREENSHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

describe('pinned controls geometry', () => {
  const pinned = sharedTestBrowser(chromium);
  it('docks to the view and reserves the measured height across fit, caption, direction and fullscreen states in chromium', { timeout: 60_000 }, async t => {
    const page = await (await pinned.newContext(t, { viewport: { width: 1280, height: 900 } })).newPage();
    await page.route('http://playback-chrome.test/**', route => route.fulfill(
      new URL(route.request().url()).pathname === '/en.vtt'
        ? { contentType: 'text/vtt', body: 'WEBVTT\n\n00:00:00.000 --> 00:01:00.000\nCaptions above the player controls\n' }
        : { contentType: 'text/html', body: FIXTURE.replace('</video>', '<track kind="subtitles" label="English" srclang="en" src="/en.vtt"></video>') }
    ));
    await page.goto('http://playback-chrome.test/');
    await boot(page, true, true);
    for (const size of [{ width: 1280, height: 900 }, { width: 640, height: 480 }]) {
      await page.setViewportSize(size);
      for (const fullscreen of [false, true]) {
        if (fullscreen) {
          await page.keyboard.press('f');
          await page.waitForFunction(() => Boolean(document.fullscreenElement));
        }
        for (const raised of [false, true]) {
          if (raised) await page.keyboard.press('Shift+L');
          for (const fit of ['contain', 'cover', 'fill']) {
            if (fit !== 'contain') await page.locator('.video-fit-btn').evaluate((e: HTMLButtonElement) => e.click());
            for (const captions of [false, true]) {
              if (captions) await page.keyboard.press('c');
              await page.waitForFunction(captions => {
                const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
                return root.querySelector('.theater-caption-overlay')!.classList.contains('visible') === captions;
              }, captions);
              for (const rtl of [false, true]) {
                await page.locator('.theater-controls-wrapper').evaluate((e, rtl) => e.setAttribute('dir', rtl ? 'rtl' : 'ltr'), rtl);
                for (const pinned of [false, true]) {
                  await page.keyboard.press('Shift+H');
                  await page.waitForFunction(pinned => {
                    const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
                    const bar = root.querySelector('.theater-controls-wrapper')!;
                    const box = bar.getBoundingClientRect();
                    const video = document.querySelector('video')!.getBoundingClientRect();
                    const host = document.getElementById('theater-everywhere-ui')!.getBoundingClientRect();
                    return bar.classList.contains('pinned') === pinned
                      && Math.abs(video.bottom - (pinned ? box.top : host.bottom)) < 1
                      && Math.abs(box.bottom - host.bottom + (pinned ? 0 : 24)) < 1;
                  }, pinned);
                  const geometry = await page.evaluate(() => {
                    const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
                    const bar = root.querySelector('.theater-controls-wrapper')!;
                    const box = bar.getBoundingClientRect();
                    const plate = getComputedStyle(bar, '::before');
                    const host = document.getElementById('theater-everywhere-ui')!.getBoundingClientRect();
                    return { left: box.left - host.left, right: host.right - box.right,
                      radius: plate.borderTopLeftRadius, leftBorder: plate.borderLeftWidth, rightBorder: plate.borderRightWidth };
                  });
                  assert.equal(geometry.left, pinned ? 0 : 24);
                  assert.equal(geometry.right, pinned ? 0 : 24);
                  assert.equal(geometry.radius, pinned ? '0px' : '12px');
                  assert.equal(geometry.leftBorder, pinned ? '0px' : '1px');
                  assert.equal(geometry.rightBorder, pinned ? '0px' : '1px');
                  if (captions) {
                    await page.waitForFunction(() => {
                      const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
                      return root.querySelector('.theater-caption-overlay')!.getBoundingClientRect().bottom
                        <= root.querySelector('.theater-controls-wrapper')!.getBoundingClientRect().top;
                    });
                  }
                  if (size.width === 1280 && fit === 'contain' && captions && !rtl) {
                    await snapshot(page, `dock-${pinned ? 'pinned' : 'floating'}-${fullscreen ? 'fullscreen' : 'theater'}-${raised ? 'raised' : 'centered'}`);
                  }
                }
              }
              if (captions) await page.keyboard.press('c');
            }
          }
          // Restore Fit and Centered for the next layout / fullscreen pass.
          await page.locator('.video-fit-btn').evaluate((e: HTMLButtonElement) => e.click());
          if (raised) await page.keyboard.press('Shift+L');
        }
        if (fullscreen) {
          await page.keyboard.press('f');
          await page.waitForFunction(() => !document.fullscreenElement);
        }
      }
    }
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--theater-controls-reserved-height')), '');
    assert.equal(await page.locator('video').evaluate(e => e.style.height), '');
  });
});

describe('playback chrome updates', () => {
  for (const engine of testEngines()) {
    const shared = sharedTestBrowser(({ chromium, firefox })[engine]);
    it(`shows seek loading before Disney starts moving and ignores stale clocks in ${engine}`, { timeout: 30_000 }, async t => {
      const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      const playId = '86e14fdb-3841-4282-ad38-07c8c4aab4b6';
      await page.route('https://www.disneyplus.com/**', route => route.fulfill({
        contentType: 'text/html', body: FIXTURE
      }));
      await page.goto(`https://www.disneyplus.com/play/${playId}`);
      await page.evaluate(playId => {
        const snapshot = document.createElement('script');
        snapshot.id = 'theater-everywhere-disney-snapshot';
        snapshot.type = 'application/json';
        snapshot.textContent = JSON.stringify({ mediaId: playId, duration: 3600, captions: [] });
        document.body.append(snapshot);
        document.querySelector('video')!.dataset.teDisneyPlayhead = '10';
      }, playId);
      await boot(page, false);
      await page.evaluate(() => {
        const video = document.querySelector('video')!;
        // Hive's content timeline is independent of the fixture clip duration.
        Object.defineProperty(video, 'duration', { configurable: true, value: Infinity });
        video.dispatchEvent(new Event('durationchange'));
      });
      await page.clock.install();
      const loading = () => page.locator('.theater-loading-indicator').evaluate(e => e.classList.contains('visible'));
      const scrub = async (time: number) => page.locator('.theater-scrubber-container').evaluate((e, time) => {
        let target = time;
        const capture = (event: Event) => { const time = JSON.parse((event as CustomEvent<string>).detail).time; if (typeof time === 'number') target = time; };
        window.addEventListener('theater-everywhere-media-seek', capture);
        const r = e.getBoundingClientRect();
        const options = { bubbles: true, composed: true, button: 0, clientX: r.left + r.width * time / 3600, clientY: r.top + r.height / 2 };
        e.dispatchEvent(new MouseEvent('mousedown', options));
        document.dispatchEvent(new MouseEvent('mouseup', options));
        window.removeEventListener('theater-everywhere-media-seek', capture);
        return target;
      }, time);
      const clock = async (time: number, ready = 4) => page.evaluate(({ time, ready }) => {
        const video = document.querySelector('video')!;
        video.dataset.teDisneyPlayhead = String(time);
        Object.defineProperty(video, 'readyState', { configurable: true, value: ready });
        window.dispatchEvent(new CustomEvent('theater-everywhere-disney-clock', { detail: { time } }));
      }, { time, ready });
      const firstTarget = await scrub(900);
      assert.equal(await loading(), true, 'click starts loading before any native seeking event');
      await page.evaluate(() => {
        const video = document.querySelector('video')!;
        video.dispatchEvent(new Event('play'));
        video.dispatchEvent(new Event('timeupdate'));
      });
      await clock(11);
      assert.equal(await loading(), true, 'old playback activity cannot settle a new seek');
      const secondTarget = await scrub(1800);
      await clock(firstTarget);
      assert.equal(await loading(), true, 'the preceding seek cannot settle the latest request');
      await clock(secondTarget, 1);
      assert.equal(await loading(), true, 'the target clock alone does not establish loaded media');
      await clock(secondTarget);
      assert.equal(await loading(), false, 'a paused seek also settles when the target is ready');
      const request = async (time: number) => page.evaluate(time => {
        (window as unknown as { PlaybackChromeTest: {
          seekToMediaTime(video: HTMLVideoElement, time: number): void;
        } }).PlaybackChromeTest.seekToMediaTime(document.querySelector('video')!, time);
      }, time);
      const shortTarget = secondTarget + 1;
      await request(shortTarget);
      await page.evaluate(() => {
        const video = document.querySelector('video')!;
        for (const name of ['play', 'timeupdate', 'canplay', 'seeked']) video.dispatchEvent(new Event(name));
      });
      await clock(secondTarget);
      assert.equal(await loading(), true, 'old events cannot settle a seek within the arrival tolerance');
      await clock(shortTarget);
      assert.equal(await loading(), false, 'the new clock settles a short paused seek');
      await request(shortTarget);
      assert.equal(await loading(), false, 'a paused no-op seek does not wait for a host event that may never fire');
      await request(shortTarget + 1);
      await page.evaluate(() => { document.querySelector('video')!.dispatchEvent(new Event('seeking')); });
      // A second request must not inherit the preceding request's seeking evidence.
      await request(shortTarget + 2);
      await clock(shortTarget);
      assert.equal(await loading(), true, 'a newer short seek retires previous start evidence');
      await page.evaluate(() => {
        const video = document.querySelector('video')!;
        video.dispatchEvent(new Event('seeking'));
        video.dispatchEvent(new Event('seeked'));
      });
      assert.equal(await loading(), false, 'native seek start and completion also acknowledge the latest request');
      // Keyboard seeks use the same request lifecycle.
      await page.keyboard.press('ArrowRight');
      assert.equal(await loading(), true);
      await page.clock.runFor(10_001);
      assert.equal(await loading(), false, 'a host that never acknowledges cannot leave loading stuck');
      await scrub(2400);
      assert.equal(await loading(), true);
      await page.keyboard.press('Escape');
      await page.clock.runFor(10_001);
      await clock(2400);
      assert.equal(await page.locator('.theater-loading-indicator').count(), 0, 'exit retires seek listeners and timers');
    });

    it(`sets caption clearance before controls paint, glides, and holds through their fade in ${engine}`, { timeout: 30_000 }, async t => {
      const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      await page.route('http://playback-chrome.test/**', route => route.fulfill({ contentType: 'text/html', body: FIXTURE }));
      await page.goto('http://playback-chrome.test/');
      await boot(page, false);
      page.setDefaultTimeout(5000);
      await page.evaluate(() => {
        const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
        const overlay = root.querySelector('.theater-caption-overlay')!;
        overlay.querySelector('.theater-caption-overlay-text')!.textContent = 'Caption that must clear the controls';
        overlay.classList.add('visible');
      });
      await page.waitForFunction(() => {
        const bar = document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-controls-wrapper')!;
        return !bar.classList.contains('visible') && Number(getComputedStyle(bar).opacity) === 0;
      });
      const rest = await page.evaluate(() => Number.parseFloat(document.documentElement.style.getPropertyValue('--theater-caption-bottom')));
      const shown = await page.evaluate(() => {
        document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
        const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
        const caption = root.querySelector<HTMLElement>('.theater-caption-overlay')!;
        const controls = root.querySelector<HTMLElement>('.theater-controls-wrapper')!;
        const bottom = Number.parseFloat(document.documentElement.style.getPropertyValue('--theater-caption-bottom'));
        // Arm in the same task as reveal, before any geometry wait can outlast
        // the idle deadline. Pausing the fade keeps the midpoint observable.
        Object.assign(window, { captionFade: new Promise((resolve, reject) => {
          const observer = new MutationObserver(() => {
            if (controls.classList.contains('visible')) return;
            observer.disconnect();
            const fade = controls.getAnimations().find(animation => animation instanceof CSSTransition && animation.transitionProperty === 'opacity');
            if (!fade) { reject(new Error('controls must have an opacity transition')); return; }
            fade.pause();
            fade.currentTime = Number(fade.effect!.getTiming().duration) / 2;
            resolve({ bottom: Number.parseFloat(document.documentElement.style.getPropertyValue('--theater-caption-bottom')),
              opacity: Number(getComputedStyle(controls).opacity) });
          });
          observer.observe(controls, { attributes: true, attributeFilter: ['class'] });
        }) });
        return { bottom, targetBottom: innerHeight - bottom, transition: caption.style.transition,
          controlsTop: innerHeight - Number.parseFloat(getComputedStyle(controls).bottom) - controls.offsetHeight };
      });
      assert.ok(shown.bottom > rest, JSON.stringify({ rest, shown }));
      assert.ok(shown.targetBottom < shown.controlsTop, 'the clearance target is resolved before the next animation frame');
      assert.ok(shown.transition.includes('bottom'), 'showing controls preserves the caption glide');
      await page.waitForFunction(() => {
        const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
        return root.querySelector('.theater-caption-overlay')!.getBoundingClientRect().bottom
          < root.querySelector('.theater-controls-wrapper')!.getBoundingClientRect().top;
      });
      const fading = await page.evaluate<{ bottom: number; opacity: number }>('window.captionFade');
      assert.ok(fading.opacity > 0 && fading.opacity < 1, 'the assertion observes the middle of the fade');
      assert.equal(fading.bottom, shown.bottom, 'captions remain clear while the controls are still fading');
      await page.locator('.theater-controls-wrapper').evaluate(bar => { for (const animation of bar.getAnimations()) animation.play(); });
      await page.waitForFunction(bottom => Number.parseFloat(document.documentElement.style.getPropertyValue('--theater-caption-bottom')) === bottom, rest);
    });

    it(`reads one playback snapshot per update and defers a hidden bar in ${engine}`, { timeout: 90_000 }, async t => {
      const browserType = (await import('playwright'))[engine];
      assert.ok(existsSync(browserType.executablePath()), `${engine} must be installed`);
      const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('http://playback-chrome.test/**', route => route.fulfill({ contentType: 'text/html', body: FIXTURE }));
      await page.goto('http://playback-chrome.test/');
      await boot(page, false);
      const perSnapshot = await instrumentDurationReads(page);
      assert.ok(perSnapshot > 0, 'a playback window must read the element duration');

      // Visible: every chrome event shares one snapshot instead of four.
      await page.mouse.move(640, 300);
      await page.locator('.theater-controls-wrapper.visible').waitFor();
      for (const type of ['timeupdate', 'progress', 'seeked']) {
        await resetReads(page);
        await page.evaluate(name => document.querySelector('video')!.dispatchEvent(new Event(name)), type);
        assert.equal(await reads(page), perSnapshot, `${type} must read the playback window once`);
      }
      await snapshot(page, `${engine}-vod-visible`);

      // Hidden: the cosmetic writes wait, and so do their reads.
      await page.mouse.move(640, 300);
      await page.locator('.theater-controls-wrapper:not(.visible)').waitFor({ timeout: 8_000 });
      const hiddenBefore = await barState(page);
      await page.evaluate(() => {
        const video = document.querySelector('video')!;
        video.currentTime = 1;
      });
      await page.waitForFunction(() => Math.abs(document.querySelector('video')!.currentTime - 1) < 0.2);
      await resetReads(page);
      await page.evaluate(() => {
        const video = document.querySelector('video')!;
        for (const name of ['timeupdate', 'progress', 'seeked']) video.dispatchEvent(new Event(name));
      });
      assert.equal(await reads(page), 0, 'a hidden bar must not read the playback window');
      assert.deepEqual(await barState(page), hiddenBefore, 'a hidden bar must not be repainted');

      // Showing it presents the current state in the same task, before the fade starts.
      const shown = await page.evaluate(() => new Promise<{ fill: string; elapsed: string }>(resolve => {
        const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
        const wrapper = root.querySelector<HTMLElement>('.theater-controls-wrapper')!;
        const observer = new MutationObserver(() => {
          if (!wrapper.classList.contains('visible')) return;
          observer.disconnect();
          const slots = [...root.querySelectorAll<HTMLElement>('.theater-time-elapsed .theater-time-slot')];
          resolve({
            fill: root.querySelector<HTMLElement>('.theater-scrubber-fill')!.style.width,
            elapsed: slots.map(slot => slot.dataset.ch ?? '').join('')
          });
        });
        observer.observe(wrapper, { attributes: true, attributeFilter: ['class'] });
        document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
      }));
      assert.equal(shown.elapsed, '0:01');
      assert.ok(Number.parseFloat(shown.fill) > 30, `scrubber must show the current time, got ${shown.fill}`);
      assert.notEqual(shown.fill, hiddenBefore.fill);
      await snapshot(page, `${engine}-vod-hidden-then-shown`);

      assert.deepEqual(errors, []);
    });

    it(`presents the current live DVR window when a hidden bar is shown in ${engine}`, { timeout: 90_000 }, async t => {
      const browserType = (await import('playwright'))[engine];
      assert.ok(existsSync(browserType.executablePath()), `${engine} must be installed`);
      const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('http://playback-chrome.test/**', route => route.fulfill({ contentType: 'text/html', body: FIXTURE }));
      await page.goto('http://playback-chrome.test/');
      await boot(page, false);
      // A DVR stream: unbounded duration with a sliding seekable window.
      await page.evaluate(() => {
        const video = document.querySelector('video')!;
        const w = window as unknown as { __dvr: { start: number; end: number } };
        w.__dvr = { start: 1000, end: 1600 };
        Object.defineProperty(video, 'duration', { configurable: true, get: () => Infinity });
        Object.defineProperty(video, 'currentTime', { configurable: true, get: () => 1599, set: () => {} });
        Object.defineProperty(video, 'seekable', {
          configurable: true,
          get: () => ({ length: 1, start: () => w.__dvr.start, end: () => w.__dvr.end })
        });
        video.dispatchEvent(new Event('durationchange'));
      });
      await page.mouse.move(640, 300);
      await page.locator('.theater-controls-wrapper.visible').waitFor();
      await snapshot(page, `${engine}-live-dvr-visible`);
      assert.equal((await barState(page)).elapsed, 'LIVE');

      await page.mouse.move(640, 300);
      await page.locator('.theater-controls-wrapper:not(.visible)').waitFor({ timeout: 8_000 });
      // The window slides away while the bar is hidden; the playhead is now far behind.
      await page.evaluate(() => {
        (window as unknown as { __dvr: { start: number; end: number } }).__dvr = { start: 1400, end: 2000 };
        document.querySelector('video')!.dispatchEvent(new Event('timeupdate'));
      });
      assert.equal((await barState(page)).behindLive, false, 'hidden bar must not repaint');
      await page.mouse.move(640, 320);
      await page.locator('.theater-controls-wrapper.visible').waitFor();
      const state = await barState(page);
      assert.equal(state.behindLive, true, 'showing the bar must present the current live state');
      assert.ok(Math.abs(Number.parseFloat(state.fill) - 33.2) < 1, `playhead must sit in the slid window, got ${state.fill}`);
      await snapshot(page, `${engine}-live-dvr-hidden-then-shown`);
      assert.deepEqual(errors, []);
    });
  }
});
