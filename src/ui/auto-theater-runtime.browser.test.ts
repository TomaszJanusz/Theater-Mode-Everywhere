import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { it } from 'node:test';

import { chromium, firefox } from 'playwright';

import { defaultMediaProviderFlags, type MediaProviderFlags } from '../media-features/provider-flags';
import { PROVIDER_ENTRIES, bundleModules } from '../test-utils/player-boot';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { testEngines } from '../test-utils/test-engines';

import { AUTO_ENTER_CANCEL_GRACE_MS as GRACE_MS } from './auto-theater-intent';
import { AUTO_ENTER_NOTICE_DELAY_MS as DELAY_MS, type AutoTheaterRuntime } from './auto-theater-runtime';

const BUNDLE = bundleModules([...PROVIDER_ENTRIES, "export { createAutoTheaterRuntime } from './ui/auto-theater-runtime'; export { installWatchPlaybackQueries, confirmProviderWatchVideo, confirmProviderPreparingVideo } from './providers/watch-playback';"], 'AutoTheaterTest');
const MEDIA = `data:video/webm;base64,${readFileSync(new URL('../../test/fixtures/vod.webm', import.meta.url)).toString('base64')}`;

declare global {
  interface Window {
    AutoTheaterTest: {
      createAutoTheaterRuntime: typeof import('./auto-theater-runtime').createAutoTheaterRuntime;
      installWatchPlaybackQueries(): void;
      confirmProviderWatchVideo(video: HTMLVideoElement): boolean;
      confirmProviderPreparingVideo(video: HTMLVideoElement): boolean;
    };
    autoTheaterProbe: { entries: number; active: boolean; shown: number; hidden: number; cancel?: () => void; remaining?: number };
    autoTheaterRuntime: AutoTheaterRuntime;
    watchPageProbe: {
      entries: number; active: boolean; enabled: boolean; policyAllowed: boolean;
      editable: boolean; transitioning: boolean; flags: MediaProviderFlags;
      candidateId: string; nativeId: string; focusChecks?: number;
    };
  }
}

