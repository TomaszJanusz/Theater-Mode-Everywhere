import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import type { Page } from 'playwright';

import { sharedEngineBrowsers } from '../../test-utils/engine-browsers';
import { bundleModules } from '../../test-utils/player-boot';
import { testEngines } from '../../test-utils/test-engines';

const browsers = sharedEngineBrowsers();
const VIDEO = '0e3GPea1Tyg';
const NEXT = '9bqk6ZUsKyA';

const bundle = bundleModules([
  "export { YouTubeAdapter } from './media-features/youtube-adapter';",
  "export { AudioTrackController } from './media-features/audio-tracks';",
  "export { installYouTubeAudio } from './providers/youtube/audio-main';"
], 'AudioTest');

const html = `<!doctype html><body>
  <ytd-watch-flexy><div id="movie_player" class="html5-video-player"><video class="html5-main-video"></video></div></ytd-watch-flexy>
  <div id="shorts-player" class="html5-video-player"><video></video></div>
</body>`;

/**
 * The player API as measured on a dubbed watch page (player 6b2fce74): exported methods on
 * #movie_player, track objects whose toString() is the label, xtags in the id, and a string
 * event API. Ads keep the player element, and a selection made during one is discarded.
 */
const fixture = `(() => {
  const ids = {
    en: '251;ChEKBWFjb250EghvcmlnaW5hbAoICgNkcmMSATEKDQoEbGFuZxIFZW4tVVM',
    fr: '251;Cg8KBWFjb250EgZkdWJiZWQKCgoEbGFuZxICZnI',
    de: '251;Cg8KBWFjb250EgZkdWJiZWQKCgoEbGFuZxICZGU',
  };
  class Track {
    constructor(key, label, languageId) { this.id = ids[key]; this.label = label; this.languageId = languageId; }
    toString() { return this.label; }
    getLanguageInfo() { return { name: this.label, id: this.languageId, isDefault: this.languageId.endsWith('.4'), isAutoDubbed: false }; }
    isAutoDubbed() { return false; }
  }
  const tracks = [new Track('en', 'English (US) original', 'en-US.4'), new Track('fr', 'French', 'fr.3'), new Track('de', 'German', 'de.3')];
  const placeholder = { id: '', toString: () => 'Default', getLanguageInfo: () => ({ id: 'und' }) };
  const player = document.getElementById('movie_player');
  const listeners = {};
  window.__state = { videoId: '${VIDEO}', current: tracks[0], sets: [], listed: true };
  const emit = name => (listeners[name] || []).forEach(fn => fn());
  window.__emit = emit;
  const showingAd = () => player.classList.contains('ad-showing');
  player.addEventListener = (name, fn) => { if (typeof name === 'string' && typeof fn === 'function') (listeners[name] ||= []).push(fn); };
  player.getVideoData = () => ({ video_id: window.__state.videoId });
  // Measured both ways: during some ads the content's tracks stay listed, during others none and a placeholder.
  player.getAvailableAudioTracks = () => window.__state.listed && (!showingAd() || window.__state.adLists) ? tracks : [];
  player.getAudioTrack = () => showingAd() && !window.__state.adLists ? placeholder : window.__state.current;
  player.setAudioTrack = track => {
    window.__state.sets.push(String(track));
    if (!tracks.includes(track)) return false;
    if (!showingAd()) window.__state.current = track;
    emit('onPlaybackAudioChange');
    return true;
  };
  // The host putting its own remembered choice back, as on the next video or after an ad.
  window.__hostChoose = label => { window.__state.current = tracks.find(track => String(track) === label); emit('onPlaybackAudioChange'); };
})()`;

