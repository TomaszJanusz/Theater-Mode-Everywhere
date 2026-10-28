import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it, type TestContext } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { bootPlayer, bundlePlayer, enterTheater } from '../../test-utils/player-boot';
import { sharedTestBrowser } from '../../test-utils/test-browser';
import { testEngines } from '../../test-utils/test-engines';
import { serveFixture } from '../../test-utils/video-fixtures';

const EPISODE = 'https://www.viki.com/videos/1263131v';
const VOD = readFileSync(new URL('../../../test/fixtures/vod.webm', import.meta.url)).toString('base64');
const SUBTITLE = (lang: string) => `https://api.viki.io/v4/videos/1263131v/subtitles/${lang}.vtt?app=100000a&stream_id=1&t=1&sig=fixture`;
const PREVIEW = 'https://manifest-viki.viki.io/v1/streams/1263131v/preview.vtt?region=ww';
const SHEET = 'https://vikiplatform.akamaized.net/1263131v/dash/preview/sheet_1.jpg';

const MODULES = [
  "export { VikiAdapter } from './media-features/viki-adapter';",
  "export { createVikiServiceActions } from './providers/viki/service-actions';",
  "export { vikiWatchPlayback } from './providers/viki/watch-playback';"
];
const bundle = bundlePlayer(MODULES);

/** `pageProps` as the server renders it into `__NEXT_DATA__`, reduced to what the integration reads. */
const NEXT_DATA = {
  props: { pageProps: { videoPlaybackStreamJson: {
    previewUrl: PREVIEW,
    queue: [{ type: 'main', closingMarker: 1953, skipMarkers: [{ label: 'skip_intro', labelText: 'Skip Intro', startTime: 127, endTime: 220 }] }],
    streamSubtitles: { dash: [
      { srclang: 'en', label: 'English', src: SUBTITLE('en') },
      { srclang: 'pl', label: 'Polski', src: SUBTITLE('pl') }
    ] },
    video: { id: '1263131v', duration: 2102, credits_marker: 1953, audio_languages: ['ko', 'en', 'es-419', 'pt-BR'], origin: { language: 'ko' } }
  } } }
};

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>Legend of the Female General - Episode 1 | Rakuten Viki</title>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(NEXT_DATA)}</script>
<style>body { margin: 0; } #vmplayer_id { position: relative; width: 960px; height: 540px; } video { width: 100%; height: 100%; }</style></head>
<body><div id="vmplayer_id" class="video-js"><video class="vjs-tech" muted playsinline src="data:video/webm;base64,${VOD}"></video>
<div class="vmp-audio-tracks"><div class="vmp-audio-tracks-menu"><ul id="audio-menu">
<li><svg data-testid="check-icon"></svg>English</li><li>Original - 한국어</li><li>Español (Latinoamérica)</li><li>Português (Brasil)</li></ul></div></div>
<button type="button" class="vmp-skip-base-button vmp-skip-button-positioned vjs-hidden" data-what="skip_intro_button">Skip Intro</button>
<button type="button" class="vmp-skip-base-button vmp-next-episode-button" data-what="next_episode_button" hidden>Next episode</button>
</div>
<script>
// Viki's menu moves the check mark to the clicked row, unless the host refuses (window.refuseAudio).
const menu = document.getElementById('audio-menu');
menu.addEventListener('click', event => {
  const row = event.target.closest('li');
  window.audioClicks = (window.audioClicks || 0) + 1;
  if (!row || window.refuseAudio) return;
  const mark = menu.querySelector('[data-testid="check-icon"]');
  row.prepend(mark);
});
</script></body></html>`;

async function open(page: Page): Promise<void> {
  // The files the page itself loads: served with the CORS header Viki's own API sends.
  const cors = { 'access-control-allow-origin': 'https://www.viki.com' };
  await page.route('https://api.viki.io/**', route => route.fulfill({ status: 200, headers: cors, contentType: 'text/vtt',
    body: `WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello from ${new URL(route.request().url()).pathname.split('/').pop()}\n` }));
  await page.route('https://manifest-viki.viki.io/**', route => route.fulfill({ status: 200, headers: cors, contentType: 'text/vtt',
    body: `WEBVTT\n\n00:00:00.000 --> 00:00:10.000\n${SHEET}#xywh=0,0,256,106\n\n00:00:10.000 --> 00:00:20.000\n${SHEET}#xywh=256,0,256,106\n` }));
  await serveFixture(page, FIXTURE, EPISODE);
  await bootPlayer(page, { mainWorld: true, bundle });
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return Boolean(video && video.readyState >= 2 && Number.isFinite(video.duration));
  });
}

