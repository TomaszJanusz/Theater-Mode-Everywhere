import { testEngines } from '../test-utils/test-engines';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { it } from 'node:test';
import type { Page } from 'playwright';
import { chromium, firefox } from 'playwright';
import { sharedTestBrowser } from '../test-utils/test-browser';

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
const CYCLES = 12;

type Live = { listeners: number; observers: number };

/** Counts listeners and observers still attached, so every theater cycle can be checked for leftovers. */
function instrumentPage(): void {
  const listeners: Array<[EventTarget, string, unknown, boolean]> = [];
  const capture = (options?: boolean | EventListenerOptions) => typeof options === 'boolean' ? options : !!options?.capture;
  const find = (target: EventTarget, type: string, listener: unknown, captured: boolean) => listeners.findIndex(
    ([t, ty, l, c]) => t === target && ty === type && l === listener && c === captured);
  const { addEventListener, removeEventListener } = EventTarget.prototype;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    const once = typeof options === 'object' && options?.once;
    if (listener && !once && find(this, type, listener, capture(options)) < 0) listeners.push([this, type, listener, capture(options)]);
    return addEventListener.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    const index = find(this, type, listener, capture(options));
    if (index >= 0) listeners.splice(index, 1);
    return removeEventListener.call(this, type, listener, options);
  };
  const observers = new Set<MutationObserver>();
  const { observe, disconnect } = MutationObserver.prototype;
  MutationObserver.prototype.observe = function (...args) {
    observers.add(this);
    return observe.apply(this, args);
  };
  MutationObserver.prototype.disconnect = function () {
    observers.delete(this);
    return disconnect.call(this);
  };
  (window as unknown as { __live: () => Live }).__live = () => ({
    // Removed UI nodes take their listeners with them; only reachable targets can accumulate work.
    listeners: listeners.filter(([target]) => !(target instanceof Node) || target.isConnected).length,
    observers: observers.size
  });
}

const PAGES = {
  generic: {
    url: 'https://videos.example.test/watch',
    body: `<div id="host"><video id="player" muted loop src="${MEDIA}"></video></div>`
  },
  youtube: {
    url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
    body: `<ytd-watch-flexy id="watch"><div id="movie_player"><video id="player" class="html5-main-video" muted loop src="${MEDIA}"></video></div></ytd-watch-flexy>`
  }
};

async function openPage(page: Page, kind: keyof typeof PAGES): Promise<void> {
  const { url, body } = PAGES[kind];
  await page.route(`${new URL(url).origin}/**`, route => route.fulfill({
    contentType: 'text/html',
    body: `<style>body{margin:0}video{display:block;width:640px;height:360px}</style>${body}`
  }));
  await page.addInitScript({ content: 'window.__name = target => target;' });
  await page.addInitScript(instrumentPage);
  await page.goto(url);
  await page.addScriptTag({ content: BUNDLE });
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
  await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('#player')!.readyState >= 2);
  await page.clock.install();
}

async function cycleTheater(page: Page): Promise<void> {
  await page.keyboard.press('t');
  await page.waitForFunction(() => document.documentElement.classList.contains('theater-everywhere-html-active'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
  // Settle exit's deferred layout refreshes and let the toggle debounce lapse.
  await page.clock.runFor(500);
}

/** Reads after the YouTube adapter's bounded probe retries lapse; the fixture has no MAIN world to answer them. */
async function live(page: Page): Promise<Live> {
  await page.clock.runFor(10_000);
  return page.evaluate(() => (window as unknown as { __live: () => Live }).__live());
}

for (const engine of testEngines()) {
  const shared = sharedTestBrowser(({ chromium, firefox })[engine]);

  for (const kind of Object.keys(PAGES) as Array<keyof typeof PAGES>) {
    it(`${engine}: ${kind} theater exit releases the video binding's listeners and observers`, { timeout: 60_000 }, async t => {
      const page = await (await shared.newContext(t)).newPage();
      await openPage(page, kind);
      await cycleTheater(page);
      const afterOne = await live(page);
      for (let cycle = 1; cycle < CYCLES; cycle += 1) await cycleTheater(page);
      assert.deepEqual(await live(page), afterOne);
    });
  }
}
