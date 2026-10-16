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
    autoTheaterProbe: { entries: number; active: boolean; shown: number; hidden: number; cancel?: () => void };
    autoTheaterRuntime: AutoTheaterRuntime;
    watchPageProbe: {
      entries: number; active: boolean; enabled: boolean; policyAllowed: boolean;
      editable: boolean; transitioning: boolean; flags: MediaProviderFlags;
      candidateId: string; nativeId: string; focusChecks?: number;
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
        const probe: Window['autoTheaterProbe'] = { entries: 0, active: false, shown: 0, hidden: 0 };
        window.autoTheaterProbe = probe;
        window.autoTheaterRuntime = window.AutoTheaterTest.createAutoTheaterRuntime({
          visit: { current: { identity: null, entered: false } },
          enabled: () => true, policyAllowed: () => true, providerFlags: () => flags,
          editableFocused: () => false, theaterActive: () => probe.active,
          transitioning: () => false, findBestVideo: () => document.querySelector('video'),
          enter: () => { probe.entries++; probe.active = true; },
          showNotice: () => () => {}, minNoticeMs: 0
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

  it(`auto entry in ${engine} announces intent, waits out the minimum notice time, and cancels on request`, { timeout: 60_000 }, async t => {
    const browserType = (await import('playwright'))[engine];
    assert.ok(existsSync(browserType.executablePath()), `${engine} must be installed`);
    const browser = await browserType.launch({ headless: true });
    ownTestBrowser(t, browser);
    try {
      const page = await browser.newPage();
      await page.addInitScript('window.__name = target => target;');
      await page.route('https://www.youtube.com/**', route => route.fulfill({
        contentType: 'text/html', body: '<ytd-watch-flexy><div id="movie_player"><video class="html5-main-video" muted loop style="width:640px;height:360px"></video></div></ytd-watch-flexy>'
      }));
      await page.goto('https://www.youtube.com/watch?v=abcdefghijk');
      await page.evaluate(media => {
        document.querySelector('video')!.src = media;
        Object.assign(document.getElementById('movie_player')!, {
          getVideoData: () => ({ video_id: new URL(location.href).searchParams.get('v') }),
          getPlayerState: () => 3
        });
      }, MEDIA);
      await page.waitForFunction(() => document.querySelector('video')!.readyState > 2);
      await page.addScriptTag({ content: BUNDLE });
      await page.clock.install();
      await page.clock.pauseAt(new Date(Date.now() + 60_000)); // Time moves only through runFor.
      const start = (identity: string) => page.evaluate(flags => {
        window.AutoTheaterTest.installWatchPlaybackQueries();
        const probe: Window['autoTheaterProbe'] = { entries: 0, active: false, shown: 0, hidden: 0 };
        window.autoTheaterProbe = probe;
        window.autoTheaterRuntime?.dispose();
        window.autoTheaterRuntime = window.AutoTheaterTest.createAutoTheaterRuntime({
          visit: { current: { identity: null, entered: false } },
          enabled: () => true, policyAllowed: () => true, providerFlags: () => flags,
          editableFocused: () => false, theaterActive: () => probe.active,
          transitioning: () => false, findBestVideo: () => document.querySelector('video'),
          enter: () => { probe.entries++; probe.active = true; },
          showNotice: cancel => { probe.shown++; probe.cancel = cancel; return () => { probe.hidden++; }; }
        });
      }, defaultMediaProviderFlags()).then(() => identity);
      const probe = () => page.evaluate(() => { const { entries, active, shown, hidden } = window.autoTheaterProbe; return { entries, active, shown, hidden }; });

      await start('first');
      await page.locator('video').evaluate((video: HTMLVideoElement) => video.play());
      assert.deepEqual(await probe(), { entries: 0, active: false, shown: 1, hidden: 0 }, 'ready media is announced before entry');
      await page.clock.runFor(2999);
      assert.equal((await probe()).entries, 0);
      await page.clock.runFor(1);
      assert.deepEqual(await probe(), { entries: 1, active: true, shown: 1, hidden: 1 });

      await page.evaluate(() => { history.replaceState({}, '', '/watch?v=lmnopqrstuv'); });
      await start('second');
      await page.evaluate(() => window.autoTheaterRuntime.refresh());
      await page.clock.runFor(1000);
      assert.equal(await page.evaluate(() => window.autoTheaterRuntime.cancelPending()), true);
      await page.clock.runFor(10_000);
      await page.evaluate(() => {
        document.querySelector('video')!.dispatchEvent(new Event('playing'));
        window.autoTheaterRuntime.refresh();
      });
      await page.clock.runFor(10_000);
      assert.deepEqual(await probe(), { entries: 0, active: false, shown: 1, hidden: 1 }, 'cancelling stops entry for the same media');

      await page.evaluate(() => { history.replaceState({}, '', '/watch?v=zyxwvutsrqp'); });
      await page.evaluate(() => document.dispatchEvent(new Event('yt-navigate-finish')));
      await page.evaluate(() => window.autoTheaterRuntime.refresh());
      assert.equal((await probe()).shown, 2, 'new content announces again');
      await page.evaluate(() => window.autoTheaterRuntime.dispose());
      await page.clock.runFor(10_000);
      assert.deepEqual(await probe(), { entries: 0, active: false, shown: 2, hidden: 2 }, 'disposal removes the notice and entry');
    } finally {
      await browser.close();
    }
  });

  for (const scenario of ['yt-player-updated', 'yt-page-data-updated', 'focus', 'fullscreen', 'transition', 'miniplayer', 'observe retry', 'observe player'] as const) {
    it(`YouTube auto entry in ${engine} re-evaluates ${scenario} without another playing event`, { timeout: 60_000 }, async t => {
      const browserType = (await import('playwright'))[engine];
      const browser = await browserType.launch({ headless: true });
      ownTestBrowser(t, browser);
      try {
        const page = await browser.newPage();
        await page.addInitScript('window.__name = target => target;');
        await page.route('https://www.youtube.com/**', route => route.fulfill({
          contentType: 'text/html', body: '<input id="search"><input id="comment"><ytd-miniplayer></ytd-miniplayer><ytd-watch-flexy><div id="movie_player"><video class="html5-main-video" muted loop style="width:640px;height:360px"></video></div></ytd-watch-flexy>'
        }));
        await page.goto('https://www.youtube.com/watch?v=abcdefghijk');
        await page.addScriptTag({ content: BUNDLE });
        await page.evaluate(({ flags, scenario }) => {
          window.AutoTheaterTest.installWatchPlaybackQueries();
          const probe: Window['watchPageProbe'] = {
            entries: 0, active: false, enabled: true, policyAllowed: true,
            editable: false, transitioning: scenario === 'transition', flags,
            candidateId: '', nativeId: 'abcdefghijk'
          };
          window.watchPageProbe = probe;
          const player = document.getElementById('movie_player')!;
          Object.assign(player, { getVideoData: () => ({ video_id: probe.nativeId }) });
          if (scenario.startsWith('yt-')) {
            history.pushState({}, '', '/watch?v=lmnopqrstuv');
          } else if (scenario === 'focus') {
            document.getElementById('search')!.focus();
          } else if (scenario === 'fullscreen') {
            Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => player });
          } else if (scenario === 'miniplayer') {
            history.pushState({}, '', '/');
            document.querySelector('ytd-miniplayer')!.append(player);
          } else if (scenario === 'observe retry') {
            player.id = 'pending-player';
            player.classList.add('ad-showing');
          } else if (scenario === 'observe player') {
            // The candidate exists before the stable player adopts it.
            document.querySelector('ytd-watch-flexy')!.append(document.querySelector('video')!);
            player.classList.add('ad-showing');
          }
          window.autoTheaterRuntime = window.AutoTheaterTest.createAutoTheaterRuntime({
            visit: { current: { identity: null, entered: false } },
            enabled: () => true, policyAllowed: () => true, providerFlags: () => flags,
            editableFocused: () => {
              probe.focusChecks = (probe.focusChecks ?? 0) + 1;
              return document.activeElement instanceof HTMLInputElement;
            },
            theaterActive: () => probe.active, transitioning: () => probe.transitioning,
            findBestVideo: () => document.querySelector('video'),
            enter: () => { probe.entries++; probe.active = true; }
          });
        }, { flags: defaultMediaProviderFlags(), scenario });
        await page.locator('video').evaluate(async (video: HTMLVideoElement, media) => {
          video.src = media;
          await video.play();
        }, MEDIA);
        await page.waitForFunction(() => {
          const video = document.querySelector('video')!;
          return !video.paused && video.readyState > 2;
        });
        assert.equal(await page.evaluate(() => window.watchPageProbe.entries), 0, 'initial gate must block entry');
        if (scenario === 'focus') {
          const checks = await page.evaluate(() => window.watchPageProbe.focusChecks ?? 0);
          await page.locator('#comment').focus();
          await page.waitForFunction(checks => (window.watchPageProbe.focusChecks ?? 0) > checks, checks);
          assert.equal(await page.evaluate(() => window.watchPageProbe.entries), 0, 'moving between editable fields stays blocked');
        }
        await page.evaluate(scenario => {
          const player = document.querySelector('ytd-watch-flexy div, ytd-miniplayer div')!;
          if (scenario.startsWith('yt-')) {
            window.watchPageProbe.nativeId = 'lmnopqrstuv';
            document.dispatchEvent(new Event(scenario));
          } else if (scenario === 'focus') {
            (document.activeElement as HTMLElement).blur();
          } else if (scenario === 'fullscreen') {
            Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });
            document.dispatchEvent(new Event('fullscreenchange'));
          } else if (scenario === 'transition') {
            window.watchPageProbe.transitioning = false;
            // player-runtime calls refresh when its existing transition timer ends.
            window.autoTheaterRuntime.refresh();
          } else if (scenario === 'miniplayer') {
            history.pushState({}, '', '/watch?v=abcdefghijk');
            document.dispatchEvent(new Event('yt-navigate-finish'));
            document.querySelector('ytd-watch-flexy')!.append(player);
            document.dispatchEvent(new Event('yt-page-data-updated'));
          } else {
            player.id = 'movie_player';
            if (scenario === 'observe retry') document.dispatchEvent(new Event('yt-player-updated'));
            player.append(document.querySelector('video')!);
            player.classList.remove('ad-showing');
          }
        }, scenario);
        await page.waitForFunction(() => window.watchPageProbe.entries === 1);
        await page.evaluate(() => {
          const trigger = () => {
            for (const name of ['yt-player-updated', 'yt-page-data-updated', 'yt-navigate-finish', 'fullscreenchange', 'focusout']) {
              document.dispatchEvent(new Event(name));
            }
            document.querySelector('video')!.dispatchEvent(new Event('playing'));
          };
          trigger();
          window.watchPageProbe.active = false;
          trigger();
          // Queue a focus callback before disposal, then change the visit.
          window.autoTheaterRuntime.dispose();
          window.autoTheaterRuntime.dispose();
          history.pushState({}, '', '/watch?v=zyxwvutsrqp');
          window.watchPageProbe.nativeId = 'zyxwvutsrqp';
          trigger();
          window.autoTheaterRuntime.refresh();
        });
        assert.equal(await page.evaluate(() => window.watchPageProbe.entries), 1, 'repeated triggers, exit and disposal must not reenter');
      } finally {
        await browser.close();
      }
    });
  }

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
            enter: () => { probe.entries++; probe.active = true; },
          showNotice: () => () => {}, minNoticeMs: 0
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