async function open(test: TestContext, engine: 'chromium' | 'firefox', path = `/watch?v=${VIDEO}`): Promise<Page> {
  const page = await (await browsers[engine].newContext(test)).newPage();
  await page.route('https://www.youtube.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await page.goto(`https://www.youtube.com${path}`);
  await page.addScriptTag({ content: `${bundle}\nwindow.AudioTest = AudioTest;` });
  await page.evaluate(fixture);
  await page.evaluate(`AudioTest.installYouTubeAudio();
    window.adapter = new AudioTest.YouTubeAdapter(document.querySelector('#movie_player video'));
    window.notifications = 0;
    window.stopObserving = adapter.observeAudioTracks(() => { window.notifications += 1; });`);
  return page;
}

type Listed = { mediaId: string | null; blocked: boolean; tracks: Array<{ id: string; languageTag: string; label: string; kind: string; selected: boolean }> } | null;
const list = (page: Page): Promise<Listed> => page.evaluate('adapter.listAudioTracks()');
const key = async (page: Page, label: string) => (await list(page))!.tracks.find(track => track.label === label)!.id;
const sets = (page: Page): Promise<string[]> => page.evaluate('window.__state.sets');

describe('YouTube audio tracks', () => {
  for (const engine of testEngines()) {
    it(`lists the player's tracks with tag, kind and selection, and selects through MAIN in ${engine}`, async t => {
      const page = await open(t, engine);
      assert.deepEqual(await list(page), {
        mediaId: VIDEO, blocked: false, tracks: [
          { id: 'ChEKBWFjb250EghvcmlnaW5hbAoICgNkcmMSATEKDQoEbGFuZxIFZW4tVVM', languageTag: 'en-US', label: 'English (US) original', kind: 'original', selected: true },
          { id: 'Cg8KBWFjb250EgZkdWJiZWQKCgoEbGFuZxICZnI', languageTag: 'fr', label: 'French', kind: 'dub', selected: false },
          { id: 'Cg8KBWFjb250EgZkdWJiZWQKCgoEbGFuZxICZGU', languageTag: 'de', label: 'German', kind: 'dub', selected: false }
        ]
      });
      const french = await key(page, 'French');
      assert.equal(await page.evaluate(`adapter.selectAudioTrack(${JSON.stringify(french)}, '${VIDEO}')`), true);
      assert.deepEqual(await sets(page), ['French']);
      assert.equal((await list(page))!.tracks.find(track => track.selected)?.label, 'French');
      assert.ok(await page.evaluate<number>('window.notifications') >= 1, 'the player event reaches the observer');
    });

    it(`revalidates identity, ads, the track and the integration before selecting in ${engine}`, async t => {
      const page = await open(t, engine);
      const german = await key(page, 'German');
      const select = (mediaId: string) => page.evaluate(`adapter.selectAudioTrack(${JSON.stringify(german)}, ${JSON.stringify(mediaId)})`);
      assert.equal(await select(NEXT), false, 'a request for an earlier video');
      assert.equal(await page.evaluate(`adapter.selectAudioTrack('not-offered', '${VIDEO}')`), false);
      await page.evaluate(`document.getElementById('movie_player').classList.add('ad-showing')`);
      assert.equal((await list(page))?.blocked, true);
      assert.equal(await select(VIDEO), false, 'never during an ad');
      await page.evaluate('window.__state.adLists = true');
      assert.equal((await list(page))?.blocked, true);
      assert.equal(await select(VIDEO), false, 'not even while the ad still lists the content tracks');
      await page.evaluate(`document.getElementById('movie_player').classList.remove('ad-showing')`);
      // The host moved on to the next video before the adapter's URL did.
      await page.evaluate(`window.__state.videoId = '${NEXT}'`);
      assert.equal(await list(page), null, 'player data for another video than the page names');
      assert.equal(await select(VIDEO), false);
      await page.evaluate(`window.__state.videoId = '${VIDEO}'; document.documentElement.setAttribute('data-te-youtube-integration-off', '')`);
      assert.equal(await list(page), null, 'MAIN stays silent with the integration off');
      assert.equal(await select(VIDEO), false);
      assert.deepEqual(await sets(page), []);
    });

    it(`ignores players other than the watch, miniplayer or embed player in ${engine}`, async t => {
      const page = await open(t, engine);
      assert.equal(await page.evaluate(`new AudioTest.YouTubeAdapter(document.querySelector('#shorts-player video')).listAudioTracks()`), null);
      assert.equal(await page.evaluate(`new AudioTest.YouTubeAdapter(null).listAudioTracks()`), null);
    });

    it(`reads an embed by its own route in ${engine}`, async t => {
      const page = await open(t, engine, `/embed/${VIDEO}`);
      await page.evaluate('window.__state.listed = false');
      assert.deepEqual((await list(page))?.tracks, [], 'embeds list no tracks before playback');
      await page.evaluate(`window.__state.listed = true; window.__emit('onStateChange')`);
      assert.equal((await list(page))?.tracks.length, 3);
    });

    it(`auto-applies once per video after ads, without fighting the host, in ${engine}`, async t => {
      const page = await open(t, engine);
      await page.evaluate(`document.getElementById('movie_player').classList.add('ad-showing');
        window.controller = new AudioTest.AudioTrackController({ preference: () => 'fr', locales: () => ['en'], atVideoStart: () => true, onChange() {} });
        controller.bind(adapter);`);
      assert.deepEqual(await sets(page), [], 'waits out the ad');
      // The ad ends with only a class flip, which the adapter observes.
      await page.evaluate(`document.getElementById('movie_player').classList.remove('ad-showing')`);
      await page.waitForFunction('window.__state.sets.length === 1');
      assert.deepEqual(await sets(page), ['French']);
      await page.evaluate(`window.__hostChoose('English (US) original')`);
      await page.evaluate(`window.__hostChoose('English (US) original')`);
      assert.deepEqual(await sets(page), ['French'], 'the host restoring its choice is left alone');

      // SPA navigation: the same player, a new video and URL.
      await page.evaluate(`history.pushState(null, '', '/watch?v=${NEXT}'); window.__state.videoId = '${NEXT}'; window.__emit('videodatachange')`);
      await page.waitForFunction('window.__state.sets.length === 2');
      assert.deepEqual(await sets(page), ['French', 'French']);
      await page.evaluate('controller.dispose(); stopObserving(); stopObserving();');
      await page.evaluate(`history.pushState(null, '', '/watch?v=${VIDEO}'); window.__state.videoId = '${VIDEO}'; window.__hostChoose('German')`);
      assert.deepEqual(await sets(page), ['French', 'French'], 'nothing runs after disposal');
    });

    it(`leaves the audio track alone when theater is entered mid-playback, and applies the saved one to the next video in ${engine}`, async t => {
      const page = await open(t, engine);
      await page.evaluate(`window.controller = new AudioTest.AudioTrackController({ preference: () => 'fr', locales: () => ['en'], atVideoStart: () => false, onChange() {} });
        controller.bind(adapter);`);
      assert.equal(await page.evaluate('controller.tracks().length > 1'), true, 'the video already lists its tracks at entry');
      assert.deepEqual(await sets(page), [], 'the viewer\'s native choice is not overridden on entry');
      await page.evaluate(`history.pushState(null, '', '/watch?v=${NEXT}'); window.__state.videoId = '${NEXT}'; window.__emit('videodatachange')`);
      await page.waitForFunction('window.__state.sets.length === 1');
      assert.deepEqual(await sets(page), ['French']);
      await page.evaluate('controller.dispose(); stopObserving();');
    });
  }
});
