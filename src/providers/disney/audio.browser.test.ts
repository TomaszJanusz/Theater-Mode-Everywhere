import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import type { Page } from 'playwright';

import { sharedEngineBrowsers } from '../../test-utils/engine-browsers';
import { bootPlayer, bundleModules, bundlePlayer, enterTheater } from '../../test-utils/player-boot';
import { testEngines } from '../../test-utils/test-engines';
import { vodVideoFixture } from '../../test-utils/video-fixtures';

const browsers = sharedEngineBrowsers();
const PLAY = '86e14fdb-3841-4282-ad38-07c8c4aab4b6';
const NEXT = '180356b5-0596-4333-891f-e48c526a0803';
const START = Date.UTC(2026, 9, 30, 10);

const bundle = bundleModules([
  "export { DisneyAudioAdapter } from './providers/disney/audio-adapter';",
  "export { installDisneyAudio } from './providers/disney/audio-main';",
  "export { installDisneyMain } from './providers/disney/main';",
  "export { disneyTimeline } from './providers/disney/timeline';",
  "export { AudioTrackController } from './media-features/audio-tracks';"
], 'DisneyAudioTest');

/**
 * Hive as read on a logged-in Disney+ film: `mediaPlayer` and `stateStore` expandos on
 * `disney-web-player`, track objects with an English `name` and the endonym in `displayName.title`,
 * audio description as separate tracks, `setTrack` debounced 800 ms (leading and trailing) and
 * returning nothing. A switch reloads the media about 1 s later (emptied, loadstart, the element's
 * `currentTime` restarting on a new timeline while Hive's playhead keeps the content position),
 * reports the track about 1.5 s after the call and resumes playback if Hive believes it is playing.
 * Its time advances only when the test steps it.
 */
