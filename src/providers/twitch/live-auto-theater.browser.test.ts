import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { it } from 'node:test';

import { chromium, firefox } from 'playwright';

import expandedJson from '../../../test/host-fixtures/twitch-chat-expanded.json';
import { parseHostFixture } from '../../../tools/host-fixtures/format';
import { RECIPES } from '../../../tools/host-fixtures/recipes';
import { fixtureDocument } from '../../../tools/host-fixtures/render';
import { readPageSignature } from '../../../tools/host-fixtures/test-utils/page-eval';
import { defaultMediaProviderFlags } from '../../media-features/provider-flags';
import { PROVIDER_ENTRIES, bundleModules } from '../../test-utils/player-boot';
import { sharedTestBrowser } from '../../test-utils/test-browser';
import { selectTestEngines } from '../../test-utils/test-engines';
import type { AutoTheaterRuntime, createAutoTheaterRuntime } from '../../ui/auto-theater-runtime';

import { TWITCH_NAVIGATE_EVENT } from './navigation';

// Fixture evidence: the live channel page recorded from twitch.tv (test/host-fixtures), whose player is
// `.persistent-player > … > .video-player > .video-ref > video`. The recording keeps no React state, so
// the media player instance sits on the video-ref's fiber, 30 levels up as measured on twitch.tv
// (2026-11), with the methods the provider reads. Real-host checks establish that Twitch still has both.
const fixture = parseHostFixture(expandedJson);
const BUNDLE = bundleModules([...PROVIDER_ENTRIES,
  "export { createAutoTheaterRuntime } from './ui/auto-theater-runtime'; export { installWatchPlaybackQueries } from './providers/watch-playback';"], 'TwitchLiveTest');
const MEDIA = `data:video/webm;base64,${readFileSync(new URL('../../../test/fixtures/vod.webm', import.meta.url)).toString('base64')}`;

type Player = { login?: string; broadcast?: string; state: string; duration: number };
declare global {
  interface Window {
    TwitchLiveTest: {
      createAutoTheaterRuntime: typeof createAutoTheaterRuntime;
      installWatchPlaybackQueries(): void;
    };
    twitchPlayer: Player;
    liveProbe: { entries: number; active: boolean; shown: number; hidden: number };
    liveRuntime: AutoTheaterRuntime;
  }
}

