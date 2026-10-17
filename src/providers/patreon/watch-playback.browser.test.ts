import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { it } from 'node:test';
import type { Page } from 'playwright';
import { defaultMediaProviderFlags } from '../../media-features/provider-flags';
import { ownTestBrowser } from '../../test-utils/test-browser';
import type { AutoTheaterRuntime } from '../../ui/auto-theater-runtime';

const require = createRequire(import.meta.url);
const esbuild = require(createRequire(require.resolve('vite')).resolve('esbuild')) as {
  buildSync(options: object): { outputFiles: Array<{ text: string }> };
};
const BUNDLE = esbuild.buildSync({
  stdin: {
    contents: "export { createAutoTheaterRuntime } from './ui/auto-theater-runtime'; export { installWatchPlaybackQueries, confirmProviderWatchVideo } from './providers/watch-playback'; export { installPatreonNavigation } from './providers/patreon/navigation';",
    resolveDir: new URL('../../', import.meta.url).pathname, loader: 'ts'
  },
  bundle: true, write: false, format: 'iife', globalName: 'PatreonTest',
  platform: 'browser', target: 'es2022', logLevel: 'silent'
}).outputFiles[0].text;
const MEDIA = `data:video/webm;base64,${readFileSync(new URL('../../../test/fixtures/vod.webm', import.meta.url)).toString('base64')}`;

declare global {
  interface Window {
    PatreonTest: {
      createAutoTheaterRuntime: typeof import('../../ui/auto-theater-runtime').createAutoTheaterRuntime;
      installWatchPlaybackQueries(): void;
      installPatreonNavigation(): void;
      confirmProviderWatchVideo(video: HTMLVideoElement): boolean;
    };
    patreonProbe: { entries: number; active: boolean; shown: number; hidden: number };
    patreonRuntime: AutoTheaterRuntime;
  }
}

// Mux Player keeps its <video> inside mux-video's shadow root inside its own shadow root.
const FIXTURE = `
<main id="root"></main>
<script>
  function deepVideo(host) {
    return host.shadowRoot.querySelector('mux-video').shadowRoot.querySelector('video');
  }
  window.addPlayer = (attributes = '', source = true) => {
    const player = document.createElement('mux-player');
    for (const [name, value] of Object.entries(attributes)) player.setAttribute(name, value);
    const video = document.createElement('video');
    video.muted = true; video.loop = true; video.style.cssText = 'width:640px;height:360px';
    if (source) video.src = window.MEDIA;
    const mux = document.createElement('mux-video');
    mux.attachShadow({ mode: 'open' }).append(video);
    player.attachShadow({ mode: 'open' }).append(mux);
    document.getElementById('root').append(player);
    return new Promise(resolve => source ? video.addEventListener('loadeddata', () => resolve(), { once: true }) : resolve());
  };
  window.deepVideos = () => [...document.querySelectorAll('mux-player')].map(deepVideo);
</script>`;

async function open(page: Page, path: string): Promise<void> {
  await page.addInitScript('window.__name = target => target;');
  await page.route('https://www.patreon.com/**', route => route.fulfill({ contentType: 'text/html', body: FIXTURE }));
  await page.goto(`https://www.patreon.com${path}`);
  await page.evaluate(media => { (window as unknown as { MEDIA: string }).MEDIA = media; }, MEDIA);
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(() => window.PatreonTest.installWatchPlaybackQueries());
}

const confirmed = (page: Page, index = 0) => page.evaluate(i => {
  const video = (window as unknown as { deepVideos(): HTMLVideoElement[] }).deepVideos()[i];
  return window.PatreonTest.confirmProviderWatchVideo(video);
}, index);
const addPlayer = (page: Page, attributes: Record<string, string> = {}, source = true) =>
  page.evaluate(([a, s]) => (window as unknown as { addPlayer(a: object, s: boolean): Promise<void> }).addPlayer(a as object, s as boolean), [attributes, source] as const);

