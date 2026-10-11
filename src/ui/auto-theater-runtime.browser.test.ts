import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { it } from 'node:test';
import { defaultMediaProviderFlags } from '../media-features/provider-flags';
import type { AutoTheaterRuntime } from './auto-theater-runtime';

const require = createRequire(import.meta.url);
const esbuild = require(createRequire(require.resolve('vite')).resolve('esbuild')) as {
  buildSync(options: object): { outputFiles: Array<{ text: string }> };
};
const BUNDLE = esbuild.buildSync({
  stdin: {
    contents: "export { createAutoTheaterRuntime } from './ui/auto-theater-runtime'; export { installWatchPlaybackQueries } from './providers/watch-playback';",
    resolveDir: new URL('../', import.meta.url).pathname, loader: 'ts'
  },
  bundle: true, write: false, format: 'iife', globalName: 'AutoTheaterTest',
  platform: 'browser', target: 'es2022', logLevel: 'silent'
}).outputFiles[0].text;
const MEDIA = `data:video/webm;base64,${readFileSync(new URL('../../test/fixtures/vod.webm', import.meta.url)).toString('base64')}`;

declare global {
  interface Window {
    AutoTheaterTest: {
      createAutoTheaterRuntime: typeof import('./auto-theater-runtime').createAutoTheaterRuntime;
      installWatchPlaybackQueries(): void;
    };
    autoTheaterProbe: { entries: number; active: boolean };
    autoTheaterRuntime: AutoTheaterRuntime;
  }
}

for (const engine of ['chromium', 'firefox'] as const) {
  it(`auto entry in ${engine} accepts native playing before YouTube state catches up, but rejects ads and stale content`, { timeout: 60_000 }, async () => {
    const browserType = (await import('playwright'))[engine];
    assert.ok(existsSync(browserType.executablePath()), `${engine} must be installed`);
    const browser = await browserType.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.addInitScript('window.__name = target => target;');
      await page.route('https://www.youtube.com/**', route => route.fulfill({
        contentType: 'text/html', body: '<ytd-watch-flexy><div id="movie_player" class="ad-showing"><video class="html5-main-video" muted loop style="width:640px;height:360px"></video></div></ytd-watch-flexy>'
      }));
      await page.goto('https://www.youtube.com/watch?v=abcdefghijk');
      await page.evaluate(media => {
        const video = document.querySelector('video')!;
        video.src = media;
        Object.assign(document.getElementById('movie_player')!, {
          getVideoData: () => ({ video_id: new URL(location.href).searchParams.get('v') }),
          getPlayerState: () => 3
        });
      }, MEDIA);
      await page.waitForFunction(() => document.querySelector('video')!.readyState > 2);
      await page.addScriptTag({ content: BUNDLE });
      await page.evaluate(flags => {
        window.AutoTheaterTest.installWatchPlaybackQueries();
        const probe: Window['autoTheaterProbe'] = { entries: 0, active: false };
        window.autoTheaterProbe = probe;
        window.autoTheaterRuntime = window.AutoTheaterTest.createAutoTheaterRuntime({
          visit: { current: { identity: null, entered: false } },
          enabled: () => true, policyAllowed: () => true, providerFlags: () => flags,
          editableFocused: () => false, theaterActive: () => probe.active,
          transitioning: () => false, findBestVideo: () => document.querySelector('video'),
          enter: () => { probe.entries++; probe.active = true; }
        });
      }, defaultMediaProviderFlags());
      await page.locator('video').evaluate((video: HTMLVideoElement) => video.play());
      assert.equal(await page.evaluate(() => window.autoTheaterProbe.entries), 0, 'preroll must not enter');
      await page.evaluate(() => {
        history.replaceState({}, '', '/watch?v=lmnopqrstuv');
        document.getElementById('movie_player')!.classList.remove('ad-showing');
        // The old content API must remain authoritative during navigation.
        Object.assign(document.getElementById('movie_player')!, { getVideoData: () => ({ video_id: 'abcdefghijk' }) });
        window.autoTheaterRuntime.refresh();
      });
      assert.equal(await page.evaluate(() => window.autoTheaterProbe.entries), 0, 'stale content must not enter');
      await page.locator('video').evaluate((video: HTMLVideoElement) => video.pause());
      await page.evaluate(() => {
        Object.assign(document.getElementById('movie_player')!, { getVideoData: () => ({ video_id: 'lmnopqrstuv' }) });
      });
      // Real media event: the host's API stays at 3 throughout this test.
      await page.locator('video').evaluate((video: HTMLVideoElement) => video.play());
      await page.waitForFunction(() => window.autoTheaterProbe.entries === 1);
      await page.evaluate(() => {
        window.autoTheaterProbe.active = false;
        window.autoTheaterRuntime.refresh();
        window.autoTheaterRuntime.dispose();
        history.replaceState({}, '', '/watch?v=zyxwvutsrqp');
        document.dispatchEvent(new Event('yt-navigate-finish'));
        document.querySelector('video')!.dispatchEvent(new Event('playing'));
      });
      assert.equal(await page.evaluate(() => window.autoTheaterProbe.entries), 1, 'exit and cleanup must prevent reentry');
    } finally {
      await browser.close();
    }
  });
}
