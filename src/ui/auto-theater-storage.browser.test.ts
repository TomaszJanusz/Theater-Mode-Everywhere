import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { buildSync } from 'esbuild';
import { chromium, firefox, type Browser, type Frame, type Page } from 'playwright';
import { mediaProviderFlagStorageKeys } from '../media-features/provider-flags';
import { ownTestBrowser } from '../test-utils/test-browser';
import { readStylesheet } from '../test-utils/styles';
import { AUTO_ENTER_NOTICE_MIN_MS } from './auto-theater-intent';
import { ENTRY_SHORTCUT_ATTRIBUTE, ENTRY_SHORTCUT_EVENT } from './entry-shortcuts';

const BUNDLE = buildSync({
  stdin: {
    contents: [
      "export { bootstrapPlayerRuntime } from './ui/player-runtime';",
      "export { installMainWorldRuntime } from './platform/main-world-runtime';",
      "export { setPlayerUiCss } from './ui/root';"
    ].join('\n'),
    resolveDir: new URL('../', import.meta.url).pathname, loader: 'ts'
  },
  bundle: true, write: false, format: 'iife', globalName: 'AutoTheaterStorageTest',
  platform: 'browser', target: 'es2022', logLevel: 'silent'
}).outputFiles[0].text;
const PAGE_CSS = readStylesheet(new URL('../content.css', import.meta.url));
const UI_CSS = readStylesheet(new URL('./shadow.css', import.meta.url));
const MEDIA = `data:video/webm;base64,${readFileSync(new URL('../../test/fixtures/vod.webm', import.meta.url)).toString('base64')}`;
const WATCH = 'https://www.youtube.com/watch?v=abcdefghijk';
const ACTIVE = 'theater-everywhere-html-active';
type StorageValues = Record<string, unknown>;

declare global {
  interface Window {
    AutoTheaterStorageTest: {
      bootstrapPlayerRuntime(): void;
      installMainWorldRuntime(): void;
      setPlayerUiCss(css: string): void;
    };
    autoStorageProbe: {
      values: StorageValues;
      reads: number;
      deepScans: number;
      playing: boolean;
      shortcutRelays: number;
      holdReads: boolean;
      pending: Array<() => void>;
      change(values: StorageValues, area?: string): Promise<void>;
      resolve(index: number): Promise<void>;
    };
  }
}