for (const engine of ['chromium', 'firefox'] as const) {
  it(`Patreon posts in ${engine} confirm only the single native Mux video`, { timeout: 60_000 }, async t => {
    const browserType = (await import('playwright'))[engine];
    assert.ok(existsSync(browserType.executablePath()), `${engine} must be installed`);
    const browser = await browserType.launch({ headless: true });
    ownTestBrowser(t, browser);
    try {
      const page = await browser.newPage();
      await open(page, '/posts/my-post-12345678?utm_source=feed');

      // Nothing to confirm without a native player; an iframe-only post has no top-document video.
      await page.evaluate(() => { document.getElementById('root')!.innerHTML = '<iframe src="about:blank" style="width:640px;height:360px"></iframe>'; });
      assert.equal(await page.evaluate(() => document.querySelectorAll('mux-player').length), 0);
      await page.evaluate(() => { document.getElementById('root')!.innerHTML = ''; });

      await addPlayer(page);
      assert.equal(await confirmed(page), true, 'one player with one video, found through two shadow roots');

      // A playing unrelated video (ad-like) makes the page ambiguous.
      await page.evaluate(media => {
        const other = document.createElement('video');
        other.muted = true; other.loop = true; other.src = media; other.id = 'ad';
        document.body.append(other);
        return other.play();
      }, MEDIA);
      assert.equal(await confirmed(page), false, 'another playing video');
      await page.evaluate(() => document.getElementById('ad')!.remove());
      assert.equal(await confirmed(page), true);

      // The post's own playback is not "another video".
      await page.evaluate(() => (window as unknown as { deepVideos(): HTMLVideoElement[] }).deepVideos()[0].play());
      assert.equal(await confirmed(page), true, 'playing content video');

      // Gallery: two players.
      await addPlayer(page);
      assert.equal(await confirmed(page, 0), false, 'two players');
      assert.equal(await confirmed(page, 1), false, 'two players');
      await page.evaluate(() => document.querySelectorAll('mux-player')[1].remove());
      assert.equal(await confirmed(page), true);

      // Live streams stay ineligible until qualified.
      for (const type of ['live', 'll-live:dvr']) {
        await page.evaluate(streamType => document.querySelector('mux-player')!.setAttribute('stream-type', streamType), type);
        assert.equal(await confirmed(page), false, type);
      }
      await page.evaluate(() => document.querySelector('mux-player')!.setAttribute('stream-type', 'on-demand'));
      assert.equal(await confirmed(page), true, 'on-demand');

      // Non-post routes never confirm, even with a perfect player.
      await page.evaluate(() => history.pushState({}, '', '/creator'));
      assert.equal(await confirmed(page), false, 'creator page');
    } finally { await browser.close(); }
  });

  it(`AutoTheater in ${engine} enters a Patreon post opened from the feed, and cancels when navigating away`, { timeout: 90_000 }, async t => {
    const browserType = (await import('playwright'))[engine];
    assert.ok(existsSync(browserType.executablePath()), `${engine} must be installed`);
    const browser = await browserType.launch({ headless: true });
    ownTestBrowser(t, browser);
    try {
      const page = await browser.newPage();
      await open(page, '/home');
      await addPlayer(page);
      await page.clock.install();
      await page.clock.pauseAt(new Date(Date.now() + 60_000));
      await page.evaluate(flags => {
        window.PatreonTest.installPatreonNavigation();
        const probe: Window['patreonProbe'] = { entries: 0, active: false, shown: 0, hidden: 0 };
        window.patreonProbe = probe;
        const create = () => window.PatreonTest.createAutoTheaterRuntime({
          visit: { current: { identity: null, entered: false } },
          enabled: () => true, policyAllowed: () => true, providerFlags: () => flags,
          editableFocused: () => false, theaterActive: () => probe.active,
          transitioning: () => false,
          findBestVideo: () => (window as unknown as { deepVideos(): HTMLVideoElement[] }).deepVideos()[0] ?? null,
          enter: () => { probe.entries++; probe.active = true; },
          showNotice: () => { probe.shown++; return () => { probe.hidden++; }; }
        });
        window.patreonRuntime = create();
      }, defaultMediaProviderFlags());
      const probe = () => page.evaluate(() => { const { entries, shown, hidden } = window.patreonProbe; return { entries, shown, hidden }; });
      const navigate = (path: string) => page.evaluate(p => history.pushState({}, '', p), path);

      // The feed is not a watch page: playing there announces nothing.
      await page.evaluate(() => (window as unknown as { deepVideos(): HTMLVideoElement[] }).deepVideos()[0].play());
      await page.waitForFunction(() => (window as unknown as { deepVideos(): HTMLVideoElement[] }).deepVideos()[0].readyState > 2);
      assert.deepEqual(await probe(), { entries: 0, shown: 0, hidden: 0 });

      // pushState alone (no popstate) opens the post: the provider-owned event starts the countdown.
      await navigate('/posts/my-post-12345678');
      assert.deepEqual(await probe(), { entries: 0, shown: 1, hidden: 0 });

      // Leaving the post cancels it, and the elapsed time never enters.
      await navigate('/creator');
      assert.deepEqual(await probe(), { entries: 0, shown: 1, hidden: 1 });
      await page.clock.runFor(6000);
      assert.deepEqual(await probe(), { entries: 0, shown: 1, hidden: 1 });

      // Back on a post, the full countdown elapses and theater is entered once.
      await navigate('/posts/another-post-87654321');
      assert.deepEqual(await probe(), { entries: 0, shown: 2, hidden: 1 });
      await page.clock.runFor(6000);
      assert.deepEqual(await probe(), { entries: 1, shown: 2, hidden: 2 });

      // Disposal removes the history hook's consumer; later navigation does nothing.
      await page.evaluate(() => window.patreonRuntime.dispose());
      await navigate('/posts/third-post-1');
      await page.clock.runFor(6000);
      assert.deepEqual(await probe(), { entries: 1, shown: 2, hidden: 2 });
    } finally { await browser.close(); }
  });
}
