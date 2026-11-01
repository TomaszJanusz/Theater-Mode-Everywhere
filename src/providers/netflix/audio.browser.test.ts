import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import type { Page } from 'playwright';

import type { AudioTrackList } from '../../media-features/types';
import { sharedEngineBrowsers } from '../../test-utils/engine-browsers';
import { bundleModules } from '../../test-utils/player-boot';
import { testEngines } from '../../test-utils/test-engines';

import { AUDIO_ACK, AUDIO_QUERY, AUDIO_SELECT, AUDIO_TIMEOUT } from './audio-bridge';
import { NETFLIX_HARVEST_EVENT } from './page';
import { netflixAudioHtml } from './test-utils/audio-fixture';

const bundle = bundleModules([
  "export { NetflixAdapter } from './providers/netflix/adapter';",
  "export { installNetflixAudio } from './providers/netflix/audio-main';",
  "export { navigationObserver } from './platform/navigation-visit';",
  "export { AudioTrackController } from './media-features/audio-tracks';"
], 'AudioTest');
const PL = 'A:2:1;2;pl;0;0;0;';
const AD = 'A:2:1;2;en;1;0;0;';
const EN = 'A:2:1;2;en;0;0;0;';
const FR = 'A:fr-CA';

async function open(t: TestContext, engine: 'chromium' | 'firefox', browsers: ReturnType<typeof sharedEngineBrowsers>, beforeObserve = ''): Promise<Page> {
  const page = await (await browsers[engine].newContext(t)).newPage();
  await page.route('https://www.netflix.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: netflixAudioHtml }));
  await page.goto('https://www.netflix.com/watch/12345');
  await page.addScriptTag({ content: `${bundle}\nwindow.AudioTest = AudioTest;` });
  if (beforeObserve) await page.evaluate(beforeObserve);
  await page.evaluate(`window.navigationCount = 0; const navigation = AudioTest.navigationObserver();
    window.stopMain = AudioTest.installNetflixAudio({ check: () => navigation.check(), subscribe(listener) {
      navigationCount++; const stop = navigation.subscribe(listener);
      return () => { navigationCount--; stop(); };
    } });
    window.adapter = new AudioTest.NetflixAdapter(document.querySelector('video'));
    window.changes = 0; window.observed = null;
    window.stopAudio = adapter.observeAudioTracks(() => { changes++; observed = adapter.listAudioTracks(); });`);
  return page;
}
const list = (page: Page): Promise<AudioTrackList | null> => page.evaluate('adapter.listAudioTracks()');
const sets = (page: Page): Promise<string[]> => page.evaluate('nf.sets');
const select = (page: Page, id = PL, mediaId = '12345'): Promise<boolean> => page.evaluate(`adapter.selectAudioTrack(${JSON.stringify(id)}, ${JSON.stringify(mediaId)})`);
const begin = (page: Page, id = PL) => page.evaluate(`window.outcome = 'pending'; window.command = adapter.selectAudioTrack(${JSON.stringify(id)}, '12345').then(ok => { outcome = ok; }); void 0;`);
const outcome = (page: Page) => page.evaluate('window.outcome');

// A single browser engine is selected per command on runner02, so heavyweight engines never overlap.
describe('Netflix audio recorded-shape fixtures', { timeout: 60_000 }, () => {
  const browsers = sharedEngineBrowsers();
  for (const engine of testEngines()) {
    it(`uses the matching session and exact current track objects in ${engine}`, async t => {
      const page = await open(t, engine, browsers);
      const tracks = (await list(page))!.tracks;
      assert.equal(tracks.length, 13);
      assert.equal(tracks.find(track => track.id === EN)?.kind, 'original');
      assert.equal(tracks.find(track => track.id === AD)?.kind, 'description');
      assert.equal(tracks.filter(track => track.languageTag === 'pl').length, 2, 'format variants are not merged');
      assert.equal(await page.evaluate(`nf.player.setAudioTrack({ ...nf.tracks[1] }).then(() => false, error => error.message === 'Invalid setAudioTrack call')`), true);
      assert.equal(await select(page), true);
      assert.deepEqual(await sets(page), [PL]);
      assert.equal((await list(page))!.tracks.find(track => track.selected)?.id, PL);
      assert.equal(await page.evaluate('nfSessions[0].sets.length'), 0, 'preloaded session untouched');
      assert.equal(await page.evaluate('changes > 0'), true);
    });

    for (const trigger of ['loadedmetadata', 'loadedtracks', 'audiotracklistchanged', NETFLIX_HARVEST_EVENT, 'navigation']) {
      it(`discovers a session missing at first bind through ${trigger} in ${engine}`, async t => {
        const page = await open(t, engine, browsers, 'window.savedNetflix = window.netflix; window.netflix = undefined;');
        assert.equal(await page.evaluate('nf.listenerCount()'), 0);
        assert.equal(await page.evaluate('navigationCount'), 1, 'discovery belongs to the unbound client already');
        await page.evaluate(`window.netflix = savedNetflix;
          if (${JSON.stringify(trigger)} === 'navigation') history.replaceState(null, '', location.href);
          else document.querySelector('video').dispatchEvent(new Event(${JSON.stringify(trigger)}, { bubbles: true }));`);
        await page.waitForFunction('observed?.tracks.length === 13');
        assert.equal(await page.evaluate('observed.blocked'), false);
        const changes = await page.evaluate<number>('changes');
        await page.evaluate('nf.emit("audiotracklistchanged")');
        assert.ok(await page.evaluate<number>('changes') > changes, 'discovery now follows Cadmium events');
        await page.evaluate('stopAudio(); stopAudio();');
        assert.equal(await page.evaluate('navigationCount'), 0);
        assert.equal(await page.evaluate('nf.listenerCount()'), 0);
      });
    }

    it(`releases unbound discovery and keeps a replacement client owned separately in ${engine}`, async t => {
      const missing = 'window.savedNetflix = window.netflix; window.netflix = undefined;';
      const page = await open(t, engine, browsers, missing);
      await page.evaluate('stopAudio(); stopAudio();');
      assert.equal(await page.evaluate('navigationCount'), 0, 'an unbound subscription is still disposed');
      await page.evaluate(`window.netflix = savedNetflix; document.querySelector('video').dispatchEvent(new Event('loadedmetadata'));`);
      assert.equal(await page.evaluate('changes'), 0);
      assert.equal(await page.evaluate('nf.listenerCount()'), 0);
      await page.evaluate(`window.netflix = undefined; window.stopOld = adapter.observeAudioTracks(() => { changes++; });
        window.replacement = new AudioTest.NetflixAdapter(document.querySelector('video'));
        window.stopReplacement = replacement.observeAudioTracks(() => { observed = replacement.listAudioTracks(); });
        stopOld(); window.netflix = savedNetflix; document.querySelector('video').dispatchEvent(new Event('loadedmetadata'));`);
      await page.waitForFunction('observed?.tracks.length === 13');
      assert.equal(await page.evaluate('navigationCount'), 1, 'old client cannot stop its replacement');
      await page.evaluate('stopReplacement(); replacement.dispose(); adapter.dispose(); stopMain(); stopMain();');
      assert.equal(await page.evaluate('navigationCount'), 0);
      assert.equal(await page.evaluate('nf.listenerCount()'), 0);
    });

    it(`waits for late manifest data and follows rebuilt/reordered lists without polling in ${engine}`, async t => {
      const page = await open(t, engine, browsers);
      await page.evaluate('nf.manifest = false; nf.emit("audiotracklistchanged")');
      assert.equal((await list(page))?.stale, true);
      assert.equal((await list(page))?.tracks.length, 13);
      await page.evaluate('nf.manifest = true; nf.emit("loadedtracks")');
      assert.equal((await list(page))!.tracks.length, 13);
      await page.evaluate(`nf.tracks = nf.tracks.map(track => ({ ...track })).reverse(); nf.current = nf.tracks.find(track => track.trackId === '${EN}'); nf.emit('audiotracklistchanged')`);
      assert.equal(await select(page), true, 'must resolve objects from the rebuilt list, not cached copies');
      const reads = await page.evaluate('nf.reads');
      await page.evaluate(`for (let i = 0; i < 20; i++) document.querySelector('video').dispatchEvent(new Event('timeupdate'));`);
      assert.equal(await page.evaluate('nf.reads'), reads, 'timeupdate does no audio discovery');
    });

    it(`confirms observed selection after the Promise and rejects refused or throwing setters in ${engine}`, async t => {
      const page = await open(t, engine, browsers);
      await page.clock.install();
      await page.evaluate(`nf.mode = 'delayed'`);
      await begin(page);
      assert.equal(await outcome(page), 'pending', 'resolved setter is not a successful selection');
      await page.evaluate(`nf.manifest = false; nf.emit('audiotracklistchanged')`);
      assert.equal(await outcome(page), 'pending', 'a manifest rebuild is not refusal');
      await page.evaluate(`nf.tracks = nf.tracks.map(track => ({ ...track })).reverse(); nf.manifest = true; nf.complete();`);
      await page.waitForFunction('outcome === true');
      await page.evaluate(`nf.mode = 'pending'`);
      await begin(page, FR);
      assert.equal(await outcome(page), 'pending');
      await page.evaluate('nf.choose(nf.tracks.find(track => track.trackId === "A:fr-CA"))');
      assert.equal(await outcome(page), 'pending', 'active getter alone cannot preempt a rejecting Promise');
      await page.evaluate('nf.resolve()');
      await page.waitForFunction('outcome === true');
      await page.evaluate(`nf.mode = 'refuse'`);
      await begin(page, EN);
      await page.clock.runFor(AUDIO_TIMEOUT + 10);
      assert.equal(await outcome(page), false, 'no observed active change times out');
      await page.evaluate(`nf.mode = 'throw'`);
      assert.equal(await select(page, EN), false);
    });

    it(`revalidates ad state, offered tracks, page, session and media identity in ${engine}`, async t => {
      const page = await open(t, engine, browsers);
      assert.equal(await select(page, PL, '999'), false);
      assert.equal(await select(page, 'missing'), false);
      await page.evaluate('nf.ad = true; nf.emit("adsstatechanged")');
      assert.equal((await list(page))!.blocked, true);
      assert.equal(await select(page), false);
      await page.evaluate('nf.ad = false; nf.movieId = "999"; nf.emit("loadedtracks")');
      assert.equal((await list(page))?.stale, true);
      assert.equal((await list(page))?.tracks.length, 13);
      assert.equal(await select(page), false);
      await page.evaluate('nf.movieId = "12345"; nf.element = document.createElement("video")');
      assert.equal((await list(page))?.stale, true, 'detached session retains disabled title knowledge');
      assert.deepEqual(await sets(page), []);
    });

    for (const invalidation of ['exit', 'rte', 'video', 'root', 'session', 'navigate', 'ad'] as const) {
      it(`drops pending work on ${invalidation} and never overwrites the next title in ${engine}`, async t => {
        const page = await open(t, engine, browsers);
        await page.evaluate(`nf.mode = 'pending'; window.old = nf; window.saves = []; window.reports = [];
          window.controller = new AudioTest.AudioTrackController({ preference: () => null, locales: () => ['en'], onChange() {}, onPreferenceChange: value => saves.push(value), onResult: value => reports.push(value) });
          stopAudio(); controller.bind(adapter); window.result = 'pending'; controller.select('${PL}').then(ok => { result = ok; }); void 0;`);
        await page.waitForFunction('old.sets.length === 1');
        const actions = {
          exit: 'controller.dispose(); adapter.dispose();',
          rte: `document.documentElement.setAttribute('data-te-netflix-integration-off', '');`,
          video: `const replacement = document.createElement('video'); nf.element.replaceWith(replacement); nf = nfCreate('12345', replacement);`,
          root: `document.querySelector('[data-uia="player"]').replaceWith(document.createElement('div'));`,
          session: `nf = nfCreate('12345', old.element); old.emit('loadedtracks');`,
          navigate: `history.pushState(null, '', '/watch/54321'); nf = nfCreate('54321', old.element);`,
          ad: `nf.ad = true; nf.emit('adsstatechanged');`
        };
        await page.evaluate(actions[invalidation]);
        await page.evaluate('old.complete()');
        await page.waitForFunction('result === false');
        assert.deepEqual(await page.evaluate('saves'), []);
        if (['ad', 'session'].includes(invalidation)) {
          assert.equal(await page.evaluate(`reports.every(report => report.refused?.track.id === '${PL}' && report.playing?.track.id !== '${PL}')`), true,
            'no stale success HUD; any refusal describes the current state');
        } else assert.deepEqual(await page.evaluate('reports'), [], 'no stale HUD');
        assert.equal(await page.evaluate('nf === old || nf.current.trackId === nf.tracks[0].trackId'), true, 'new title/session keeps its choice');
        await page.evaluate('controller.dispose(); adapter.dispose(); stopAudio(); stopAudio(); stopMain(); stopMain();');
        assert.equal(await page.evaluate('nfSessions.every(session => session.listenerCount() === 0)'), true, 'all player callbacks released');
        assert.equal(await page.locator('#theater-everywhere-netflix-audio').count(), 0);
      });
    }

    it(`rejects stale/malformed requests and late ACKs for a replaced binding in ${engine}`, async t => {
      const page = await open(t, engine, browsers);
      await page.evaluate(`window.lastQuery = null; window.lastSelect = null;
        window.addEventListener('${AUDIO_QUERY}', event => { lastQuery = JSON.parse(event.detail); });
        window.addEventListener('${AUDIO_SELECT}', event => { lastSelect = JSON.parse(event.detail); });
        adapter.listAudioTracks(); nf.mode = 'pending';`);
      await begin(page);
      await page.evaluate(`window.previousRequest = lastSelect; adapter.invalidate();
        window.dispatchEvent(new CustomEvent('${AUDIO_ACK}', { detail: JSON.stringify({ ...previousRequest, ok: true }) }));`);
      assert.equal(await outcome(page), false);
      assert.equal(await select(page, 'x', '12345'), false);
      await page.evaluate(`const video = document.querySelector('video');
        for (const raw of [lastSelect, '{', JSON.stringify({ ...previousRequest, requestId: 'replay', mediaId: '54321' }), JSON.stringify({ ...previousRequest, requestId: 'replay', pageHref: location.href + '?old' })]) {
          video.dispatchEvent(new CustomEvent('${AUDIO_SELECT}', { bubbles: true, detail: raw }));
        }`);
      assert.deepEqual(await sets(page), [PL]);
      await page.evaluate('old = nf; old.complete(); adapter.dispose(); stopMain();');
    });

    it(`auto-applies once per title, saves only confirmed ordinary/original choices, and leaves native choices alone in ${engine}`, async t => {
      const page = await open(t, engine, browsers);
      await page.evaluate(`window.preference = 'fr-CA'; window.saves = []; window.reports = [];
        window.controller = new AudioTest.AudioTrackController({ preference: () => preference, locales: () => ['en'], atVideoStart: () => true, onChange() {}, onPreferenceChange: value => saves.push(value), onResult: value => reports.push(value) });
        stopAudio(); controller.bind(adapter);`);
      await page.waitForFunction('reports.length === 1');
      assert.deepEqual(await sets(page), [FR]);
      await page.evaluate(`nf.manifest = false; nf.emit('audiotracklistchanged');`);
      assert.equal((await list(page))?.stale, true);
      assert.equal((await list(page))?.tracks.length, 13);
      await page.evaluate(`nf.manifest = true; nf.choose(nf.tracks[0]); nf.emit('loadedtracks'); nf.emit('busychanged'); nf.emit('timedtexttracklistchanged');`);
      assert.deepEqual(await sets(page), [FR], 'host choice remains after auto-apply');
      assert.equal(await page.evaluate(`controller.select('${AD}')`), true);
      assert.deepEqual(await page.evaluate('saves'), [], 'AD not saved');
      assert.equal(await page.evaluate(`controller.select('${EN}')`), true);
      assert.deepEqual(await page.evaluate('saves'), ['original']);
      await page.evaluate(`history.pushState(null, '', '/watch/54321'); nf.movieId = '54321'; nf.emit('loadedtracks');`);
      await page.waitForFunction('nf.sets.filter(id => id === "A:fr-CA").length === 2');
      await page.evaluate('controller.dispose(); adapter.dispose(); stopMain();');
    });

    it(`leaves the audio track alone when theater is entered mid-playback, and applies the saved one to the next title in ${engine}`, async t => {
      const page = await open(t, engine, browsers);
      await page.evaluate(`window.reports = [];
        window.controller = new AudioTest.AudioTrackController({ preference: () => 'fr-CA', locales: () => ['en'], atVideoStart: () => false, onChange() {}, onResult: value => reports.push(value) });
        stopAudio(); controller.bind(adapter);`);
      assert.equal(await page.evaluate('controller.tracks().length > 1'), true, 'the title already lists its tracks at entry');
      assert.deepEqual(await sets(page), [], 'the viewer\'s native choice is not overridden on entry');
      assert.deepEqual(await page.evaluate('reports'), []);
      await page.evaluate(`history.pushState(null, '', '/watch/54321'); nf.movieId = '54321'; nf.emit('loadedtracks');`);
      await page.waitForFunction('nf.sets.filter(id => id === "A:fr-CA").length === 1');
      await page.evaluate('controller.dispose(); adapter.dispose(); stopMain();');
    });
  }
});