async function fixture(browser: Browser, options: { holdReads?: boolean; auto?: boolean; skipCountdown?: boolean; url?: string; iframe?: boolean; body?: string } = {}): Promise<{ page: Page; target: Page | Frame }> {
  const page = await browser.newPage();
  await page.addInitScript('window.__name = target => target;');
  await page.route('**/*', route => route.request().isNavigationRequest()
    ? route.fulfill({ contentType: 'text/html', body: options.body ?? '<!doctype html><ytd-watch-flexy><div id="movie_player"><video class="html5-main-video" muted loop style="width:640px;height:360px"></video></div></ytd-watch-flexy>' })
    : route.abort());
  await page.goto(options.iframe ? 'https://fixture.test/' : options.url ?? WATCH);
  let target: Page | Frame = page;
  if (options.iframe) {
    const loaded = page.waitForEvent('framenavigated', frame => frame.url() === WATCH);
    await page.evaluate(url => {
      const frame = document.createElement('iframe');
      frame.src = url;
      document.body.append(frame);
    }, WATCH);
    target = await loaded;
  }
  await target.evaluate(media => { document.querySelector('video')!.src = media; }, MEDIA);
  await target.waitForFunction(() => document.querySelector('video')!.readyState > 2);
  await target.evaluate(({ auto, holdReads, skipCountdown }) => {
    const listeners: Array<(changes: Record<string, { newValue: unknown }>, area: string) => void> = [];
    const probe: Window['autoStorageProbe'] = {
      values: { autoEnterTheater: auto, autoTheaterSkipCountdown: skipCountdown, keepControlsVisible: true },
      reads: 0, deepScans: 0, playing: false, shortcutRelays: 0, holdReads, pending: [],
      async change(values, area = 'sync') {
        if (area === 'sync') Object.assign(probe.values, values);
        const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }]));
        for (const listener of listeners) listener(changes, area);
        // Storage hydration continuations are queued before this checkpoint.
        await Promise.resolve();
      },
      async resolve(index) {
        probe.pending[index]();
        await Promise.resolve();
      }
    };
    window.autoStorageProbe = probe;
    Object.assign(window, { chrome: { storage: {
      sync: {
        get: () => {
          probe.reads++;
          const snapshot = structuredClone(probe.values);
          return probe.holdReads
            ? new Promise<StorageValues>(resolve => probe.pending.push(() => resolve(snapshot)))
            : Promise.resolve(snapshot);
        },
        set: async (values: StorageValues) => { Object.assign(probe.values, values); }
      },
      onChanged: { addListener: (listener: typeof listeners[number]) => listeners.push(listener) }
    } } });
    const youtubePlayer = document.getElementById('movie_player');
    if (youtubePlayer) Object.assign(youtubePlayer, {
      getVideoData: () => ({ video_id: new URL(location.href).searchParams.get('v') }),
      getPlayerState: () => 3
    });
    // Control media state independently of autoplay policy; native playing is
    // covered separately by auto-theater-runtime.browser.test.ts.
    Object.defineProperty(document.querySelector('video')!, 'paused', { get: () => !probe.playing });
    const query = Document.prototype.querySelectorAll;
    Document.prototype.querySelectorAll = function <T extends Element = Element>(selector: string): NodeListOf<T> {
      // Each deep discovery traverses all potential shadow hosts at its root.
      if (selector === '*') probe.deepScans++;
      return query.call(this, selector) as NodeListOf<T>;
    };
  }, { auto: options.auto ?? true, holdReads: options.holdReads ?? false, skipCountdown: options.skipCountdown ?? false });
  await target.addStyleTag({ content: PAGE_CSS });
  await target.addScriptTag({ content: BUNDLE });
  await target.evaluate(css => {
    window.AutoTheaterStorageTest.setPlayerUiCss(css);
    window.AutoTheaterStorageTest.installMainWorldRuntime();
    window.AutoTheaterStorageTest.bootstrapPlayerRuntime();
  }, UI_CSS);
  if (!options.holdReads) await target.waitForFunction(attribute => document.documentElement.hasAttribute(attribute), ENTRY_SHORTCUT_ATTRIBUTE);
  return { page, target };
}

async function active(target: Page | Frame): Promise<boolean> {
  return target.evaluate(className => document.documentElement.classList.contains(className), ACTIVE);
}

