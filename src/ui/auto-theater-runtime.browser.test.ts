import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { it } from 'node:test';
import { defaultMediaProviderFlags, type MediaProviderFlags } from '../media-features/provider-flags';
import { ownTestBrowser } from '../test-utils/test-browser';
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
    watchPageProbe: {
      entries: number; active: boolean; enabled: boolean; policyAllowed: boolean;
      editable: boolean; transitioning: boolean; flags: MediaProviderFlags;
      candidateId: string; nativeId: string;
    };
  }
}

for (const engine of ['chromium', 'firefox'] as const) {
  it(`auto entry in ${engine} accepts native playing before YouTube state catches up, but rejects ads and stale content`, { timeout: 60_000 }, async t => {
    const browserType = (await import('playwright'))[engine];
    assert.ok(existsSync(browserType.executablePath()), `${engine} must be installed`);
    const browser = await browserType.launch({ headless: true });
    ownTestBrowser(t, browser);
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

  for (const fixture of [
    {
      provider: 'netflix', origin: 'https://www.netflix.com', catalog: '/browse',
      first: '70248299', second: '70248300', third: '70248301', path: '/watch/',
      body: '<div class="watch-video"><div data-uia="player" data-videoid="70248299"><div id="session-element"><video id="main" muted loop></video></div><video id="standby" muted loop hidden></video></div></div><video id="aux" muted loop></video>'
    },
    {
      provider: 'disney', origin: 'https://www.disneyplus.com', catalog: '/pl-pl/browse',
      first: '560861a0-55c9-4552-a181-64c498e01b62', second: '86e14fdb-3841-4282-ad38-07c8c4aab4b6',
      third: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', path: '/pl-pl/play/',
      body: '<disney-web-player><video id="main" class="hive-video" muted loop></video><video id="aux" class="hive-video btm-media-client-element" muted loop></video><video id="standby" class="hive-video" muted loop hidden></video></disney-web-player>'
    }
  ] as const) {
    it(`${fixture.provider} auto entry in ${engine} qualifies the URL before the player and preserves session guards`, { timeout: 60_000 }, async t => {
      const browserType = (await import('playwright'))[engine];
      assert.ok(existsSync(browserType.executablePath()), `${engine} must be installed`);
      const browser = await browserType.launch({ headless: true });
      ownTestBrowser(t, browser);
      try {
        const page = await browser.newPage();
        await page.addInitScript('window.__name = target => target;');
        await page.route(`${fixture.origin}/**`, route => route.fulfill({
          contentType: 'text/html', body: `<!doctype html><style>video { width:640px; height:360px }</style>${fixture.body}`
        }));
        await page.goto(`${fixture.origin}${fixture.catalog}`);
        await page.addScriptTag({ content: BUNDLE });
        await page.evaluate(({ flags, first }) => {
          window.AutoTheaterTest.installWatchPlaybackQueries();
          const probe: Window['watchPageProbe'] = {
            entries: 0, active: false, enabled: true, policyAllowed: true,
            editable: false, transitioning: false, flags, candidateId: 'aux', nativeId: first
          };
          window.watchPageProbe = probe;
          window.autoTheaterRuntime = window.AutoTheaterTest.createAutoTheaterRuntime({
            visit: { current: { identity: null, entered: false } },
            enabled: () => probe.enabled, policyAllowed: () => probe.policyAllowed,
            providerFlags: () => probe.flags, editableFocused: () => probe.editable,
            theaterActive: () => probe.active, transitioning: () => probe.transitioning,
            findBestVideo: () => document.getElementById(probe.candidateId) as HTMLVideoElement,
            enter: () => { probe.entries++; probe.active = true; }
          });
        }, { flags: defaultMediaProviderFlags(), first: fixture.first });
        await page.evaluate(async media => {
          await Promise.all(Array.from(document.querySelectorAll('video')).map(video => {
            video.src = media;
            return video.play();
          }));
        }, MEDIA);
        const entries = () => page.evaluate(() => window.watchPageProbe.entries);
        assert.equal(await entries(), 0, 'catalog playback must not enter');
        await page.evaluate(({ path, first, provider }) => {
          history.pushState({}, '', `${path}${first}?tracking=first`);
          window.dispatchEvent(new Event(`theater-everywhere-${provider}-harvest`));
        }, fixture);
        assert.equal(await entries(), 0, 'an auxiliary candidate must not be confirmed as the primary video');
        await page.evaluate(() => {
          window.watchPageProbe.candidateId = 'main';
          document.getElementById('standby')!.hidden = false;
          window.autoTheaterRuntime.refresh();
        });
        assert.equal(await entries(), 0, 'multiple playing primary videos must not be guessed between');
        await page.evaluate(() => {
          document.getElementById('standby')!.hidden = true;
          document.querySelector<HTMLVideoElement>('video#main')!.pause();
          window.autoTheaterRuntime.refresh();
        });
        assert.equal(await entries(), 0, 'a paused watch player must not enter');
        await page.locator('video#main').evaluate((video: HTMLVideoElement) => video.play());
        await page.waitForFunction(() => window.watchPageProbe.entries === 1);
        await page.evaluate(() => { window.watchPageProbe.active = false; });
        for (const setting of ['enabled', 'policyAllowed'] as const) {
          await page.evaluate(setting => {
            window.watchPageProbe[setting] = false;
            window.autoTheaterRuntime.refresh();
            window.watchPageProbe[setting] = true;
            window.autoTheaterRuntime.refresh();
          }, setting);
        }
        await page.evaluate(({ provider, path, first }) => {
          history.replaceState({}, '', `${path}${first}?tracking=changed`);
          window.watchPageProbe.flags[provider] = false;
          window.autoTheaterRuntime.refresh();
          window.watchPageProbe.flags[provider] = true;
          window.autoTheaterRuntime.refresh();
        }, fixture);
        assert.equal(await entries(), 1, 'manual exit survives tracking and preference changes');

        // New episode: shared gates remain independent of URL eligibility.
        await page.evaluate(({ path, second, provider }) => {
          window.watchPageProbe.flags[provider] = false;
          history.pushState({}, '', `${path}${second}`);
          window.dispatchEvent(new Event(`theater-everywhere-${provider}-harvest`));
          document.querySelector('[data-uia="player"]')?.setAttribute('data-videoid', second);
        }, fixture);
        assert.equal(await entries(), 1, 'disabled provider must not enter a new episode');
        for (const setting of ['enabled', 'policyAllowed', 'editable', 'transitioning'] as const) {
          await page.evaluate(({ setting, provider }) => {
            const probe = window.watchPageProbe;
            probe.flags[provider] = true;
            probe[setting] = setting === 'editable' || setting === 'transitioning';
            window.autoTheaterRuntime.refresh();
            // Restore without refreshing until the next guard is in place.
            probe[setting] = setting !== 'editable' && setting !== 'transitioning';
          }, { setting, provider: fixture.provider });
          assert.equal(await entries(), 1, `${setting} guard must block entry`);
        }
        await page.evaluate(provider => {
          document.documentElement.setAttribute(`data-te-${provider}-integration-off`, '');
          window.autoTheaterRuntime.refresh();
        }, fixture.provider);
        assert.equal(await entries(), 1, 'MAIN must independently honor the provider flag');
        await page.evaluate(provider => {
          document.documentElement.removeAttribute(`data-te-${provider}-integration-off`);
        }, fixture.provider);

        if (fixture.provider === 'netflix') {
          await page.evaluate(first => {
            document.querySelector('[data-uia="player"]')!.setAttribute('data-videoid', first);
            window.autoTheaterRuntime.refresh();
          }, fixture.first);
          assert.equal(await entries(), 1, 'stale labeled player identity must block entry');
          await page.evaluate(second => {
            document.querySelector('[data-uia="player"]')!.setAttribute('data-videoid', second);
            Object.assign(window, { netflix: { appContext: { state: { playerApp: { getAPI: () => ({
              videoPlayer: {
                getAllPlayerSessionIds: () => ['watch'],
                getVideoPlayerBySessionId: () => ({
                  getMovieId: () => window.watchPageProbe.nativeId,
                  getElement: () => document.getElementById('session-element')
                })
              }
            }) } } } } });
            window.autoTheaterRuntime.refresh();
          }, fixture.second);
          assert.equal(await entries(), 1, 'stale native session must block entry despite the new URL');
          await page.evaluate(second => { window.watchPageProbe.nativeId = second; }, fixture.second);
        }
        await page.evaluate(provider => window.dispatchEvent(new Event(`theater-everywhere-${provider}-harvest`)), fixture.provider);
        await page.waitForFunction(() => window.watchPageProbe.entries === 2);

        await page.evaluate(({ path, third, provider }) => {
          history.pushState({}, '', `${path}${third}`);
          window.dispatchEvent(new Event(`theater-everywhere-${provider}-harvest`));
          window.watchPageProbe.active = false;
          window.autoTheaterRuntime.refresh();
        }, fixture);
        assert.equal(await entries(), 2, 'navigation with theater already open reserves the next visit');
        await page.evaluate(({ path, first, provider }) => {
          window.autoTheaterRuntime.dispose();
          history.pushState({}, '', `${path}${first}`);
          document.querySelector('[data-uia="player"]')?.setAttribute('data-videoid', first);
          window.watchPageProbe.nativeId = first;
          document.querySelector('video#main')!.dispatchEvent(new Event('playing'));
          window.dispatchEvent(new Event(`theater-everywhere-${provider}-harvest`));
        }, fixture);
        assert.equal(await entries(), 2, 'disposed runtime must stop reacting to playback and navigation');
      } finally {
        await browser.close();
      }
    });
  }
}
