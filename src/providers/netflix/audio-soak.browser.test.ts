import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sharedEngineBrowsers } from '../../test-utils/engine-browsers';
import { bundleModules } from '../../test-utils/player-boot';
import { testEngines } from '../../test-utils/test-engines';

import { netflixAudioHtml } from './test-utils/audio-fixture';

const bundle = bundleModules([
  "export { NetflixAudioAdapter } from './providers/netflix/audio-adapter';",
  "export { installNetflixAudio } from './providers/netflix/audio-main';",
  "export { navigationObserver } from './platform/navigation-visit';",
  "export { CompositeMediaAdapter } from './media-features/composite-adapter';",
  "export { AudioTrackController } from './media-features/audio-tracks';",
  "export { mountAudioTrackMenu } from './ui/audio-track-menu';",
  "export { createPlayerSettings } from './ui/player-settings';",
  "export { DisposableScope } from './core/disposable-scope';",
  "export { resolveFeatureHighlights } from './feature-highlights';"
], 'Soak');

// Injected recovery clock: assertions observe the UI, never call list() to cause recovery.
const setup = `window.now = 0; window.nextTimer = 0; window.tasks = new Map(); window.delays = []; window.peak = 0;
  window.clock = {
    setTimeout: (callback, ms) => { const id = ++nextTimer; tasks.set(id, { at: now + ms, callback }); delays.push(ms); peak = Math.max(peak, tasks.size); return id; },
    clearTimeout: id => { tasks.delete(id); }
  };
  window.advance = async ms => {
    const end = now + ms;
    while (true) {
      const next = [...tasks].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at; tasks.delete(next[0]); next[1].callback();
      await Promise.resolve(); await Promise.resolve();
    }
    now = end;
  };
  window.navCount = 0; const nav = Soak.navigationObserver();
  window.stopMain = Soak.installNetflixAudio({ check: () => nav.check(), subscribe(fn) {
    navCount++; const stop = nav.subscribe(fn); return () => { navCount--; stop(); };
  } });
  window.adapter = new Soak.NetflixAudioAdapter(document.querySelector('video'), clock);
  window.composite = new Soak.CompositeMediaAdapter([adapter]);
  window.scope = new Soak.DisposableScope();
  const noop = () => {}; const t = key => key;
  const highlights = Soak.resolveFeatureHighlights('2.1.0');
  window.settings = Soak.createPlayerSettings({ t, actions: { setIcon: noop, updateCaptionDock: noop, showToolbar: noop },
    paintOverlay: noop, ui: () => ({ featureHighlights: highlights, shortcuts: {} }), uiStore: { subscribe: () => noop } }, scope);
  document.body.append(settings.container);
  window.reports = []; window.saves = []; window.menu = null;
  window.controller = new Soak.AudioTrackController({ preference: () => null, locales: () => ['en'],
    onChange: () => menu?.update(), onResult: result => reports.push(result), onPreferenceChange: value => saves.push(value) });
  controller.bind(composite);
  window.menu = Soak.mountAudioTrackMenu({ settings, scope, t, locale: 'en', setIcon: noop,
    tracks: () => controller.tracks(), select: id => controller.select(id), preference: () => null, resetPreference: noop });
  window.state = () => ({ hidden: document.querySelector('.audio-track-btn').hidden,
    disabled: document.querySelector('.audio-track-btn').disabled, count: controller.tracks().length,
    timers: tasks.size, navigation: navCount });
  window.goodTracks = nf.tracks; window.goodList = nf.player.getAudioTrackList;
  window.goodCurrent = nf.player.getAudioTrack; window.goodAd = nf.player.getAdManager;
  window.originalLookup = netflix.appContext.state.playerApp.getAPI().videoPlayer.getVideoPlayerBySessionId;
  window.savedApi = netflix.appContext.state.playerApp.getAPI;
  window.restore = () => {
    nf.manifest = true; nf.tracks = goodTracks; nf.ad = false;
    nf.player.getAudioTrackList = goodList; nf.player.getAudioTrack = goodCurrent; nf.player.getAdManager = goodAd;
    netflix.appContext.state.playerApp.getAPI = savedApi;
  };
  window.cleanup = () => { controller.dispose(); composite.dispose(); scope.dispose(); stopMain(); };
`;