const fakeHive = `(() => {
  const web = document.querySelector('disney-web-player');
  const video = web.querySelector('video.hive-video');
  const track = (id, name, language, title, describes = false) => ({ id, name, language, hasDescribesVideo: describes, hasDialogueEnhancement: false, isSelected: false, displayName: { title } });
  const all = [track(1, 'English', 'en', 'English'), track(14, 'Polish', 'pl', 'Polski'), track(7, 'Spanish', 'es-419', 'Español (Latinoamérica)'),
    track(21, 'English', 'en', 'English', true), track(30, 'German', 'de', 'Deutsch')];
  const hive = window.__hive = { tracks: [], selected: null, state: 'playing', paused: false, currentTime: 32, playheadMs: 32_000, sets: [], pauses: 0, reloads: 0, reloadAfter: 1_000, history: [], listeners: new Set(), timecodes: new Set(), all, step() {} };
  let storeState = { player: { extensions: { audio: { tracks: [] } } } };
  const dispatch = () => {
    storeState = { player: { extensions: { audio: { tracks: hive.tracks, selected: hive.selected && hive.selected.id } } } };
    for (const listener of [...hive.listeners]) listener();
  };
  const emit = name => video.dispatchEvent(new Event(name));
  const setPaused = paused => { if (hive.paused === paused) return; hive.paused = paused; emit(paused ? 'pause' : 'play'); if (!paused) emit('playing'); };
  Object.defineProperty(video, 'paused', { configurable: true, get: () => hive.paused });
  Object.defineProperty(video, 'currentTime', { configurable: true, get: () => hive.currentTime, set: value => { hive.currentTime = value; } });
  Object.defineProperty(video, 'readyState', { configurable: true, get: () => hive.reloading ? 0 : 4 });
  Object.defineProperty(video, 'played', { configurable: true, get: () => ({ length: hive.reloading ? 0 : 1 }) });
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1280 });
  // The theater pauses the element; Hive keeps believing it plays, as measured.
  video.pause = () => setPaused(true);
  video.play = () => { setPaused(false); return Promise.resolve(); };
  // Host time is stepped by the test (__hive.step() after advancing the page clock), not by timers of its own.
  const queue = [];
  const at = (due, run) => { queue.push({ due, run }); queue.sort((a, b) => a.due - b.due); };
  const apply = (selected, base) => {
    hive.sets.push(selected);
    const reloadAt = base + hive.reloadAfter;
    at(reloadAt, () => {
      hive.reloads += 1;
      hive.reloading = true;
      hive.currentTime = 0;
      emit('emptied');
      emit('loadstart');
    });
    at(reloadAt + 500, () => {
      hive.selected = selected;
      hive.history.push(selected.id);
      hive.currentTime = 20;
      hive.reloading = false;
      emit('loadedmetadata');
      dispatch();
      if (hive.state === 'playing') setPaused(false);
    });
  };
  let lastCall = -Infinity;
  let trailing = null;
  const setTrack = selected => {
    const now = performance.now();
    if (now - lastCall >= 800 && !trailing) apply(selected, now);
    else trailing = selected;
    lastCall = now;
  };
  let lastTick = performance.now();
  hive.step = () => {
    const now = performance.now();
    if (trailing && now - lastCall >= 800) { const next = trailing; trailing = null; apply(next, lastCall + 800); }
    while (queue.length && queue[0].due <= now) queue.shift().run();
    if (hive.paused || hive.reloading) { lastTick = now; return; }
    for (; lastTick + 250 <= now; lastTick += 250) {
      hive.playheadMs += 250;
      hive.currentTime += 0.25;
      for (const listener of hive.timecodes) listener();
    }
  };
  const audio = {
    // Hive's getters throw while its pipeline reattaches; failRead stands in for that.
    get availableTracks() { if (hive.failRead) throw new Error('reattaching'); return hive.tracks; },
    get selectedTrack() { return hive.selected; },
    get hasTracks() { return hive.tracks.length > 0; },
    setTrack
  };
  const player = {
    audio,
    seek(ms) { hive.playheadMs = ms; },
    play() { hive.state = 'playing'; setPaused(false); },
    pause() { hive.pauses += 1; hive.state = 'paused'; setPaused(true); },
    on(name, listener) { if (name === '@EVENT/PLAYER/TIMECODE') hive.timecodes.add(listener); },
    timeline: { info: { get playheadPositionMs() { return hive.playheadMs; }, programDurationMs: 5_400_000 } }
  };
  web.mediaPlayer = player;
  // Disney names its content video on the player element, as on the host.
  web.mediaElement = video;
  web.stateStore = { getState: () => storeState, subscribe(listener) { hive.listeners.add(listener); return () => hive.listeners.delete(listener); } };
  // The legacy clock finds the player on the element, as it does through React props.
  video.mediaPlayer = player;
  window.__setTracks = (count = all.length) => { hive.tracks = all.slice(0, count); hive.selected = hive.tracks[0] || null; dispatch(); };
})()`;

const html = '<!doctype html><body><disney-web-player><video class="hive-video" style="width:640px;height:360px"></video></disney-web-player></body>';

type Listed = { mediaId: string | null; blocked: boolean; bindingId?: string; tracks: Array<{ id: string; languageTag: string; label: string; kind: string; selected: boolean }> } | null;