for (const engine of ['chromium', 'firefox'] as const) {
  it(`AutoTheater in ${engine} skips the notice only when enabled, preserving playback gates and visit ownership`, { timeout: 60_000 }, async t => {
    const browser = await ({ chromium, firefox })[engine].launch({ headless: true });
    ownTestBrowser(t, browser);
    try {
      const { page, target } = await fixture(browser, { skipCountdown: true });
      await page.clock.install();
      await page.clock.pauseAt(new Date(Date.now() + 60_000));
      const notice = page.locator('.theater-auto-notice');
      assert.equal(await active(target), false, 'skip must still wait for playback');
      await target.evaluate(() => {
        window.autoStorageProbe.playing = true;
        document.querySelector('video')!.dispatchEvent(new Event('playing'));
      });
      assert.equal(await active(target), true, 'stored preference enters synchronously on playback');
      assert.equal(await notice.count(), 0);
      await page.keyboard.press('Escape');
      await target.evaluate(async () => {
        await window.autoStorageProbe.change({ autoTheaterSkipCountdown: false });
        await window.autoStorageProbe.change({ autoTheaterSkipCountdown: true });
        document.querySelector('video')!.dispatchEvent(new Event('playing'));
      });
      assert.equal(await active(target), false, 'preferences cannot reenter an exited visit');
      await target.evaluate(async () => {
        await window.autoStorageProbe.change({ autoTheaterSkipCountdown: false });
        history.replaceState({}, '', '/watch?v=lmnopqrstuv');
        document.dispatchEvent(new Event('yt-navigate-finish'));
      });
      assert.equal(await notice.count(), 1, 'turning skip off restores the notice for new content');
      await page.clock.runFor(1000);
      await target.evaluate(() => window.autoStorageProbe.change({ autoTheaterSkipCountdown: true }));
      assert.equal(await active(target), true, 'live preference clears the pending countdown');
      assert.equal(await notice.count(), 0);
      await page.keyboard.press('Escape');
      await page.clock.runFor(AUTO_ENTER_NOTICE_MIN_MS);
      assert.equal(await active(target), false, 'old countdown cannot enter after exit');
      await target.evaluate(async () => {
        history.replaceState({}, '', '/watch?v=zyxwvutsrqp');
        document.getElementById('movie_player')!.classList.add('ad-showing');
        document.dispatchEvent(new Event('yt-navigate-finish'));
      });
      assert.equal(await active(target), false, 'skip cannot bypass the provider ad guard');
      assert.equal(await notice.count(), 0);
      await page.close();
    } finally { await browser.close(); }
  });

  it(`auto-theater in ${engine} retries when the player transition ends`, { timeout: 60_000 }, async t => {
    const browser = await ({ chromium, firefox })[engine].launch({ headless: true });
    ownTestBrowser(t, browser);
    try {
      const { page } = await fixture(browser);
      await page.clock.install();
      await page.clock.pauseAt(new Date(Date.now() + 1000));
      // Start a toggle without an available target, then make playback eligible
      // while the transition gate still blocks its playing event.
      const video = await page.locator('video').elementHandle();
      assert.ok(video);
      await video.evaluate(video => video.remove());
      await page.keyboard.press('t');
      assert.equal(await active(page), false, 'toggle without a target must stay inactive');
      await video.evaluate(video => {
        document.getElementById('movie_player')!.append(video);
        window.autoStorageProbe.playing = true;
        document.querySelector('video')!.dispatchEvent(new Event('playing'));
      });
      assert.equal(await active(page), false, 'transition must block the playing trigger');
      await page.clock.runFor(200);
      assert.equal(await active(page), false, 'entry is announced for the minimum notice time first');
      await page.clock.runFor(AUTO_ENTER_NOTICE_MIN_MS);
      await page.waitForFunction(className => document.documentElement.classList.contains(className), ACTIVE);
    } finally { await browser.close(); }
  });

  for (const provider of [
    {
      id: 'netflix', url: 'https://www.netflix.com/watch/70248299', next: '/watch/70248300',
      body: '<!doctype html><div class="watch-video"><div data-uia="player" data-videoid="70248299"><video muted loop style="width:640px;height:360px"></video></div></div>'
    },
    {
      id: 'disney', url: 'https://www.disneyplus.com/pl-pl/play/560861a0-55c9-4552-a181-64c498e01b62', next: '/pl-pl/play/86e14fdb-3841-4282-ad38-07c8c4aab4b6',
      body: '<!doctype html><disney-web-player><video class="hive-video" muted loop style="width:640px;height:360px"></video></disney-web-player>'
    }
  ] as const) {
    it(`${provider.id} auto-theater in ${engine} enters through the full player runtime and honors live provider settings`, { timeout: 60_000 }, async t => {
      const browser = await ({ chromium, firefox })[engine].launch({ headless: true });
      ownTestBrowser(t, browser);
      try {
        const { page } = await fixture(browser, provider);
        assert.equal(await active(page), false, 'loading a paused watch page must not enter');
        await page.evaluate(() => {
          window.autoStorageProbe.playing = true;
          document.querySelector('video')!.dispatchEvent(new Event('playing'));
        });
        await page.waitForFunction(className => document.documentElement.classList.contains(className), ACTIVE);
        assert.equal(await page.locator('video').getAttribute('data-theater-everywhere'), '');
        await page.keyboard.press('Escape');
        assert.equal(await active(page), false);
        await page.evaluate(async id => {
          await window.autoStorageProbe.change({ autoEnterTheater: false });
          await window.autoStorageProbe.change({ autoEnterTheater: true });
          document.querySelector('video')!.dispatchEvent(new Event('playing'));
          await window.autoStorageProbe.change({ [`${id}IntegrationEnabled`]: false });
        }, provider.id);
        assert.equal(await active(page), false, 'manual exit must survive preference changes');
        await page.evaluate(({ next, id }) => {
          history.pushState({}, '', next);
          document.querySelector('[data-uia="player"]')?.setAttribute('data-videoid', next.split('/').pop()!);
          window.dispatchEvent(new Event(`theater-everywhere-${id}-harvest`));
        }, provider);
        assert.equal(await active(page), false, 'disabled provider must block the next watch URL');
        await page.evaluate(async id => {
          await window.autoStorageProbe.change({ [`${id}IntegrationEnabled`]: true });
        }, provider.id);
        await page.waitForFunction(className => document.documentElement.classList.contains(className), ACTIVE);
      } finally { await browser.close(); }
    });
  }

  it(`auto-theater storage in ${engine} skips unrelated discovery and still publishes shortcuts to MAIN`, { timeout: 60_000 }, async t => {
    const browser = await ({ chromium, firefox })[engine].launch({ headless: true });
    ownTestBrowser(t, browser);
    try {
      const { page, target } = await fixture(browser);
      assert.equal(await target.evaluate(() => window.autoStorageProbe.reads), 1, 'Automatic language must reuse the initial settings read');
      assert.ok(await target.evaluate(() => window.autoStorageProbe.deepScans > 0), 'the qualifying paused watch must exercise deep discovery');
      const unrelated: StorageValues = {
        language: 'automatic', unrelatedResearchKey: 'x', captionStyle: {}, captionPreferenceByHost: {},
        accentColor: 'blue', voiceBoost: 'off', volumeLeveling: 'off', bassLevel: 'original',
        volumeBoostEnabled: true, shortcuts: { toggle: 'Ctrl+Shift+Y' },
        keepControlsVisible: true, videoFitMode: 'cover', pictureAlign: 'top',
        raiseOnlyWithSubtitles: true, nativeChatPreferences: {}
      };
      for (const [key, value] of Object.entries(unrelated)) {
        const counts = await target.evaluate(async ({ key, value }) => {
          const probe = window.autoStorageProbe;
          probe.deepScans = 0;
          const reads = probe.reads;
          for (let i = 0; i < 100; i++) await probe.change({ [key]: value });
          return { scans: probe.deepScans, reads: probe.reads - reads };
        }, { key, value });
        assert.deepEqual(counts, { scans: 0, reads: 0 }, `${key} must not refresh auto-theater`);
      }
      const config = await target.evaluate(attribute => JSON.parse(document.documentElement.getAttribute(attribute)!), ENTRY_SHORTCUT_ATTRIBUTE);
      assert.equal(config.toggle, 'Ctrl+Shift+Y');
      await target.evaluate(eventName => {
        window.addEventListener(eventName, () => { window.autoStorageProbe.shortcutRelays++; });
      }, ENTRY_SHORTCUT_EVENT);
      await page.keyboard.press('t');
      assert.equal(await active(target), false, 'old shortcut must be replaced');
      assert.equal(await target.evaluate(() => window.autoStorageProbe.shortcutRelays), 0);
      await page.keyboard.press('Control+Shift+Y');
      await target.waitForFunction(className => document.documentElement.classList.contains(className), ACTIVE);
      assert.equal(await target.evaluate(() => window.autoStorageProbe.shortcutRelays), 1, 'MAIN must consume the newly published config');
    } finally { await browser.close(); }
  });

  it(`auto-theater storage in ${engine} refreshes all policy dependencies and rejects stale hydration`, { timeout: 60_000 }, async t => {
    const browser = await ({ chromium, firefox })[engine].launch({ headless: true });
    ownTestBrowser(t, browser);
    try {
      const { page, target } = await fixture(browser, { holdReads: true, url: 'https://m.youtube.com/watch?v=abcdefghijk' });
      await target.evaluate(() => window.autoStorageProbe.change({ blacklist: ['youtube.com'] }));
      await target.evaluate(() => window.autoStorageProbe.resolve(0));
      assert.equal(await target.evaluate(attribute => document.documentElement.hasAttribute(attribute), ENTRY_SHORTCUT_ATTRIBUTE), false, 'stale initial allowed policy must not initialize');
      await target.evaluate(() => window.autoStorageProbe.resolve(1));
      assert.equal(await active(target), false);
      assert.equal(await target.evaluate(() => window.autoStorageProbe.deepScans), 0);
      await target.evaluate(async () => {
        window.autoStorageProbe.holdReads = false;
        await window.autoStorageProbe.change({ blacklist: [] });
      });
      assert.ok(await target.evaluate(() => window.autoStorageProbe.deepScans > 0));
      for (const key of ['autoEnterTheater', 'autoTheaterSkipCountdown', ...mediaProviderFlagStorageKeys()]) {
        for (const value of [false, true]) {
          const counts = await target.evaluate(async ({ key, value }) => {
            const probe = window.autoStorageProbe;
            probe.deepScans = 0;
            const reads = probe.reads;
            await probe.change({ [key]: value });
            return { reads: probe.reads - reads, scans: probe.deepScans };
          }, { key, value });
          assert.equal(counts.reads, 1, `${key} must reload policy`);
          if (!value && (key === 'autoEnterTheater' || key === 'youtubeIntegrationEnabled')) assert.equal(counts.scans, 0);
          else assert.ok(counts.scans > 0, `${key} must refresh the eligible paused watch`);
        }
      }
      const local = await target.evaluate(async () => {
        const probe = window.autoStorageProbe;
        const reads = probe.reads;
        probe.deepScans = 0;
        await probe.change({ blacklist: ['youtube.com'], autoEnterTheater: false }, 'local');
        return { reads: probe.reads - reads, scans: probe.deepScans };
      });
      assert.deepEqual(local, { reads: 0, scans: 0 });
      await target.evaluate(async () => {
        const probe = window.autoStorageProbe;
        probe.holdReads = true;
        await probe.change({ youtubeIntegrationEnabled: false });
        await probe.change({ youtubeIntegrationEnabled: true });
        await probe.change({ blacklist: ['youtube.com'] });
        probe.playing = true;
        document.querySelector('video')!.dispatchEvent(new Event('playing'));
        await probe.resolve(3); // Older allowed provider snapshot, before latest blacklist.
        await probe.resolve(2);
      });
      assert.equal(await active(target), false, 'pending policy and stale allowed reads must block playing');
      await target.evaluate(() => window.autoStorageProbe.resolve(4));
      assert.equal(await active(target), false, 'latest parent-domain blacklist must win');
      await target.evaluate(async () => {
        window.autoStorageProbe.holdReads = false;
        await window.autoStorageProbe.change({ blacklist: [] });
      });
      await target.waitForFunction(className => document.documentElement.classList.contains(className), ACTIVE);
      await page.keyboard.press('Escape');
      assert.equal(await active(target), false);
      await target.evaluate(async () => {
        const probe = window.autoStorageProbe;
        await probe.change({ autoEnterTheater: false, youtubeIntegrationEnabled: false });
        await probe.change({ autoEnterTheater: true, youtubeIntegrationEnabled: true });
        await probe.change({ blacklist: ['youtube.com'] });
        await probe.change({ blacklist: [] });
        document.querySelector('video')!.dispatchEvent(new Event('playing'));
      });
      assert.equal(await active(target), false, 'an entered visit must survive policy toggles and runtime recreation');
      await target.evaluate(() => {
        document.getElementById('movie_player')!.classList.add('ad-showing');
        history.replaceState({}, '', '/watch?v=lmnopqrstuv');
        document.dispatchEvent(new Event('yt-navigate-finish'));
      });
      assert.equal(await active(target), false, 'SPA preroll must not enter');
      await target.evaluate(() => document.getElementById('movie_player')!.classList.remove('ad-showing'));
      await target.waitForFunction(className => document.documentElement.classList.contains(className), ACTIVE);
    } finally { await browser.close(); }
  });

  it(`auto-theater storage in ${engine} preserves opt-out, generic and iframe guards`, { timeout: 60_000 }, async t => {
    const browser = await ({ chromium, firefox })[engine].launch({ headless: true });
    ownTestBrowser(t, browser);
    try {
      for (const options of [{ auto: false }, { url: 'https://fixture.test/watch' }, { iframe: true }]) {
        const { page, target } = await fixture(browser, options);
        await target.evaluate(async () => {
          const probe = window.autoStorageProbe;
          probe.deepScans = 0;
          await probe.change({ unrelatedResearchKey: 'x' });
          await probe.change({ youtubeIntegrationEnabled: false });
          await probe.change({ youtubeIntegrationEnabled: true });
          probe.playing = true;
          document.querySelector('video')!.dispatchEvent(new Event('playing'));
        });
        assert.equal(await target.evaluate(() => window.autoStorageProbe.deepScans), 0, JSON.stringify(options));
        assert.equal(await active(target), false, JSON.stringify(options));
        await page.close();
      }
    } finally { await browser.close(); }
  });
}