for (const engine of selectTestEngines([chromium, firefox], engine => engine.name())) {
  const shared = sharedTestBrowser(engine);
  it(`${engine.name()}: AutoTheater enters a live Twitch channel once per channel and broadcast`, { timeout: 60_000 }, async t => {
    if (!existsSync(engine.executablePath())) { t.skip('Browser not installed'); return; }
    const context = await shared.newContext(t, { viewport: fixture.viewport });
    const page = await context.newPage();
    await page.addInitScript('window.__name = target => target;');
    await page.route('https://www.twitch.tv/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixtureDocument(fixture) }));
    await page.goto('https://www.twitch.tv/somechannel');
    // The rendered fragment must reproduce what was recorded, or the assertions below prove nothing.
    assert.deepEqual(await readPageSignature(page, RECIPES[fixture.id].probes), fixture.signature);
    await page.evaluate(media => {
      const video = document.querySelector('video')!;
      const player: Player = { login: 'somechannel', broadcast: '1001', state: 'Playing', duration: Infinity };
      window.twitchPlayer = player;
      // A live stream reports an infinite duration; the fixture media is a short clip.
      Object.defineProperty(video, 'duration', { get: () => window.twitchPlayer.duration, configurable: true });
      const instance = {
        getHTMLVideoElement: () => video,
        getLoadedChannelLogin: () => window.twitchPlayer.login,
        getState: () => window.twitchPlayer.state,
        getSessionData: () => ({ 'BROADCAST-ID': window.twitchPlayer.broadcast })
      };
      let fiber: object = { memoizedProps: { mediaPlayerInstance: instance } };
      for (let depth = 0; depth < 30; depth += 1) fiber = { return: fiber, memoizedProps: {} };
      Object.assign(document.querySelector('[data-a-target="video-ref"]')!, { '__reactFiber$fixture': fiber });
      video.muted = true;
      video.loop = true;
      video.src = media;
    }, MEDIA);
    await page.waitForFunction(() => document.querySelector('video')!.readyState > 2);
    await page.addScriptTag({ content: BUNDLE });
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 60_000)); // Time moves only through runFor.
    await page.evaluate(flags => {
      window.TwitchLiveTest.installWatchPlaybackQueries();
      const probe = { entries: 0, active: false, shown: 0, hidden: 0 };
      window.liveProbe = probe;
      window.liveRuntime = window.TwitchLiveTest.createAutoTheaterRuntime({
        visit: { current: { identity: null, entered: false } },
        serviceEnabled: () => true, enabled: () => true, policyAllowed: () => true, providerFlags: () => flags,
        editableFocused: () => false, theaterActive: () => probe.active, transitioning: () => false,
        findBestVideo: () => document.querySelector('video'),
        enter: () => { probe.entries++; probe.active = true; },
        showNotice: () => { probe.shown++; return () => { probe.hidden++; }; }, noticeDelayMs: 0
      });
    }, defaultMediaProviderFlags());
    const probe = () => page.evaluate(() => ({ ...window.liveProbe }));
    const player = (patch: Partial<Player>, event = 'playing') => page.evaluate(([patch, event]) => {
      Object.assign(window.twitchPlayer, patch);
      document.querySelector('video')!.dispatchEvent(new Event(event));
    }, [patch, event] as const);
    const navigate = (path: string) => page.evaluate(([path, event]) => {
      history.pushState({}, '', path);
      window.dispatchEvent(new Event(event));
    }, [path, TWITCH_NAVIGATE_EVENT] as const);
    const exit = () => page.evaluate(() => { window.liveProbe.active = false; window.liveRuntime.refresh(); });

    await page.locator('video').evaluate((video: HTMLVideoElement) => video.play());
    assert.deepEqual(await probe(), { entries: 0, active: false, shown: 1, hidden: 0 }, 'the notice comes first');
    await page.clock.runFor(5000);
    await player({});
    assert.equal((await probe()).entries, 1, 'enters after the notice');

    await exit();
    await player({}, 'pause');
    await player({});
    assert.deepEqual(await probe(), { entries: 1, active: false, shown: 1, hidden: 1 }, 'exiting does not reenter the same broadcast');

    // An ad break stitched into the stream never looks like a new broadcast.
    await page.evaluate(() => {
      const label = document.createElement('div');
      label.dataset.aTarget = 'video-ad-label';
      document.querySelector('.video-player')!.append(label);
    });
    await player({ broadcast: '9999' });
    await page.evaluate(() => document.querySelector('[data-a-target="video-ad-label"]')!.remove());
    await player({ broadcast: '1001' });
    assert.deepEqual(await probe(), { entries: 1, active: false, shown: 1, hidden: 1 }, 'ads keep the visit');

    // The channel goes offline and live again on the same page: a new broadcast is a new visit.
    await player({ state: 'Idle', broadcast: undefined, duration: Number.NaN }, 'emptied');
    await player({ state: 'Playing', broadcast: '1002', duration: Infinity });
    assert.equal((await probe()).shown, 2, 'the next broadcast announces again');
    await page.clock.runFor(5000);
    await player({});
    assert.equal((await probe()).entries, 2);
    await exit();

    // SPA navigation to another channel: the previous channel's stream keeps playing on the same element.
    await navigate('/otherchannel?sr=a');
    await player({});
    await page.clock.runFor(10_000);
    await player({});
    assert.deepEqual(await probe(), { entries: 2, active: false, shown: 2, hidden: 2 }, "the previous channel's stream never qualifies");
    // Twitch's player loads the new channel: the countdown starts while it buffers, entry waits for the stream.
    await player({ login: 'otherchannel', broadcast: undefined, state: 'Buffering', duration: Number.NaN }, 'loadstart');
    assert.equal((await probe()).shown, 3);
    await page.clock.runFor(5000);
    assert.equal((await probe()).entries, 2, 'a stream with no duration yet does not enter');
    await player({ broadcast: '2001', state: 'Playing', duration: Infinity });
    assert.equal((await probe()).entries, 3, 'enters once the new channel plays');
    await exit();

    // A channel switch while the notice counts down drops it; the stale stream never enters.
    await navigate('/thirdchannel');
    await player({ login: 'thirdchannel', broadcast: '3001' });
    assert.equal((await probe()).shown, 4);
    await page.clock.runFor(2000);
    await navigate('/fourthchannel');
    assert.equal((await probe()).hidden, 4, 'the notice closes at once');
    await page.clock.runFor(10_000);
    await player({});
    assert.equal((await probe()).entries, 3);

    // An offline channel's page autoplays a past broadcast: finite, and the player names no channel.
    await navigate('/offlinechannel');
    await player({ login: undefined, broadcast: undefined, duration: 9000 }, 'loadstart');
    await player({});
    await page.clock.runFor(10_000);
    await player({});
    // Twitch's own routes never qualify, whatever plays there.
    await navigate('/directory');
    await player({ login: 'directory', duration: Infinity });
    await page.clock.runFor(10_000);
    assert.deepEqual(await probe(), { entries: 3, active: false, shown: 4, hidden: 4 });

    // A mature stream plays muted behind Twitch's content classification gate until the viewer accepts it.
    // Accepting fires no media event; the gate's removal alone starts the notice.
    await page.evaluate(() => {
      const gate = document.createElement('div');
      gate.dataset.aTarget = 'content-classification-gate-overlay';
      document.querySelector('.video-player')!.append(gate);
    });
    await navigate('/gatedchannel');
    await player({ login: 'gatedchannel', broadcast: '4001', duration: Infinity });
    await page.clock.runFor(10_000);
    await player({});
    assert.deepEqual(await probe(), { entries: 3, active: false, shown: 4, hidden: 4 }, 'nothing over the gate');
    await page.evaluate(() => document.querySelector('[data-a-target="content-classification-gate-overlay"]')!.remove());
    await page.waitForFunction(() => window.liveProbe.shown === 5);
    await page.clock.runFor(5000);
    assert.equal((await probe()).entries, 4, 'enters after the notice once the gate is accepted');
    await page.evaluate(() => window.liveRuntime.dispose());
  });
}