const faults = [
  'nf.manifest = false',
  'nf.player.getAudioTrack = () => { throw Error("selected unavailable"); }',
  'nf.tracks = []',
  'nf.tracks = goodTracks.slice(0, 1)',
  'nf.ad = true',
  'nf.player.getAdManager = () => undefined',
  'nf.player.getAdManager = () => ({ adPresenting: { get value() { throw Error("unknown"); } } })',
  'netflix.appContext.state.playerApp.getAPI = () => null',
  'nf.tracks = Array(101).fill(goodTracks[0])',
  'nf.tracks = [goodTracks[0], goodTracks[0]]',
  'nf.tracks = [{ ...goodTracks[0], displayName: "x".repeat(201) }]',
  // Valid individual fields, but >55K public-track JSON; no unbounded payload can replace knowledge.
  'nf.tracks = Array.from({ length: 100 }, (_, i) => ({ ...goodTracks[0], trackId: String(i) + "x".repeat(590), displayName: "x".repeat(200) }))'
];

// xorshift32 gives reproducible irregular intervals and ordering; seed is in every failure.
function random(seed: number): () => number {
  let state = seed;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
}

describe('Netflix title retention and self-healing soak', { timeout: 60_000 }, () => {
  const browsers = sharedEngineBrowsers();
  for (const engine of testEngines()) {
    for (const seed of [225, 70248290]) {
      it(`retains the row through seeded transient failures, seed ${seed}, ${engine}`, async t => {
        const page = await (await browsers[engine].newContext(t)).newPage();
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('https://www.netflix.com/**', route => route.fulfill({ contentType: 'text/html', body: netflixAudioHtml }));
        await page.goto('https://www.netflix.com/watch/12345');
        await page.addScriptTag({ content: bundle + '\nwindow.Soak = Soak;' });
        await page.evaluate(setup);
        const read = () => page.evaluate<{ hidden: boolean; disabled: boolean; count: number; timers: number; navigation: number }>('state()');
        assert.deepEqual(await read(), { hidden: false, disabled: false, count: 13, timers: 0, navigation: 1 });
        // Leave the real nested list open: both its rows and its trigger must disable.
        await page.evaluate(`document.querySelector('.audio-track-btn').click()`);
        await page.evaluate(`nf.manifest = false; nf.emit('loadedtracks');`);
        await page.evaluate('advance(8750)');
        assert.deepEqual(await page.evaluate('delays.slice(0, 6)'), [250, 500, 1000, 2000, 5000, 5000]);
        await page.evaluate('restore(); advance(5000)');
        const reads = await page.evaluate('nf.reads');
        await page.evaluate(`advance(50000); for (let i = 0; i < 100; i++) nf.element.dispatchEvent(new Event('timeupdate'));`);
        assert.equal(await page.evaluate('nf.reads'), reads, 'healthy state has no timer or timeupdate scan');
        const next = random(seed);
        for (let round = 0; round < 48; round++) {
          const fault = round < faults.length ? round : next() % faults.length;
          const emit = round % 2 === 0;
          const trace = `seed=${seed} round=${round} fault=${fault} recoveryEvent=${emit}`;
          await page.evaluate(`advance(${next() % 4000})`);
          await page.evaluate(`${faults[fault]}; nf.emit('busychanged');`);
          assert.deepEqual(await read(), { hidden: false, disabled: true, count: 13, timers: 1, navigation: 1 }, trace);
          assert.equal(await page.evaluate(`Array.from(document.querySelectorAll('#theater-audio-track-list button')).every(button => button.disabled)`), true, trace);
          assert.equal(await page.evaluate(`controller.select('A:2:1;2;pl;0;0;0;')`), false, trace);
          await page.evaluate(`advance(${next() % 13000})`);
          assert.equal((await read()).hidden, false, trace);
          await page.evaluate(`restore(); ${emit ? 'nf.element.dispatchEvent(new Event("loadedtracks"));' : ''}`);
          if (!emit) await page.evaluate('advance(5000)');
          assert.deepEqual(await read(), { hidden: false, disabled: false, count: 13, timers: 0, navigation: 1 }, trace);
          assert.equal(await page.evaluate('peak'), 1, trace);
          assert.deepEqual(await page.evaluate('nf.sets'), [], 'recovery never selects audio');
        }
        // Query/hash rewrites and fresh wrappers keep the same title and command identity.
        await page.evaluate(`history.replaceState(null, '', '?tracking=changed#menu');
          netflix.appContext.state.playerApp.getAPI = () => ({ videoPlayer: {
            getAllPlayerSessionIds: () => [nf.sessionId], getVideoPlayerBySessionId: () => ({ ...nf.player })
          } }); nf.emit('loadedtracks');`);
        assert.equal((await read()).hidden, false);
        assert.equal(await page.evaluate(`controller.select('A:2:1;2;pl;0;0;0;')`), true, 'fresh wrappers still confirm through stable session id');
        await page.evaluate('restore()');
        // Detach across a mutation delivery, then reconnect silently. Timer alone heals it.
        await page.evaluate('window.root = nf.element.parentElement; root.remove();');
        assert.equal((await read()).disabled, true);
        await page.evaluate('document.querySelector(".watch-video").append(root);');
        assert.equal((await read()).disabled, false);
        // Replace root AND video; the same client adopts only a MAIN-validated successor.
        await page.evaluate(`const replacement = root.cloneNode(true); root.replaceWith(replacement); nf.element = replacement.querySelector('video');`);
        assert.equal((await read()).disabled, false);
        // A second observing/non-observing reader cannot steal or stop the first owner.
        await page.evaluate(`window.second = new Soak.NetflixAudioAdapter(nf.element, clock); second.listAudioTracks(); second.dispose();
          second = new Soak.NetflixAudioAdapter(nf.element, clock); window.stopSecond = second.observeAudioTracks(() => {}); stopSecond(); second.dispose();
          nf.manifest = false; nf.emit('loadedtracks');`);
        assert.equal((await read()).timers, 1);
        await page.evaluate('restore(); advance(5000)');
        assert.equal((await read()).disabled, false);
        // Hidden tabs suspend recovery; visible resumes without requiring any host event.
        await page.evaluate(`window.tabHidden = false; Object.defineProperty(document, 'hidden', { configurable: true, get: () => tabHidden });
          nf.manifest = false; nf.emit('loadedtracks');`);
        await page.evaluate(`tabHidden = true; document.dispatchEvent(new Event('visibilitychange'));`);
        assert.equal((await read()).timers, 0);
        await page.evaluate('restore(); advance(20000)');
        assert.equal((await read()).disabled, true);
        await page.evaluate(`tabHidden = false; document.dispatchEvent(new Event('visibilitychange'));`);
        assert.equal((await read()).disabled, false);
        // BFCache suspends MAIN ownership, keeps title knowledge, and resumes on pageshow.
        await page.evaluate(`window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));`);
        assert.deepEqual(await read(), { hidden: false, disabled: true, count: 13, timers: 0, navigation: 0 });
        await page.evaluate(`window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));`);
        assert.equal((await read()).disabled, false);
        // A genuine new title cannot display the old list or consume a late old command.
        await page.evaluate(`nf.mode = 'pending'; window.old = nf; window.pending = controller.select('A:2:1;2;en;0;0;0;');
          history.pushState(null, '', '/watch/54321'); nf = nfCreate('54321', old.element); nf.manifest = false;`);
        assert.equal((await read()).hidden, true);
        await page.evaluate('old.complete();');
        assert.equal(await page.evaluate('pending'), false);
        assert.deepEqual(await page.evaluate('saves'), ['pl']);
        await page.evaluate('window.full = nf.tracks; nf.manifest = true; nf.tracks = full.slice(0, 1); nf.current = nf.tracks[0]; nf.emit("loadedtracks");');
        const single = await read();
        assert.deepEqual([single.hidden, single.timers], [true, 0], 'a title with one track is settled, not degraded');
        await page.evaluate('nf.tracks = full; nf.emit("loadedtracks");');
        assert.equal((await read()).hidden, false);
        await page.evaluate('nf.manifest = false; nf.emit("loadedtracks");');
        await page.evaluate(`document.documentElement.setAttribute('data-te-netflix-integration-off', '');`);
        assert.equal((await read()).hidden, true);
        assert.equal((await read()).timers, 0);
        assert.equal((await read()).navigation, 0);
        await page.evaluate('cleanup(); cleanup();');
        assert.deepEqual(await page.evaluate('[tasks.size, navCount, nfSessions.reduce((n, session) => n + session.listenerCount(), 0)]'), [0, 0, 0]);
        assert.deepEqual(errors, []);
      });
    }
  }
});