for (const engine of testEngines()) {
  const shared = sharedTestBrowser(({ chromium, firefox })[engine]);
  it(`auto entry in ${engine} accepts native playing before YouTube state catches up, but rejects ads and stale content`, { timeout: 60_000 }, async t => {
    const browserType = (await import('playwright'))[engine];
    assert.ok(existsSync(browserType.executablePath()), `${engine} must be installed`);
    const context = await shared.newContext(t);
    try {
      const page = await context.newPage();
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
          serviceEnabled: () => true,
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
      await context.close();
    }
  });

  it(`auto entry in ${engine} announces intent, waits out the minimum notice time, and cancels on request`, { timeout: 60_000 }, async t => {
    const browserType = (await import('playwright'))[engine];
    assert.ok(existsSync(browserType.executablePath()), `${engine} must be installed`);
    const context = await shared.newContext(t);
    try {
      const page = await context.newPage();
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
          serviceEnabled: () => true,
          enabled: () => true, policyAllowed: () => true, providerFlags: () => flags,
          editableFocused: () => false, theaterActive: () => probe.active,
          transitioning: () => false, findBestVideo: () => document.querySelector('video'),
          enter: () => { probe.entries++; probe.active = true; },
          showNotice: cancel => { probe.shown++; probe.cancel = cancel; return () => { probe.hidden++; }; }, noticeDelayMs: 0
        });
      }, defaultMediaProviderFlags()).then(() => identity);
      const probe = () => page.evaluate(() => { const { entries, active, shown, hidden } = window.autoTheaterProbe; return { entries, active, shown, hidden }; });

      await start('first');
      await page.locator('video').evaluate((video: HTMLVideoElement) => video.play());
      assert.deepEqual(await probe(), { entries: 0, active: false, shown: 1, hidden: 0 }, 'ready media is announced before entry');
      await page.clock.runFor(4999);
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
      await context.close();
    }
  });

  it(`the AutoTheater notice in ${engine} appears after its delay and never mounts for work that ended earlier`, { timeout: 60_000 }, async t => {
    const browserType = (await import('playwright'))[engine];
    assert.ok(existsSync(browserType.executablePath()), `${engine} must be installed`);
    const context = await shared.newContext(t);
    try {
      const page = await context.newPage();
      await page.addInitScript('window.__name = target => target;');
      await page.route('https://www.youtube.com/**', route => route.fulfill({
        contentType: 'text/html', body: '<ytd-watch-flexy><div id="movie_player"><video class="html5-main-video" muted style="width:640px;height:360px"></video></div></ytd-watch-flexy>'
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
      await page.clock.pauseAt(new Date(Date.now() + 60_000));
      const start = () => page.evaluate(flags => {
        window.AutoTheaterTest.installWatchPlaybackQueries();
        const probe: Window['autoTheaterProbe'] = { entries: 0, active: false, shown: 0, hidden: 0 };
        window.autoTheaterProbe = probe;
        window.autoTheaterRuntime?.dispose();
        window.autoTheaterRuntime = window.AutoTheaterTest.createAutoTheaterRuntime({
          visit: { current: { identity: null, entered: false } },
          serviceEnabled: () => true,
          enabled: () => true, policyAllowed: () => true, providerFlags: () => flags,
          editableFocused: () => false, theaterActive: () => probe.active,
          transitioning: () => false, findBestVideo: () => document.querySelector('video'),
          enter: () => { probe.entries++; probe.active = true; },
          showNotice: (cancel, remainingMs) => { probe.shown++; probe.cancel = cancel; probe.remaining = remainingMs(); return () => { probe.hidden++; }; }
        });
      }, defaultMediaProviderFlags());
      const probe = () => page.evaluate(() => { const { entries, shown, hidden } = window.autoTheaterProbe; return { entries, shown, hidden }; });
      const play = () => page.locator('video').evaluate((video: HTMLVideoElement) => video.play());

      await start();
      await play();
      await page.clock.runFor(DELAY_MS - 1);
      assert.deepEqual(await probe(), { entries: 0, shown: 0, hidden: 0 }, 'nothing mounts before the delay');
      await page.clock.runFor(1);
      assert.deepEqual(await probe(), { entries: 0, shown: 1, hidden: 0 }, 'the notice mounts once the delay passes');
      const remaining = await page.evaluate(() => window.autoTheaterProbe.remaining!);
      assert.ok(remaining <= 5000 - DELAY_MS, 'the countdown kept running during the delay');
      await page.clock.runFor(10_000);
      assert.equal((await probe()).entries, 1, 'entry timing is unchanged by the delay');

      // Cancelling inside the delay leaves nothing to mount, now or later.
      await page.evaluate(() => { history.replaceState({}, '', '/watch?v=lmnopqrstuv'); });
      await start();
      await play();
      await page.clock.runFor(DELAY_MS - 50);
      assert.equal(await page.evaluate(() => window.autoTheaterRuntime.cancelPending()), true);
      await page.clock.runFor(10_000);
      assert.deepEqual(await probe(), { entries: 0, shown: 0, hidden: 0 }, 'a cancelled entry never shows its notice');

      // Disposal inside the delay behaves the same.
      await page.evaluate(() => { history.replaceState({}, '', '/watch?v=zyxwvutsrqp'); });
      await start();
      await play();
      await page.clock.runFor(DELAY_MS - 50);
      await page.evaluate(() => window.autoTheaterRuntime.dispose());
      await page.clock.runFor(10_000);
      assert.deepEqual(await probe(), { entries: 0, shown: 0, hidden: 0 }, 'a disposed runtime never mounts');

      // A replaced identity inside the delay drops the old pending mount; the new one starts its own delay.
      await page.evaluate(() => { history.replaceState({}, '', '/watch?v=abcdefghijk'); });
      await start();
      await play();
      await page.clock.runFor(DELAY_MS - 50);
      await page.evaluate(() => {
        history.replaceState({}, '', '/watch?v=lmnopqrstuv');
        document.dispatchEvent(new Event('yt-navigate-finish'));
        window.autoTheaterRuntime.refresh();
      });
      await page.clock.runFor(60);
      assert.deepEqual(await probe(), { entries: 0, shown: 0, hidden: 0 }, 'the old identity does not mount');
      await page.clock.runFor(DELAY_MS);
      assert.deepEqual(await probe(), { entries: 0, shown: 1, hidden: 0 }, 'the new identity mounts after its own delay');
    } finally {
      await context.close();
    }
  });

  it(`AutoTheater countdown in ${engine} starts while loading and restarts or cancels on host state changes`, { timeout: 90_000 }, async t => {
    const browserType = (await import('playwright'))[engine];
    assert.ok(existsSync(browserType.executablePath()), `${engine} must be installed`);
    const context = await shared.newContext(t);
    try {
      const page = await context.newPage();
      await page.addInitScript('window.__name = target => target;');
      await page.route('https://www.youtube.com/**', route => route.fulfill({
        contentType: 'text/html', body: '<ytd-watch-flexy><div id="movie_player"><video class="html5-main-video" muted style="width:640px;height:360px"></video></div></ytd-watch-flexy>'
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
      await page.clock.pauseAt(new Date(Date.now() + 60_000));
      await page.evaluate(() => {
        // Host-controlled media facts, so loading states are deterministic.
        (window as unknown as { fake(patch: object, event?: string): void }).fake = (patch, event) => {
          const video = document.querySelector('video')!;
          const state = Object.assign((video as unknown as { facts?: object }).facts ?? { paused: true, ended: false, readyState: 0, networkState: 2, error: null }, patch);
          (video as unknown as { facts?: object }).facts = state;
          for (const key of Object.keys(state)) Object.defineProperty(video, key, { get: () => (state as Record<string, unknown>)[key], configurable: true });
          if (event) video.dispatchEvent(new Event(event));
        };
      });
      const start = () => page.evaluate(flags => {
        window.AutoTheaterTest.installWatchPlaybackQueries();
        const probe: Window['autoTheaterProbe'] = { entries: 0, active: false, shown: 0, hidden: 0 };
        window.autoTheaterProbe = probe;
        window.autoTheaterRuntime?.dispose();
        window.autoTheaterRuntime = window.AutoTheaterTest.createAutoTheaterRuntime({
          visit: { current: { identity: null, entered: false } },
          serviceEnabled: () => true,
          enabled: () => true, policyAllowed: () => true, providerFlags: () => flags,
          editableFocused: () => false, theaterActive: () => probe.active,
          transitioning: () => false, findBestVideo: () => document.querySelector('video'),
          enter: () => { probe.entries++; probe.active = true; },
          showNotice: cancel => { probe.shown++; probe.cancel = cancel; return () => { probe.hidden++; }; }, noticeDelayMs: 0
        });
      }, defaultMediaProviderFlags());
      const fake = (patch: object, event?: string) => page.evaluate(([p, e]) => (window as unknown as { fake(patch: object, event?: string): void }).fake(p as object, e as string | undefined), [patch, event] as const);
      const probe = () => page.evaluate(() => { const { entries, shown, hidden } = window.autoTheaterProbe; return { entries, shown, hidden }; });
      const reset = async () => {
        await page.evaluate(() => { window.autoTheaterProbe.active = false; });
        await fake({ paused: true, ended: false, readyState: 0, networkState: 2, error: null }, 'pause');
        await start();
      };

      await start();
      await fake({ paused: false, readyState: 1 }, 'loadstart');
      assert.deepEqual(await probe(), { entries: 0, shown: 1, hidden: 0 }, 'a loading main video starts the notice');

      // Pause cancels without consuming the visit; resume restarts the full countdown.
      await page.clock.runFor(3000);
      await fake({ paused: true }, 'pause');
      assert.deepEqual(await probe(), { entries: 0, shown: 1, hidden: 0 }, 'a pause keeps the notice through the grace');
      await page.clock.runFor(GRACE_MS);
      assert.deepEqual(await probe(), { entries: 0, shown: 1, hidden: 1 });
      await fake({ paused: false }, 'play');
      assert.equal((await probe()).shown, 2);
      await page.clock.runFor(4999);
      await fake({ readyState: 4 }, 'playing'); // Playback before 5 s waits for the timer.
      assert.equal((await probe()).entries, 0);
      await page.clock.runFor(1);
      assert.equal((await probe()).entries, 1);

      await reset();
      await fake({ paused: false, readyState: 1 }, 'loadstart');
      await page.clock.runFor(10_000);
      assert.deepEqual(await probe(), { entries: 0, shown: 1, hidden: 0 }, 'still loading at 5 s keeps waiting');
      await fake({ readyState: 4 }, 'playing');
      assert.equal((await probe()).entries, 1, 'enters on playing');

      for (const [name, patch] of [['error', { error: {} }], ['abort', { networkState: 0 }], ['emptied', { networkState: 0, readyState: 0 }], ['ended', { ended: true }]] as const) {
        await reset();
        await fake({ paused: false, readyState: 1 }, 'loadstart');
        await page.clock.runFor(1000);
        await fake(patch, name);
        assert.deepEqual(await probe(), { entries: 0, shown: 1, hidden: 0 }, `${name} keeps the notice through the grace`);
        await page.clock.runFor(GRACE_MS);
        assert.deepEqual(await probe(), { entries: 0, shown: 1, hidden: 1 }, `${name} cancels after the grace`);
        await page.clock.runFor(10_000);
        assert.equal((await probe()).entries, 0);
        await fake({ error: null, ended: false, networkState: 2, readyState: 1 }, 'loadstart');
        assert.equal((await probe()).shown, 2, `recovery after ${name} announces again`);
      }

      // Loading blips shorter than the grace keep one notice and the original deadline.
      await reset();
      await fake({ paused: false, readyState: 1 }, 'loadstart');
      await page.clock.runFor(1000);
      for (let flap = 0; flap < 3; flap++) {
        await fake({ paused: true }, 'pause');
        await fake({ readyState: 0, networkState: 0 }, 'emptied');
        await page.evaluate(() => { document.getElementById('movie_player')!.classList.add('ad-showing'); window.autoTheaterRuntime.refresh(); });
        await page.clock.runFor(GRACE_MS - 100);
        await page.evaluate(() => { document.getElementById('movie_player')!.classList.remove('ad-showing'); });
        await fake({ paused: false, readyState: 1, networkState: 2 }, 'loadstart');
        await page.clock.runFor(100);
      }
      assert.deepEqual(await probe(), { entries: 0, shown: 1, hidden: 0 }, 'flapping within the grace never rebuilds the notice');
      await page.clock.runFor(5000 - 1000 - 3 * GRACE_MS - 1);
      await fake({ readyState: 4 }, 'playing');
      assert.equal((await probe()).entries, 0);
      await page.clock.runFor(1);
      assert.equal((await probe()).entries, 1, 'the original deadline still decides entry');

      // Definitive cancels skip the grace.
      await reset();
      await fake({ paused: false, readyState: 1 }, 'loadstart');
      assert.equal(await page.evaluate(() => window.autoTheaterRuntime.cancelPending()), true);
      await fake({ readyState: 1 }, 'loadstart');
      await page.clock.runFor(10_000);
      assert.deepEqual(await probe(), { entries: 0, shown: 1, hidden: 1 }, 'Esc/click consumes the visit immediately');

      // A replaced media element drops the old notice; the stale timer cannot enter.
      await reset();
      await fake({ paused: false, readyState: 1 }, 'loadstart');
      await page.clock.runFor(2000);
      await page.evaluate(() => {
        const old = document.querySelector('video')!;
        const next = old.cloneNode() as HTMLVideoElement;
        old.replaceWith(next);
        window.autoTheaterRuntime.refresh();
      });
      await page.clock.runFor(GRACE_MS);
      assert.deepEqual(await probe(), { entries: 0, shown: 1, hidden: 1 }, 'a fresh unstarted element is not announced');
      await fake({ paused: false, readyState: 1 }, 'loadstart');
      assert.deepEqual(await probe(), { entries: 0, shown: 2, hidden: 1 });
      await page.clock.runFor(3000);
      await fake({ readyState: 4 }, 'playing');
      assert.equal((await probe()).entries, 0, 'the old timer does not carry over');
      await page.clock.runFor(2000);
      assert.equal((await probe()).entries, 1);

      // YouTube ads and identity changes cancel; the countdown restarts in full.
      await reset();
      await fake({ paused: false, readyState: 1 }, 'loadstart');
      await page.clock.runFor(3000);
      await page.evaluate(() => { document.getElementById('movie_player')!.classList.add('ad-showing'); window.autoTheaterRuntime.refresh(); });
      assert.deepEqual(await probe(), { entries: 0, shown: 1, hidden: 0 }, 'ad start keeps the notice through the grace');
      await page.clock.runFor(GRACE_MS);
      assert.deepEqual(await probe(), { entries: 0, shown: 1, hidden: 1 }, 'a lasting ad cancels');
      await page.evaluate(() => { document.getElementById('movie_player')!.classList.remove('ad-showing'); window.autoTheaterRuntime.refresh(); });
      assert.equal((await probe()).shown, 2, 'ad end restarts');
      await page.clock.runFor(3000);
      assert.equal((await probe()).hidden, 1);
      await page.evaluate(() => { history.replaceState({}, '', '/watch?v=lmnopqrstuv'); window.autoTheaterRuntime.refresh(); });
      assert.deepEqual(await probe(), { entries: 0, shown: 3, hidden: 2 }, 'identity change restarts the countdown');
      await fake({ readyState: 4 }, 'playing');
      await page.clock.runFor(4999);
      assert.equal((await probe()).entries, 0, 'the earlier progress does not carry over');
      await page.clock.runFor(1);
      assert.equal((await probe()).entries, 1);
    } finally {
      await context.close();
    }
  });

  it(`AutoTheater countdown in ${engine} starts on SPA entry before YouTube reveals the watch page, but enters only when fully eligible`, { timeout: 90_000 }, async t => {
    const browserType = (await import('playwright'))[engine];
    assert.ok(existsSync(browserType.executablePath()), `${engine} must be installed`);
    const context = await shared.newContext(t);
    try {
      const page = await context.newPage();
      await page.addInitScript('window.__name = target => target;');
      await page.route('https://www.youtube.com/**', route => route.fulfill({
        contentType: 'text/html', body: '<ytd-watch-flexy hidden><div id="movie_player"><video class="html5-main-video" muted style="width:640px;height:360px"></video></div></ytd-watch-flexy>'
      }));
      await page.goto('https://www.youtube.com/');
      await page.addScriptTag({ content: BUNDLE });
      await page.clock.install();
      await page.clock.pauseAt(new Date(Date.now() + 60_000));
      await page.evaluate(flags => {
        (window as unknown as { fake(patch: object, event?: string): void }).fake = (patch, event) => {
          const video = document.querySelector('video')!;
          const state = Object.assign((video as unknown as { facts?: object }).facts ?? { paused: true, ended: false, readyState: 0, networkState: 0, error: null }, patch);
          (video as unknown as { facts?: object }).facts = state;
          for (const key of Object.keys(state)) Object.defineProperty(video, key, { get: () => (state as Record<string, unknown>)[key], configurable: true });
          if (event) video.dispatchEvent(new Event(event));
        };
        window.AutoTheaterTest.installWatchPlaybackQueries();
        const probe: Window['autoTheaterProbe'] = { entries: 0, active: false, shown: 0, hidden: 0 };
        window.autoTheaterProbe = probe;
        window.autoTheaterRuntime = window.AutoTheaterTest.createAutoTheaterRuntime({
          visit: { current: { identity: null, entered: false } },
          serviceEnabled: () => true,
          enabled: () => true, policyAllowed: () => true, providerFlags: () => flags,
          editableFocused: () => false, theaterActive: () => probe.active,
          transitioning: () => false, findBestVideo: () => document.querySelector('video'),
          enter: () => { probe.entries++; probe.active = true; },
          showNotice: () => { probe.shown++; return () => { probe.hidden++; }; }, noticeDelayMs: 0
        });
      }, defaultMediaProviderFlags());
      const fake = (patch: object, event?: string) => page.evaluate(([p, e]) => (window as unknown as { fake(patch: object, event?: string): void }).fake(p as object, e as string | undefined), [patch, event] as const);
      const probe = () => page.evaluate(() => { const { entries, shown, hidden } = window.autoTheaterProbe; return { entries, shown, hidden }; });
      const navigate = (path: string, event = 'yt-navigate-start') => page.evaluate(([p, e]) => {
        history.pushState({}, '', p);
        document.dispatchEvent(new Event(e));
      }, [path, event] as const);
      const bridge = () => page.evaluate(() => {
        const video = document.querySelector('video')!;
        return {
          main: window.AutoTheaterTest.confirmProviderWatchVideo(video),
          preparing: window.AutoTheaterTest.confirmProviderPreparingVideo(video)
        };
      });

      // Home: a play request on the hidden, sourceless player is not a watch visit.
      await fake({ paused: false }, 'play');
      assert.deepEqual(await probe(), { entries: 0, shown: 0, hidden: 0 });

      // SPA entry: still hidden, no source, no video data. The countdown starts, entry waits.
      await navigate('/watch?v=abcdefghijk');
      assert.deepEqual(await probe(), { entries: 0, shown: 1, hidden: 0 }, 'notice starts before the reveal');
      assert.deepEqual(await bridge(), { main: false, preparing: true });
      await page.clock.runFor(6000);
      await fake({ readyState: 4 }, 'playing');
      assert.deepEqual(await probe(), { entries: 0, shown: 1, hidden: 0 }, 'hidden page never enters, nor drops the notice');

      // Reveal with source and matching identity: enters immediately, the timer has elapsed.
      await page.evaluate(media => {
        document.querySelector('ytd-watch-flexy')!.removeAttribute('hidden');
        document.querySelector('video')!.src = media;
        Object.assign(document.getElementById('movie_player')!, {
          getVideoData: () => ({ video_id: new URL(location.href).searchParams.get('v') })
        });
        document.dispatchEvent(new Event('yt-page-data-updated'));
      }, MEDIA);
      assert.deepEqual(await probe(), { entries: 1, shown: 1, hidden: 1 }, 'enters once fully eligible');
      assert.deepEqual(await bridge(), { main: true, preparing: true });

      // Cancellation paths do not consume the visit and restart in full.
      const rearm = async (path: string) => {
        await page.evaluate(() => {
          window.autoTheaterProbe.active = false;
          document.querySelector('ytd-watch-flexy')!.setAttribute('hidden', '');
          document.getElementById('movie_player')!.className = '';
          Object.assign(document.getElementById('movie_player')!, { getVideoData: undefined });
          document.querySelector('video')!.removeAttribute('src');
        });
        await fake({ paused: true, readyState: 0, networkState: 0, currentSrc: '' }, 'pause'); // currentSrc outlives the attribute until a reload.
        await navigate('/');
        await page.evaluate(() => { window.autoTheaterRuntime.dispose(); });
        await page.evaluate(flags => {
          const probe = window.autoTheaterProbe;
          window.autoTheaterRuntime = window.AutoTheaterTest.createAutoTheaterRuntime({
            visit: { current: { identity: null, entered: false } },
            serviceEnabled: () => true,
            enabled: () => true, policyAllowed: () => true, providerFlags: () => flags,
            editableFocused: () => false, theaterActive: () => probe.active,
            transitioning: () => false, findBestVideo: () => document.querySelector('video'),
            enter: () => { probe.entries++; probe.active = true; },
            showNotice: () => { probe.shown++; return () => { probe.hidden++; }; }, noticeDelayMs: 0
          });
        }, defaultMediaProviderFlags());
        await fake({ paused: false, readyState: 0, networkState: 0 }, 'play');
        await navigate(path);
      };
      let base = await probe();
      const delta = async () => { const now = await probe(); return { entries: now.entries - base.entries, shown: now.shown - base.shown, hidden: now.hidden - base.hidden }; };

      await rearm('/watch?v=abcdefghijk');
      assert.deepEqual(await delta(), { entries: 0, shown: 1, hidden: 0 });
      await navigate('/results?search_query=x'); // Not a watch page after all.
      assert.deepEqual(await delta(), { entries: 0, shown: 1, hidden: 1 }, 'leaving the watch URL cancels');
      await navigate('/watch?v=abcdefghijk');
      assert.deepEqual(await delta(), { entries: 0, shown: 2, hidden: 1 }, 'the visit was not consumed');

      await page.evaluate(() => {
        Object.assign(document.getElementById('movie_player')!, { getVideoData: () => ({ video_id: 'lmnopqrstuv' }) });
        window.autoTheaterRuntime.refresh();
      });
      await page.clock.runFor(GRACE_MS);
      assert.deepEqual(await delta(), { entries: 0, shown: 2, hidden: 2 }, 'a different loaded video is stale');
      assert.deepEqual(await bridge(), { main: false, preparing: false });
      await page.evaluate(() => {
        Object.assign(document.getElementById('movie_player')!, { getVideoData: () => ({ video_id: 'abcdefghijk' }) });
        window.autoTheaterRuntime.refresh();
      });
      assert.equal((await delta()).shown, 3, 'identity catching up restarts');

      await page.evaluate(() => { document.getElementById('movie_player')!.classList.add('ad-showing'); window.autoTheaterRuntime.refresh(); });
      await page.clock.runFor(GRACE_MS);
      assert.equal((await delta()).hidden, 3, 'an ad cancels');
      assert.deepEqual(await bridge(), { main: false, preparing: false });
      await page.evaluate(() => { document.getElementById('movie_player')!.classList.remove('ad-showing'); window.autoTheaterRuntime.refresh(); });
      await fake({ paused: true }, 'pause');
      await page.clock.runFor(GRACE_MS);
      assert.deepEqual(await delta(), { entries: 0, shown: 4, hidden: 4 }, 'pausing cancels');
      await page.clock.runFor(10_000);
      assert.equal((await delta()).entries, 0);

      // A reused, visible player element with the previous video still loaded: stays quiet
      // until the player reports the new identity, then announces without waiting for sizing.
      await rearm('/watch?v=abcdefghijk');
      base = await probe();
      await page.evaluate(media => {
        document.querySelector('ytd-watch-flexy')!.removeAttribute('hidden');
        document.querySelector('video')!.src = media;
        (window as unknown as { fake(patch: object): void }).fake({ currentSrc: media });
        Object.assign(document.getElementById('movie_player')!, { getVideoData: () => ({ video_id: 'abcdefghijk' }) });
        window.autoTheaterRuntime.refresh();
      }, MEDIA);
      await fake({ readyState: 4, networkState: 1 }, 'playing');
      await page.clock.runFor(5000);
      assert.equal((await delta()).entries, 1, 'ordinary eligible player still enters after the timer');
      await page.evaluate(() => { window.autoTheaterProbe.active = false; });
      await navigate('/watch?v=lmnopqrstuv');
      const stale = await delta();
      // The abcdefghijk notice survived the reveal within the grace, so nothing new was shown for it.
      assert.equal(stale.shown, 0, 'reused element reporting the old video does not announce the new one');
      await page.evaluate(() => {
        Object.assign(document.getElementById('movie_player')!, { getVideoData: () => ({ video_id: 'lmnopqrstuv' }) });
        window.autoTheaterRuntime.refresh();
      });
      assert.equal((await delta()).shown, 1, 'announces once the new identity is reported');
    } finally {
      await context.close();
    }
  });

  // Expanding the miniplayer publishes yt-page-data-updated while the watch page is still hidden;
  // the host then reveals it and unparks the player with attribute flips only. Nothing else fires
  // for the already-playing video, so the reveal itself has to re-evaluate entry. On a slow page
  // the host moves the player into the watch page even later, again without any event, and into
  // the theater container when YouTube's own theater layout is on.
  for (const flow of ['player parked in the miniplayer', 'watch page still hidden', 'player moved in after the reveal', 'player moved into the theater container after the reveal'] as const) {
    it(`YouTube auto entry in ${engine} follows the host's silent reveal after expanding the miniplayer (${flow})`, { timeout: 60_000 }, async t => {
      const browserType = (await import('playwright'))[engine];
      assert.ok(existsSync(browserType.executablePath()), `${engine} must be installed`);
      const context = await shared.newContext(t);
      try {
        const page = await context.newPage();
        await page.addInitScript('window.__name = target => target;');
        const parked = flow !== 'watch page still hidden';
        const movedLater = flow.startsWith('player moved ');
        const destination = flow.includes('theater') ? 'player-theater-container' : 'player-container';
        const player = '<div id="movie_player"><video class="html5-main-video" muted style="width:640px;height:360px"></video></div>';
        await page.route('https://www.youtube.com/**', route => route.fulfill({
          contentType: 'text/html',
          body: `<ytd-app${parked ? ' miniplayer-is-active' : ''}><ytd-miniplayer>${parked ? player : ''}</ytd-miniplayer><ytd-watch-flexy hidden><div id="player-container">${parked ? '' : player}</div><div id="player-theater-container"></div></ytd-watch-flexy></ytd-app>`
        }));
        await page.goto('https://www.youtube.com/');
        await page.addScriptTag({ content: BUNDLE });
        // Loaded before the runtime starts: assigning a source later would fire media events,
        // which the host's silent reveal does not.
        await page.evaluate(media => new Promise<void>(resolve => {
          const video = document.querySelector('video')!;
          video.addEventListener('loadeddata', () => resolve(), { once: true });
          video.src = media;
          Object.assign(document.getElementById('movie_player')!, { getVideoData: () => ({ video_id: 'abcdefghijk' }) });
        }), MEDIA);
        await page.clock.install();
        await page.clock.pauseAt(new Date(Date.now() + 60_000));
        await page.evaluate(flags => {
          const video = document.querySelector('video')!;
          // Already playing on Home, as when the video was started in the miniplayer.
          for (const [key, value] of Object.entries({ paused: false, ended: false, readyState: 4, networkState: 2, error: null })) {
            Object.defineProperty(video, key, { get: () => value, configurable: true });
          }
          window.AutoTheaterTest.installWatchPlaybackQueries();
          const probe: Window['autoTheaterProbe'] = { entries: 0, active: false, shown: 0, hidden: 0 };
          window.autoTheaterProbe = probe;
          window.autoTheaterRuntime = window.AutoTheaterTest.createAutoTheaterRuntime({
            visit: { current: { identity: null, entered: false } },
            serviceEnabled: () => true,
            enabled: () => true, policyAllowed: () => true, providerFlags: () => flags,
            editableFocused: () => false, theaterActive: () => probe.active,
            transitioning: () => false,
            // Like the real finder, never the miniplayer's video.
            findBestVideo: () => (video.closest('ytd-miniplayer') ? null : video),
            enter: () => { probe.entries++; probe.active = true; },
            showNotice: () => { probe.shown++; return () => { probe.hidden++; }; }, noticeDelayMs: 0
          });
        }, defaultMediaProviderFlags());
        const probe = () => page.evaluate(() => { const { entries, shown } = window.autoTheaterProbe; return { entries, shown }; });

        await page.evaluate(() => {
          history.pushState({}, '', '/watch?v=abcdefghijk');
          document.dispatchEvent(new Event('yt-navigate-finish'));
          document.dispatchEvent(new Event('yt-page-data-updated'));
        });
        assert.deepEqual(await probe(), { entries: 0, shown: parked ? 0 : 1 }, 'the hidden page never enters');
        await page.clock.runFor(6000);
        assert.equal((await probe()).entries, 0, 'the hidden page never enters');

        await page.evaluate(moveNow => {
          const watch = document.querySelector('ytd-watch-flexy')!;
          if (moveNow) document.getElementById('player-container')!.append(document.getElementById('movie_player')!);
          watch.removeAttribute('hidden');
          document.querySelector('ytd-app')!.removeAttribute('miniplayer-is-active');
        }, !movedLater);
        await page.clock.runFor(6000);
        if (movedLater) {
          assert.equal((await probe()).entries, 0, 'the player is still in the miniplayer');
          await page.evaluate(id => document.getElementById(id)!.append(document.getElementById('movie_player')!), destination);
          await page.clock.runFor(6000);
        }
        assert.deepEqual(await probe(), { entries: 1, shown: 1 }, 'the reveal alone re-evaluates entry');
      } finally {
        await context.close();
      }
    });
  }

  for (const scenario of ['yt-player-updated', 'yt-page-data-updated', 'focus', 'fullscreen', 'transition', 'miniplayer', 'observe retry', 'observe player'] as const) {
    it(`YouTube auto entry in ${engine} re-evaluates ${scenario} without another playing event`, { timeout: 60_000 }, async t => {
      const context = await shared.newContext(t);
      try {
        const page = await context.newPage();
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
            serviceEnabled: () => true,
            enabled: () => true, policyAllowed: () => true, providerFlags: () => flags,
            editableFocused: () => {
              probe.focusChecks = (probe.focusChecks ?? 0) + 1;
              return document.activeElement instanceof HTMLInputElement;
            },
            theaterActive: () => probe.active, transitioning: () => probe.transitioning,
            findBestVideo: () => document.querySelector('video'),
            enter: () => { probe.entries++; probe.active = true; },
            showNotice: () => () => {}, minNoticeMs: 0
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
        await context.close();
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
      const context = await shared.newContext(t);
      try {
        const page = await context.newPage();
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
            serviceEnabled: () => true,
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
        await context.close();
      }
    });
  }
}