/** Runs `body` with the bundled modules; one string keeps the browser side free of tsx helpers. */
const run = <T>(page: Page, body: string) => page.evaluate(`(async () => { const T = window.TheaterTest; ${body} })()`) as Promise<T>;

describe('Rakuten Viki playback data', () => {
  for (const engine of testEngines()) {
    const shared = sharedTestBrowser(({ chromium, firefox })[engine]);
    const newPage = async (t: TestContext) => {
      const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      await open(page);
      return page;
    };

    it(`lists the page's subtitle files, draws a chosen one and hands the host's cues back when off in ${engine}`, { timeout: 40_000 }, async t => {
      const page = await newPage(t);
      const result = await run<{ tracks: string[]; active: { status: string; text: string }; hidden: boolean; off: string; restored: boolean }>(page, `
        const adapter = new T.VikiAdapter();
        const tracks = (await adapter.listCaptionTracks()).map(track => track.id + ':' + track.label + ':' + track.source);
        const active = await adapter.activateCaptionTrack('viki:pl');
        const hidden = document.documentElement.hasAttribute('data-te-viki-captions-hidden');
        const off = (await adapter.activateCaptionTrack(null)).status;
        const restored = !document.documentElement.hasAttribute('data-te-viki-captions-hidden');
        const unknown = (await adapter.activateCaptionTrack('viki:xx')).status;
        adapter.dispose();
        return { tracks, active: { status: active.status, text: active.cues[0]?.text }, hidden, off, restored, unknown };`);
      assert.deepEqual(result.tracks, ['viki:en:English:viki', 'viki:pl:Polski:viki']);
      assert.deepEqual(result.active, { status: 'active', text: 'Hello from pl.vtt' });
      assert.equal(result.hidden, true, 'the host cues step aside while the extension draws');
      assert.equal(result.off, 'off');
      assert.equal(result.restored, true);
      assert.equal((result as unknown as { unknown: string }).unknown, 'failed');
    });

    it(`marks the intro and credits and serves timeline previews from the page's own lists in ${engine}`, { timeout: 40_000 }, async t => {
      const page = await newPage(t);
      const result = await run<{ chapters: unknown; source: string; frame: { x: number; y: number; sheetWidth: number } | null; id: string | null }>(page, `
        const adapter = new T.VikiAdapter();
        const chapters = await adapter.getChapters();
        const source = (await adapter.getPreviewSource()).kind;
        const frame = adapter.getPreviewFrame(12);
        return { chapters, source, frame: frame && { x: frame.image.x, y: frame.image.y, sheetWidth: frame.image.sheetWidth }, id: adapter.mediaId() };`);
      assert.deepEqual(result.chapters, [
        { start: 127, end: 220, title: 'Intro', source: 'viki', confidence: 'high' },
        { start: 1953, end: 2102, title: 'Credits', source: 'viki', confidence: 'high' }
      ]);
      assert.equal(result.source, 'sprite');
      assert.deepEqual(result.frame, { x: 256, y: 0, sheetWidth: 512 });
      assert.equal(result.id, '1263131v');
    });

    it(`drops everything once the page has moved to another episode in ${engine}`, { timeout: 40_000 }, async t => {
      const page = await newPage(t);
      const result = await run<{ before: number; after: number; id: string | null; frame: boolean; chapters: number }>(page, `
        const adapter = new T.VikiAdapter();
        const before = (await adapter.listCaptionTracks()).length;
        history.pushState(null, '', '/videos/1263132v');
        const after = (await adapter.listCaptionTracks()).length;
        return { before, after, id: adapter.mediaId(), frame: adapter.getPreviewFrame(5) !== null, chapters: (await adapter.getChapters()).length };`);
      assert.deepEqual(result, { before: 2, after: 0, id: null, frame: false, chapters: 0 });
    });

    it(`offers Skip Intro and Next episode only while Viki shows them, for the episode on screen in ${engine}`, { timeout: 40_000 }, async t => {
      const page = await newPage(t);
      const result = await run<Record<string, unknown>>(page, `
        const source = T.createVikiServiceActions();
        const pill = name => document.querySelector('[data-what="' + name + '"]');
        const idle = source.read().length;
        pill('skip_intro_button').classList.remove('vjs-hidden');
        const shown = source.read();
        pill('skip_intro_button').addEventListener('click', () => { window.skipped = (window.skipped || 0) + 1; });
        const activated = source.activate(shown[0].id);
        pill('skip_intro_button').classList.add('vjs-hidden');
        const stale = source.activate(shown[0].id);
        pill('next_episode_button').hidden = false;
        const next = source.read();
        history.pushState(null, '', '/videos/1263132v');
        const moved = source.read();
        const staleAfterNavigation = source.activate(next[0].id);
        return { idle, shown: shown.map(action => action.label), activated, skipped: window.skipped, stale, next: next.map(action => action.label),
          renamed: moved[0].id !== next[0].id, staleAfterNavigation };`);
      assert.deepEqual(result, { idle: 0, shown: ['Skip Intro'], activated: true, skipped: 1, stale: false, next: ['Next episode'], renamed: true, staleAfterNavigation: false });
    });

    it(`lists the menu's tracks and switches by clicking Viki's own row, after revalidating, in ${engine}`, { timeout: 40_000 }, async t => {
      const page = await newPage(t);
      await page.evaluate(`window.vikiAdapter = new window.TheaterTest.VikiAdapter(); window.vikiAdapter.probe();`);
      await page.waitForFunction(() => (window as unknown as { vikiAdapter: { listAudioTracks(): unknown } }).vikiAdapter.listAudioTracks() !== null);
      const listed = await run<{ tracks: Array<[string, string, boolean]>; media: string | null; blocked: boolean }>(page, `
        const list = window.vikiAdapter.listAudioTracks();
        return { tracks: list.tracks.map(track => [track.languageTag + ':' + track.kind, track.id, track.selected]), media: list.mediaId, blocked: list.blocked };`);
      assert.deepEqual(listed.tracks.map(track => track[0]), ['en:dub', 'ko:original', 'es-419:dub', 'pt-BR:dub']);
      assert.equal(listed.media, '1263131v');
      assert.equal(listed.blocked, false);
      const outcome = await run<{ accepted: boolean; selected: string[]; clicks: number }>(page, `
        const list = window.vikiAdapter.listAudioTracks();
        const accepted = await window.vikiAdapter.selectAudioTrack(list.tracks[2].id, list.mediaId);
        return { accepted, selected: window.vikiAdapter.listAudioTracks().tracks.filter(track => track.selected).map(track => track.languageTag), clicks: window.audioClicks };`);
      assert.deepEqual(outcome, { accepted: true, selected: ['es-419'], clicks: 1 });
    });

    it(`refuses to click when the episode moved on, an ad plays, the row is gone or the host declines in ${engine}`, { timeout: 40_000 }, async t => {
      const page = await newPage(t);
      await page.evaluate(`window.vikiAdapter = new window.TheaterTest.VikiAdapter(); window.vikiAdapter.probe();`);
      await page.waitForFunction(() => (window as unknown as { vikiAdapter: { listAudioTracks(): unknown } }).vikiAdapter.listAudioTracks() !== null);
      const result = await run<Record<string, unknown>>(page, `
        const adapter = window.vikiAdapter;
        const list = adapter.listAudioTracks();
        const ids = list.tracks.map(track => track.id);
        const player = document.getElementById('vmplayer_id');
        const outcome = {};
        outcome.otherEpisode = await adapter.selectAudioTrack(ids[2], '1263132v');
        outcome.noMedia = await adapter.selectAudioTrack(ids[2], null);
        player.classList.add('vjs-ad-playing');
        outcome.blockedFlag = adapter.listAudioTracks().blocked;
        outcome.duringAd = await adapter.selectAudioTrack(ids[2], list.mediaId);
        player.classList.remove('vjs-ad-playing');
        outcome.unknownRow = await adapter.selectAudioTrack('nothing', list.mediaId);
        document.querySelectorAll('#audio-menu li')[2].remove();
        outcome.removedRow = await adapter.selectAudioTrack(ids[2], list.mediaId);
        outcome.clicks = window.audioClicks || 0;
        return outcome;`);
      assert.deepEqual(result, { otherEpisode: false, noMedia: false, blockedFlag: true, duringAd: false, unknownRow: false, removedRow: false, clicks: 0 });
    });

    it(`reports false when Viki does not move the selection, and true without a click for the current track in ${engine}`, { timeout: 40_000 }, async t => {
      const page = await newPage(t);
      await page.clock.install();
      await page.evaluate(`window.vikiAdapter = new window.TheaterTest.VikiAdapter(); window.vikiAdapter.probe(); window.refuseAudio = true;`);
      await page.waitForFunction(() => (window as unknown as { vikiAdapter: { listAudioTracks(): unknown } }).vikiAdapter.listAudioTracks() !== null);
      await page.evaluate(`(() => { const list = window.vikiAdapter.listAudioTracks(); window.pick = window.vikiAdapter.selectAudioTrack(list.tracks[1].id, list.mediaId); })()`);
      await page.clock.runFor(2100);
      assert.equal(await page.evaluate('window.pick'), false);
      assert.equal(await page.evaluate('window.audioClicks'), 1);
      const current = await run<{ accepted: boolean; clicks: number }>(page, `
        const list = window.vikiAdapter.listAudioTracks();
        const accepted = await window.vikiAdapter.selectAudioTrack(list.tracks[0].id, list.mediaId);
        return { accepted, clicks: window.audioClicks };`);
      assert.deepEqual(current, { accepted: true, clicks: 1 });
    });

    it(`notifies only when the list, the selection or the ad state changes, and stops when released in ${engine}`, { timeout: 40_000 }, async t => {
      const page = await newPage(t);
      await page.clock.install();
      await page.evaluate(`(async () => { window.notified = 0; window.vikiAdapter = new window.TheaterTest.VikiAdapter(); await window.vikiAdapter.probe();
        window.stop = window.vikiAdapter.observeAudioTracks(() => { window.notified++; }); })()`);
      // The observer coalesces on animation frames, which the fake clock runs on demand.
      const settle = () => page.clock.runFor(100);
      await page.evaluate(() => { document.getElementById('vmplayer_id')!.append(document.createElement('span')); });
      await settle();
      assert.equal(await page.evaluate('window.notified'), 0, 'unrelated churn in the player');
      await page.evaluate(() => { document.getElementById('vmplayer_id')!.classList.add('vjs-ad-playing'); });
      await settle();
      assert.equal(await page.evaluate('window.notified'), 1, 'an ad starting');
      await page.evaluate(() => { document.getElementById('vmplayer_id')!.classList.remove('vjs-ad-playing'); });
      await settle();
      assert.equal(await page.evaluate('window.notified'), 2, 'the ad ending');
      await page.evaluate(() => { document.querySelectorAll<HTMLElement>('#audio-menu li')[1].click(); });
      await settle();
      assert.equal(await page.evaluate('window.notified'), 3, 'the selection moving');
      await page.evaluate(`window.stop(); window.stop();`);
      await page.evaluate(() => { document.getElementById('vmplayer_id')!.classList.add('vjs-ad-loading'); });
      await settle();
      assert.equal(await page.evaluate('window.notified'), 3, 'released observers stay silent');
    });

    it(`reports the list once the episode's data has arrived after the menu in ${engine}`, { timeout: 40_000 }, async t => {
      const page = await newPage(t);
      await page.evaluate(`window.notified = 0; window.vikiAdapter = new window.TheaterTest.VikiAdapter(); window.vikiAdapter.observeAudioTracks(() => { window.notified++; }); window.vikiAdapter.probe();`);
      await page.waitForFunction('window.notified === 1');
      assert.equal(await page.evaluate('window.vikiAdapter.listAudioTracks().tracks.length'), 4);
    });

    it(`opens the audio track list from a settings menu that hover opened in ${engine}`, { timeout: 40_000 }, async t => {
      const page = await newPage(t);
      await enterTheater(page);
      const state = () => page.evaluate(() => {
        const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
        return { open: root.querySelector('.theater-settings-container')!.classList.contains('is-open'),
          pinned: root.querySelector('.theater-settings-menu')!.classList.contains('visible'),
          list: !root.querySelector<HTMLElement>('.theater-settings-subview')!.hidden };
      });
      await page.locator('.player-settings-btn').hover();
      await page.locator('.audio-track-btn').click();
      // The list resizes the panel; pinned, the menu survives the pointer ending up outside it.
      assert.deepEqual(await state(), { open: true, pinned: true, list: true });
      await page.mouse.move(40, 40);
      assert.deepEqual(await state(), { open: true, pinned: true, list: true });
      await page.locator('.theater-settings-menu').getByText('Español (Latinoamérica)').waitFor();
    });

    it(`reaches Back in the audio track list from the keyboard once a saved choice adds the header's action, in ${engine}`, { timeout: 60_000 }, async t => {
      const page = await newPage(t);
      await enterTheater(page);
      const focused = () => page.evaluate(() => {
        const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
        const active = root.activeElement as HTMLElement | null;
        return { control: active ? [...active.classList].find(name => /back|reset|audio-track-btn|cc-menu-item/.test(name)) ?? active.className : null,
          list: !root.querySelector<HTMLElement>('.theater-settings-subview')!.hidden };
      });
      // Picking a track saves it, which shows Service default in the list's header, to the right of Back.
      await page.locator('.player-settings-btn').click();
      await page.locator('.audio-track-btn').click();
      await page.locator('.theater-settings-menu').getByText('Español (Latinoamérica)').click();
      await page.mouse.move(40, 40);
      await page.keyboard.press('w');
      for (let step = 0; step < 14 && (await focused()).control !== 'audio-track-btn'; step++) await page.keyboard.press('w');
      await page.keyboard.press('Enter');
      assert.deepEqual(await focused(), { control: 'theater-cc-menu-item', list: true });
      await page.keyboard.press('w');
      assert.deepEqual(await focused(), { control: 'theater-audio-track-reset', list: true }, 'up lands on the action most in line');
      await page.keyboard.press('a');
      assert.deepEqual(await focused(), { control: 'theater-cc-menu-back', list: true }, 'A crosses the header to Back');
      await page.keyboard.press('d');
      assert.deepEqual(await focused(), { control: 'theater-audio-track-reset', list: true }, 'D crosses back');
      await page.keyboard.press('a');
      await page.keyboard.press('Enter');
      assert.deepEqual(await focused(), { control: 'audio-track-btn', list: false }, 'Back returns to the settings rows');
    });

    it(`recognises the episode only while its manifest is the one the page loaded last in ${engine}`, { timeout: 40_000 }, async t => {
      const page = await newPage(t);
      // Playwright-fulfilled requests leave no resource timing, so the page's timeline is stood in for.
      await page.evaluate(() => {
        const requested: string[] = [];
        Object.assign(window, { requested });
        performance.getEntriesByType = ((type: string) => type === 'resource' ? requested.map(name => ({ name })) : []) as typeof performance.getEntriesByType;
      });
      const request = (id: string) => page.evaluate(url => { (window as unknown as { requested: string[] }).requested.push(url); }, `https://manifest-viki.viki.io/v1/${id}/akamai/main/mpd/vtt/manifest.mpd?h=1`);
      await request('1263131v');
      const read = (identity: string) => run<boolean>(page, `return T.vikiWatchPlayback.mainVideo(document, ${JSON.stringify(identity)}) === document.querySelector('video');`);
      assert.equal(await read('1263131v'), true);
      assert.equal(await read('1263132v'), false, 'another episode than the one loaded');
      await request('1263132v');
      assert.equal(await read('1263131v'), false, 'a newer manifest supersedes the old video');
      assert.equal(await read('1263132v'), true);
      await page.evaluate(() => document.body.append(document.createElement('video')));
      assert.equal(await read('1263132v'), false, 'a second video fails closed');
    });
  }
});