async function open(test: TestContext, engine: 'chromium' | 'firefox'): Promise<Page> {
  const page = await (await browsers[engine].newContext(test)).newPage();
  // Installed time still flows; it is held below, once the page is set up, so every step is explicit.
  await page.clock.install({ time: START });
  await page.route('https://www.disneyplus.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await page.goto(`https://www.disneyplus.com/pl-pl/play/${PLAY}`);
  await page.addScriptTag({ content: `globalThis.__name = fn => fn;\n${bundle}\nwindow.DisneyAudioTest = DisneyAudioTest;` });
  await page.evaluate(fakeHive);
  await page.evaluate(`DisneyAudioTest.installDisneyMain();
    DisneyAudioTest.installDisneyAudio();
    window.video = document.querySelector('video');
    window.adapter = new DisneyAudioTest.DisneyAudioAdapter(video);
    window.results = [];
    window.changes = 0;
    window.controller = new DisneyAudioTest.AudioTrackController({
      preference: () => null, locales: () => ['en'], onChange() { window.changes += 1; },
      onResult(result) { window.results.push(result.playing && result.playing.track.id); }
    });
    controller.bind(adapter);`);
  await page.clock.pauseAt(START + 5_000);
  return page;
}

const list = (page: Page): Promise<Listed> => page.evaluate('adapter.listAudioTracks()');
const offered = (page: Page): Promise<string[]> => page.evaluate('controller.tracks().map(track => track.id)');
const hive = <T>(page: Page, expression: string): Promise<T> => page.evaluate(`(() => { const hive = window.__hive; return ${expression}; })()`);
const clock = (page: Page): Promise<number | null> => page.evaluate('DisneyAudioTest.disneyTimeline.readClock(video)');
/** Advances the page clock in 100 ms steps, letting the host react after each, as its own timers would. */
async function advance(page: Page, ms: number): Promise<void> {
  for (let left = ms; left > 0; left -= 100) {
    await page.clock.runFor(Math.min(100, left));
    await page.evaluate('window.__hive.step()');
  }
  if (ms === 0) await page.clock.runFor(0);
}

describe('Disney+ audio tracks', () => {
  for (const engine of testEngines()) {
    it(`lists tracks once Hive sets them, through the store subscription, in ${engine}`, async t => {
      const page = await open(t, engine);
      assert.deepEqual(await list(page), { mediaId: PLAY, blocked: false, tracks: [], bindingId: '1' }, 'Hive has not set its tracks yet');
      assert.deepEqual(await offered(page), []);
      assert.equal(await hive(page, 'hive.listeners.size'), 1, 'the controller holds one lease');
      const before = await page.evaluate<number>('window.changes');
      await page.evaluate('window.__setTracks(1)');
      assert.ok(await page.evaluate<number>('window.changes') > before, 'the store notification reaches the controller');
      assert.deepEqual(await offered(page), ['1'], 'a single track is still listed; the menu hides its row');
      await page.evaluate('window.__setTracks()');
      assert.deepEqual((await list(page))?.tracks, [
        { id: '1', languageTag: 'en', label: 'English', kind: 'unknown', selected: true },
        { id: '14', languageTag: 'pl', label: 'Polski', kind: 'unknown', selected: false },
        { id: '7', languageTag: 'es-419', label: 'Español (Latinoamérica)', kind: 'unknown', selected: false },
        { id: '21', languageTag: 'en', label: '', kind: 'description', selected: false },
        { id: '30', languageTag: 'de', label: 'Deutsch', kind: 'unknown', selected: false }
      ]);
    });

    it(`confirms by the reload and keeps the pause after Disney rewrites the video's classes, in ${engine}`, async t => {
      const page = await open(t, engine);
      await page.evaluate('window.__setTracks()');
      await advance(page, 500);
      // disney-web-player.mediaElementUiChanged, as read on the host: hive-video gives way to the btm and styler classes.
      await page.evaluate("video.className = 'btm-media-client-element fontDefault windowOpacity0'; video.pause()");
      await page.evaluate("window.picked = null; controller.select('14').then(ok => { window.picked = ok; }); void 0");
      await advance(page, 2_100);
      assert.equal(await page.evaluate('window.picked'), true, 'confirmed when the reload ends, not at the 8 s deadline');
      assert.equal(await page.evaluate('video.paused'), true, 'the reload\'s resume was paused again');
      assert.deepEqual(await hive(page, '[hive.pauses, hive.state]'), [1, 'paused']);
    });

    it(`survives the media reload: confirmed by Hive, clock on Hive's playhead, the viewer's pause kept, in ${engine}`, async t => {
      const page = await open(t, engine);
      await page.evaluate('window.__setTracks()');
      await advance(page, 1_000);
      const playing = await clock(page);
      assert.ok(playing !== null && playing >= 32.5, `the legacy clock follows Hive (${playing})`);
      // The viewer pauses in theater: the element stops, Hive still believes it plays.
      await page.evaluate('video.pause()');
      await page.evaluate("window.pick = controller.select('14'); window.picked = null; pick.then(ok => { window.picked = ok; }); void 0");
      await advance(page, 1_100);
      assert.equal(await hive(page, 'hive.reloading'), true, 'the reload is under way');
      assert.equal(await page.evaluate('video.currentTime'), 0, 'the element restarts its timeline');
      assert.equal(await clock(page), playing, 'the content position stays on Hive\'s playhead');
      assert.equal(await page.evaluate('window.picked'), null, 'not confirmed while Hive reloads');
      await advance(page, 1_000);
      assert.equal(await page.evaluate('window.picked'), true);
      assert.deepEqual(await page.evaluate('window.results'), ['14']);
      assert.equal(await hive(page, 'hive.sets.length === 1 && hive.sets[0] === hive.all[1]'), true, 'the live track object went to setTrack');
      assert.equal(await page.evaluate('video.currentTime'), 20, 'a new MSE timeline');
      assert.equal(await page.evaluate('video.paused'), true, 'the reload\'s own resume was paused again');
      assert.deepEqual(await hive(page, '[hive.pauses, hive.state]'), [1, 'paused']);
      assert.equal(await clock(page), playing, 'no position taken from the new element timeline');
      // The clock is bound again after the reload: playback moves it on from the same position.
      await page.evaluate('video.play()');
      await page.evaluate("window.__hive.state = 'playing'");
      await advance(page, 1_000);
      const resumed = await clock(page);
      assert.ok(resumed !== null && resumed > playing! && resumed < playing! + 2, `continues from ${playing}, got ${resumed}`);
    });

    it(`lets the last of fast picks win without a refusal in between, in ${engine}`, async t => {
      const page = await open(t, engine);
      await page.evaluate('window.__setTracks()');
      await page.evaluate("window.first = null; window.second = null; controller.select('14').then(ok => { window.first = ok; }); void 0");
      await advance(page, 300);
      await page.evaluate("controller.select('7').then(ok => { window.second = ok; }); void 0");
      await advance(page, 100);
      assert.equal(await page.evaluate('window.first'), false, 'the replaced pick settles at once');
      await advance(page, 4_000);
      assert.equal(await page.evaluate('window.second'), true);
      assert.deepEqual(await hive(page, 'hive.sets.map(track => track.id)'), [14, 7], 'Hive\'s trailing call carries the newest pick');
      assert.equal(await hive(page, 'hive.selected.id'), 7);
      assert.deepEqual(await page.evaluate('window.results'), ['7'], 'only the newest pick is announced');
      assert.equal((await list(page))?.tracks.find(track => track.selected)?.id, '7');
    });

    it(`does not acknowledge a pick before the reload Hive owes an earlier one has played, in ${engine}`, async t => {
      const page = await open(t, engine);
      await page.evaluate('window.__setTracks(); window.__hive.reloadAfter = 1_200');
      await page.evaluate("controller.select('14'); void 0");
      await advance(page, 100);
      await page.evaluate("window.picked = null; controller.select('1').then(ok => { window.picked = ok; window.seenBefore = window.__hive.history.slice(); }); void 0");
      await advance(page, 1_100);
      assert.equal(await page.evaluate('window.picked'), null, 'English still shows, but Polish has not played yet');
      await advance(page, 3_000);
      assert.equal(await page.evaluate('window.picked'), true);
      assert.deepEqual(await page.evaluate('window.seenBefore'), [14, 1], 'acknowledged only after Hive reported English again');
      assert.deepEqual(await page.evaluate('window.results'), ['1']);
    });

    it(`keeps a Pause pressed during a switch started from playback, in ${engine}`, async t => {
      const page = await open(t, engine);
      await page.evaluate('window.__setTracks()');
      await advance(page, 300);
      assert.equal(await page.evaluate('video.paused'), false);
      await page.evaluate("window.picked = null; controller.select('14').then(ok => { window.picked = ok; }); void 0");
      await advance(page, 300);
      // The theater's Pause: the resume-cancel request, then the element pause; Hive keeps believing it plays.
      await page.evaluate(`window.dispatchEvent(new CustomEvent('theater-everywhere-media-seek', { detail: JSON.stringify({ cancelPendingResume: true }) }));
        video.pause();`);
      await advance(page, 2_000);
      assert.equal(await page.evaluate('window.picked'), true);
      assert.equal(await page.evaluate('video.paused'), true, 'the reload\'s resume did not override the Pause');
      assert.deepEqual(await hive(page, '[hive.pauses, hive.state]'), [1, 'paused']);
    });

    it(`keeps the row stale through a transient read failure and recovers it, in ${engine}`, async t => {
      const page = await open(t, engine);
      await page.evaluate('window.__setTracks()');
      const ping = () => page.evaluate("window.dispatchEvent(new CustomEvent('theater-everywhere-disney-audio-change'))");
      await page.evaluate('window.__hive.failRead = true');
      await ping();
      const stale = await page.evaluate(() => {
        const { controller, adapter } = window as unknown as { controller: { tracks(): Array<{ disabled?: boolean; selected: boolean }> }; adapter: { listAudioTracks(): { stale?: boolean; blocked: boolean } | null } };
        const list = adapter.listAudioTracks();
        return { count: controller.tracks().length, disabled: controller.tracks().every(track => track.disabled && !track.selected), stale: list?.stale, blocked: list?.blocked };
      });
      assert.deepEqual(stale, { count: 5, disabled: true, stale: true, blocked: true }, 'the title keeps its tracks, not selectable');
      await page.evaluate("window.picked = null; controller.select('14').then(ok => { window.picked = ok; }); void 0");
      await advance(page, 0);
      assert.equal(await page.evaluate('window.picked'), false, 'a retained list cannot select');
      assert.equal(await hive(page, 'hive.sets.length'), 0);
      await advance(page, 200);
      assert.equal(await page.evaluate('controller.tracks().every(track => track.disabled)'), true, 'still degraded before the first retry');
      await page.evaluate('window.__hive.failRead = false');
      await advance(page, 300);
      assert.deepEqual(await page.evaluate('controller.tracks().map(track => [track.id, Boolean(track.disabled), track.selected])'),
        [['1', false, true], ['14', false, false], ['7', false, false], ['21', false, false], ['30', false, false]], 'the retry read it back');
      await page.evaluate("window.picked = null; controller.select('14').then(ok => { window.picked = ok; }); void 0");
      await advance(page, 2_000);
      assert.equal(await page.evaluate('window.picked'), true, 'selectable again after recovery');

      // A new title while degraded starts over: nothing retained describes it.
      await page.evaluate('window.__hive.failRead = true');
      await ping();
      await page.evaluate(`history.pushState({}, '', '/pl-pl/play/${NEXT}')`);
      await ping();
      assert.deepEqual(await offered(page), [], 'another title drops the retained list');
    });

    it(`drops pending work on exit, RTE-off and a new title without undoing Hive's switch, in ${engine}`, async t => {
      const exit = await open(t, engine);
      await exit.evaluate('window.__setTracks()');
      await exit.evaluate("video.pause(); window.picked = null; controller.select('14').then(ok => { window.picked = ok; }); void 0");
      await advance(exit, 100);
      await exit.evaluate('controller.dispose(); adapter.dispose(); adapter.dispose();');
      await advance(exit, 0);
      assert.equal(await exit.evaluate('window.picked'), false, 'exit settles the pending pick');
      assert.equal(await hive(exit, 'hive.listeners.size'), 0, 'the store subscription ended with the lease');
      await advance(exit, 3_000);
      assert.equal(await hive(exit, 'hive.selected.id'), 14, 'Hive finishes the viewer\'s switch');
      assert.equal(await hive(exit, 'hive.pauses'), 0, 'nothing is put back after exit');
      assert.deepEqual(await exit.evaluate('window.results'), []);

      const off = await open(t, engine);
      await off.evaluate('window.__setTracks()');
      await off.evaluate("window.picked = null; controller.select('14').then(ok => { window.picked = ok; }); void 0");
      await advance(off, 100);
      await off.evaluate("document.documentElement.setAttribute('data-te-disney-integration-off', '')");
      await advance(off, 3_000);
      assert.equal(await off.evaluate('window.picked'), false, 'RTE switched off mid-command');
      assert.equal(await list(off), null, 'MAIN stays silent with the integration off');

      const next = await open(t, engine);
      await next.evaluate('window.__setTracks()');
      await next.evaluate("window.picked = null; controller.select('14').then(ok => { window.picked = ok; }); void 0");
      await advance(next, 100);
      await next.evaluate(`history.pushState({}, '', '/pl-pl/play/${NEXT}')`);
      assert.equal(await list(next), null, 'the carried-over player does not describe the next title before its reload');
      await advance(next, 3_000);
      assert.equal(await next.evaluate('window.picked'), false, 'the late answer belongs to the previous title');
      assert.deepEqual(await next.evaluate('window.results'), []);
      assert.equal((await list(next))?.mediaId, NEXT, 'after a reload the player describes the page\'s title');
    });

    it(`rejects a forged answer that Hive's selection does not back, in ${engine}`, async t => {
      const page = await open(t, engine);
      await page.evaluate('window.__setTracks()');
      await page.evaluate(`window.addEventListener('theater-everywhere-disney-audio-select', event => {
        const { requestId } = JSON.parse(event.detail);
        window.dispatchEvent(new CustomEvent('theater-everywhere-disney-audio-result', { detail: JSON.stringify({ requestId, ok: true }) }));
      }, true);
      window.picked = null;
      adapter.selectAudioTrack('30', '${PLAY}').then(ok => { window.picked = ok; });
      void 0;`);
      await advance(page, 0);
      assert.equal(await page.evaluate('window.picked'), false);
    });
  }
});

type HiveProbe = { step(): void; selected: { id: number } };

/** The vod clip inside a `disney-web-player`, so the shipped runtime sees Disney's markup. */
const playerPage = vodVideoFixture({ title: 'Film', pageTitle: 'Film | Disney+' })
  .replace('<video id="player"', '<disney-web-player><video id="player" class="hive-video"').replace('</video>', '</video></disney-web-player>');

describe('Disney+ audio in the shipped player', () => {
  for (const engine of testEngines()) {
    it(`registers on Disney+, shows the row with two or more tracks, saves a language but not audio description, in ${engine}`, { timeout: 60_000 }, async t => {
      const page = await (await browsers[engine].newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      await page.route('https://www.disneyplus.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: playerPage }));
      await page.goto(`https://www.disneyplus.com/pl-pl/play/${PLAY}`);
      await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2);
      await page.evaluate(fakeHive);
      await page.evaluate('window.__hive.paused = true; window.__setTracks(1)');
      await bootPlayer(page, {
        mainWorld: true,
        bundle: bundlePlayer(["import './providers/disney/isolated';", "import './providers/disney/main-entry';"])
      });
      await enterTheater(page);
      const row = page.locator('.theater-settings-menu .audio-track-btn');
      const rows = page.locator('#theater-audio-track-list .theater-cc-menu-item');
      await page.locator('.player-settings-btn').click();
      await row.waitFor({ state: 'attached' });
      assert.equal(await row.isVisible(), false, 'one track: no row');
      await page.evaluate('window.__setTracks()');
      await row.waitFor();
      await row.click();
      assert.deepEqual(await rows.evaluateAll(items => items.map(item => item.textContent?.replace('✓', '').trim())),
        ['English', 'Polski', 'Español (Latinoamérica)', 'English (audio description)', 'Deutsch']);
      await rows.nth(1).click();
      await page.waitForFunction(() => { const { __hive } = window as unknown as { __hive: HiveProbe }; __hive.step(); return __hive.selected.id === 14; });
      const saved = () => page.evaluate(async () => (await chrome.storage.sync.get('audioPreferenceByHost')).audioPreferenceByHost);
      await page.waitForFunction(async () => Boolean((await chrome.storage.sync.get('audioPreferenceByHost')).audioPreferenceByHost));
      assert.deepEqual(await saved(), { 'disneyplus.com': 'pl' });
      assert.equal(await page.locator('.theater-controls-wrapper').count(), 1, 'the media reload did not end theater');
      assert.equal(await page.evaluate(() => document.querySelector('video')!.paused), true, 'the paused film stayed paused');

      await page.locator('.player-settings-btn').click();
      await row.click();
      await rows.nth(3).click();
      await page.waitForFunction(() => { const { __hive } = window as unknown as { __hive: HiveProbe }; __hive.step(); return __hive.selected.id === 21; });
      assert.deepEqual(await saved(), { 'disneyplus.com': 'pl' }, 'audio description is never saved');

      // A transient read failure keeps the row, disabled, and the retry brings it back.
      await page.evaluate(`window.__hive.failRead = true; window.dispatchEvent(new CustomEvent('theater-everywhere-disney-audio-change'))`);
      await page.locator('.player-settings-btn').click();
      await page.waitForFunction(() => {
        const button = document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector<HTMLButtonElement>('.audio-track-btn');
        return Boolean(button && !button.hidden && button.disabled);
      });
      await page.evaluate('window.__hive.failRead = false');
      await page.waitForFunction(() => {
        const button = document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector<HTMLButtonElement>('.audio-track-btn');
        return Boolean(button && !button.hidden && !button.disabled);
      });
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.locator('.theater-controls-wrapper').waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => (window as unknown as { __hive: { listeners: Set<unknown> } }).__hive.listeners.size), 0, 'exit releases the store subscription');
    });

    it(`keeps the subtitles on the dialogue after an audio switch once Disney rewrote the video's classes, in ${engine}`, { timeout: 60_000 }, async t => {
      const page = await (await browsers[engine].newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      const base = 'https://vod-akc-euwest1.media.dssott.com/ps01/';
      await page.route('https://www.disneyplus.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: playerPage }));
      // Disney's playback response names the HLS master; MAIN harvests it like any other.
      await page.route('https://disney.playback.edge.bamgrid.com/**', route => route.fulfill({
        contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ stream: { complete: { url: `${base}una-ctr-all-test.m3u8` } } })
      }));
      await page.route(`${base}**`, route => {
        const pathname = new URL(route.request().url()).pathname;
        const body = pathname.endsWith('una-ctr-all-test.m3u8')
          ? '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",FORCED=NO,URI="r/composite_en_NORMAL_test.m3u8"\n'
          : pathname.endsWith('composite_en_NORMAL_test.m3u8')
            ? '#EXTM3U\n' + Array.from({ length: 10 }, (_, index) => `#EXTINF:60,\ntext/${index}.vtt\n`).join('')
            : pathname.endsWith('/0.vtt')
              ? 'WEBVTT\n\n00:00:30.000 --> 00:00:40.000\nBefore the switch\n\n00:00:40.000 --> 00:01:00.000\nAfter the switch\n'
              : 'WEBVTT\n';
        return route.fulfill({ contentType: pathname.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'text/vtt', headers: { 'access-control-allow-origin': '*' }, body });
      });
      await page.goto(`https://www.disneyplus.com/pl-pl/play/${PLAY}`);
      await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2);
      await page.evaluate(fakeHive);
      await page.evaluate('window.__hive.playheadMs = 35_000; window.__setTracks()');
      await bootPlayer(page, {
        mainWorld: true,
        settings: { captionPreferenceByHost: { 'disneyplus.com': { enabled: true, language: 'en', autoGenerated: false } } },
        bundle: bundlePlayer(["import './providers/disney/isolated';", "import './providers/disney/main-entry';"])
      });
      await enterTheater(page);
      await page.evaluate(() => { void fetch('https://disney.playback.edge.bamgrid.com/v7/playback/ctr-regular', { method: 'POST' }); });
      const caption = (text: string) => page.waitForFunction(text => {
        const { __hive } = window as unknown as { __hive: HiveProbe };
        __hive.step();
        return document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-caption-overlay-text')?.textContent === text;
      }, text);
      await caption('Before the switch');
      // disney-web-player.mediaElementUiChanged, as read on the host: every class goes, the btm and styler classes come.
      await page.evaluate(() => { document.querySelector('video')!.className = 'btm-media-client-element fontDefault windowOpacity0'; });
      await page.locator('.player-settings-btn').click();
      await page.locator('.theater-settings-menu .audio-track-btn').click();
      await page.locator('#theater-audio-track-list .theater-cc-menu-item').nth(1).click();
      await caption('After the switch');
      assert.equal(await page.evaluate(() => (window as unknown as { __hive: HiveProbe }).__hive.selected.id), 14);
      const clock = Number(await page.evaluate(() => document.querySelector('video')!.dataset.teDisneyPlayhead));
      assert.ok(clock >= 40, `the theater clock follows Hive's playhead (${clock})`);
    });
  }
});
