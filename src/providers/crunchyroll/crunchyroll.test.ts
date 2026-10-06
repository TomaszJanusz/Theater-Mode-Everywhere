import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { preferProviderCaptionTracks } from '../../media-features/composite-adapter';
import { crunchyrollCdnFile } from '../../media-features/crunchyroll-cdn';
import { classifyMediaFetchUrl, isAllowedMediaFetchUrl } from '../../media-features/fetch-allowlist';
import {
  classifyCrunchyrollManifest,
  CRUNCHYROLL_CAPTION_ACK_EVENT,
  CRUNCHYROLL_CAPTION_EVENT,
  crunchyrollContentTitle,
  parseCrunchyrollCaptionBody,
  parseCrunchyrollCaptionAck,
  parseCrunchyrollCaptionRequest,
  parseCrunchyrollHostList,
  parseCrunchyrollPlayback,
  MAX_CRUNCHYROLL_BIF_BYTES,
  MAX_CRUNCHYROLL_OWNED_CAPTION_TRACKS,
  parseCrunchyrollSkipEvents,
  summarizeCrunchyrollBif
} from '../../media-features/parsers/crunchyroll';
import { serviceHomeUrl } from '../../platform/service-home';
import { createWorldMessage, type WorldEnvelope } from '../../protocol/world-messages';
import { isCrunchyrollHost } from '../hosts';
import { CrunchyrollAdapter, requestCrunchyrollHostCaption } from './adapter';
import { CRUNCHYROLL_HOST_CAPTION_CLASS, CRUNCHYROLL_HOST_CAPTION_SELECTOR } from './host-surface';
import {
  applyCrunchyrollHostCaption,
  captureCrunchyrollNetworkResponse,
  consumeCrunchyrollWrappedFetch,
  CRUNCHYROLL_CAPTION_ACK_TIMEOUT_MS,
  CRUNCHYROLL_HARVEST_EVENT,
  CRUNCHYROLL_HOST_CAPTION_SETTLE_MS,
  CRUNCHYROLL_SKIP_RETRY_MS,
  crunchyrollAllowsCaptionFetch,
  handleCrunchyrollCaptionEvent,
  harvestCrunchyrollData,
  loadCrunchyrollUrl,
  noteCrunchyrollManifest,
  readCrunchyrollSnapshot,
  rememberCrunchyrollBif
} from './main';

const MEDIA = 'GR7592K3Y';
const OTHER = 'G6X0J43PY';
const MODERN_MEDIA = 'G7PU4MZ1G';
const ASSET = 'e00177755a00269347jajp';
const MODERN_ASSET = 'e00324920a00324921enus';
const HARD = `/playback/v2/manifest/${MEDIA}/static/${ASSET}/0/en-US/dash/manifest.mpd`;
const HARD_ENUS = `/playback/v2/manifest/${MEDIA}/static/${ASSET}/0/enUS/dash/manifest.mpd`;
const CLEAN = `/playback/v2/manifest/${MEDIA}/static/${ASSET}/1/clean/dash/manifest.mpd`;
const MODERN = `/playback/v2/manifest/${MODERN_MEDIA}/static/majin/${MODERN_ASSET}/enus/cenc/dash/manifest.mpd`;
const HARD_URL = `https://www.crunchyroll.com${HARD}`;
const CLEAN_URL = `https://www.crunchyroll.com${CLEAN}`;
const ASS = `https://vod-fy-mod.crunchyrollcdn.com/static/${ASSET}/1/clean/subtitle-667360-en-US-1789593448.ass`;
const VTT = `https://vod-fy-mod.crunchyrollcdn.com/static/majin/${MODERN_ASSET}/enus/cenc/dash/captions/enus/20260814_191622/caption.vtt`;
const SKIP = `https://static.crunchyroll.com/skip-events/production/${MEDIA}.json`;
const SKIP_OTHER = `https://static.crunchyroll.com/skip-events/production/${OTHER}.json`;
const CMS = `https://www.crunchyroll.com/content/v2/cms/objects/${MEDIA}`;
const PLAY = `https://www.crunchyroll.com/playback/v3/${MEDIA}/web/chrome/play`;
const BIF = `https://vod-fy-mod.crunchyrollcdn.com/static/${ASSET}/1/clean/bif-1789659236.bif`;
const SIGNATURE = 'fake-signature';
const ASS_SIGNED = `${ASS}?t=${SIGNATURE}`;
const BIF_SIGNED = `${BIF}?t=${SIGNATURE}`;
const VTT_SIGNED = `${VTT}?t=${SIGNATURE}`;
const VTT_JA = `https://vod-fy-mod.crunchyrollcdn.com/static/majin/${MODERN_ASSET}/ja-JP/cenc/dash/captions/ja-JP/20260814_191622/caption.vtt?t=${SIGNATURE}`;
const VTT_DE = `https://vod-fy-mod.crunchyrollcdn.com/static/majin/${MODERN_ASSET}/de-DE/cenc/dash/captions/de-DE/20260814_191622/caption.vtt?t=${SIGNATURE}`;
const VTT_FORCED = `https://vod-fy-mod.crunchyrollcdn.com/static/majin/${MODERN_ASSET}/en-US/cenc/dash/captions/en-US/20260814_191700/caption.vtt?t=${SIGNATURE}`;
const LANDING = 'Crunchyroll: Watch Popular Anime, Play Games & Shop Online';
const ASS_BODY = [
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  'Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello {\\pos(1,2)}there'
].join('\n');

function playback(extra: Record<string, unknown> = {}) {
  return {
    assetId: ASSET,
    url: CLEAN_URL,
    burnedInLocale: '',
    hardSubs: { 'en-US': { hlang: 'en-US', url: HARD_URL, quality: 'adaptive' } },
    token: 'account-token',
    drm: { license: 'widevine-secret' },
    subtitles: { 'en-US': { format: 'ass', language: 'en-US', url: ASS_SIGNED } },
    bifs: BIF_SIGNED,
    ...extra
  };
}

function skipDocument(mediaId = MEDIA, intro: unknown = { title: '', type: 'intro', start: 0, end: 5 }) {
  return {
    lastUpdated: '2026-09-18T20:19:13.684Z',
    mediaId,
    token: 'account-token',
    intro,
    credits: { title: '', type: 'credits', start: 1310, end: 1400 },
    recap: { title: 'Recap', type: 'recap', start: 5, end: 20 }
  };
}

function installPage(pathname = `/watch/${MEDIA}/07-ghost-episode-2`) {
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  const oldFetch = globalThis.fetch;
  let fetches = 0;
  const requested: string[] = [];
  const attrs = new Set<string>(['data-te-crunchyroll-integration-off']);
  const classes = new Set<string>();
  const location = { hostname: 'www.crunchyroll.com', pathname, search: '', origin: 'https://www.crunchyroll.com' };
  const win = Object.assign(new EventTarget(), { location, setTimeout, clearTimeout, postMessage(_request: WorldEnvelope) {} });
  const doc: {
    title: string;
    querySelectorAll?: (selector: string) => unknown[];
    documentElement: {
      hasAttribute: (key: string) => boolean;
      toggleAttribute: (key: string, on: boolean) => void;
      classList: { add: (name: string) => void; remove: (name: string) => void; contains: (name: string) => boolean };
    };
  } = {
    title: '07 Ghost Episode 2 - Watch on Crunchyroll',
    documentElement: {
      hasAttribute: (key: string) => attrs.has(key),
      toggleAttribute(key: string, on: boolean) { if (on) attrs.add(key); else attrs.delete(key); },
      classList: {
        add: (name: string) => { classes.add(name); },
        remove: (name: string) => { classes.delete(name); },
        contains: (name: string) => classes.has(name)
      }
    }
  };
  globalThis.window = win as unknown as Window & typeof globalThis;
  globalThis.document = doc as unknown as Document;
  globalThis.fetch = ((input: unknown) => {
    fetches += 1;
    requested.push(String(input));
    return Promise.reject(new Error('no network'));
  }) as typeof fetch;
  readCrunchyrollSnapshot();
  attrs.delete('data-te-crunchyroll-integration-off');
  const queuedProbes: Array<() => void> = [];
  let holdProbes = false;
  win.addEventListener('theater-everywhere-media-probe', (event) => {
    const requestId = (event as CustomEvent<{ requestId: number }>).detail.requestId;
    const respond = () => {
      win.dispatchEvent(new CustomEvent('theater-everywhere-media-probe-result', {
        detail: { requestId, crunchyroll: readCrunchyrollSnapshot() }
      }));
    };
    if (holdProbes) {
      queuedProbes.push(respond);
      return;
    }
    respond();
  });
  return {
    win, attrs, classes, location, doc, requested,
    fetches: () => fetches,
    holdProbes() { holdProbes = true; },
    releaseProbes() {
      holdProbes = false;
      const pending = queuedProbes.splice(0);
      for (const respond of pending) respond();
    },
    restore() {
      attrs.add('data-te-crunchyroll-integration-off');
      readCrunchyrollSnapshot();
      globalThis.window = oldWindow;
      globalThis.document = oldDocument;
      globalThis.fetch = oldFetch;
    }
  };
}

function usePlayer(
  doc: { querySelectorAll?: (selector: string) => unknown[] },
  dash: string,
  subtitles?: { list: () => unknown[]; enable: (id: string) => unknown; disable: (id: string) => unknown; getSubtitle?: () => void }
) {
  doc.querySelectorAll = () => [{
    parentElement: {
      player: {
        getSource: () => ({ dash, drm: { license: 'widevine-secret' }, options: {}, analytics: {} }),
        ...(subtitles ? { subtitles } : {})
      },
      parentElement: null
    }
  }];
}

function rokuBif(timestamps: number[], multiplier = 10000): ArrayBuffer {
  const count = timestamps.length;
  const headerAndIndex = 64 + (count + 1) * 8;
  const buffer = new ArrayBuffer(headerAndIndex + count * 2);
  new Uint8Array(buffer).set([0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(buffer);
  view.setUint32(12, count, true);
  view.setUint32(16, multiplier, true);
  for (let i = 0; i < count; i += 1) {
    view.setUint32(64 + i * 8, timestamps[i], true);
    view.setUint32(64 + i * 8 + 4, headerAndIndex + i * 2, true);
  }
  view.setUint32(64 + count * 8, 0xffffffff, true);
  view.setUint32(64 + count * 8 + 4, headerAndIndex + count * 2, true);
  return buffer;
}

function streamedResponse(
  bytes: Uint8Array,
  init: { url?: string; status?: number; contentLength?: string | null } = {}
): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (bytes.byteLength) controller.enqueue(bytes);
      controller.close();
    }
  });
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    url: init.url || '',
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-length'
        ? (init.contentLength === undefined ? null : init.contentLength)
        : null)
    },
    body: stream
  } as unknown as Response;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Crunchyroll RTE', () => {
  it('matches only crunchyroll.com and sends embeds home', () => {
    assert.equal(isCrunchyrollHost('www.crunchyroll.com'), true);
    assert.equal(isCrunchyrollHost('www.crunchyroll.com.'), true);
    assert.equal(isCrunchyrollHost('static.crunchyroll.com'), true);
    for (const host of ['crunchyroll.com.evil.test', 'static.crunchyroll.com.evil.test', 'notcrunchyroll.com', 'crunchyroll.co', 'vod-fy-mod.crunchyrollcdn.com']) {
      assert.equal(isCrunchyrollHost(host), false, host);
    }
    assert.equal(serviceHomeUrl('https://static.crunchyroll.com/embed/player'), 'https://www.crunchyroll.com/');
    assert.equal(serviceHomeUrl('https://www.crunchyroll.com/watch/GR7592K3Y'), 'https://www.crunchyroll.com/');
    assert.equal(serviceHomeUrl('https://static.crunchyroll.com.evil.test/embed'), 'https://static.crunchyroll.com.evil.test/');
    assert.equal(serviceHomeUrl('https://crunchyroll.co/watch/GR7592K3Y'), 'https://crunchyroll.co/');
  });

  it('classifies hard, clean, and modern manifests and ignores other paths', () => {
    assert.deepEqual(classifyCrunchyrollManifest(HARD, 'player'), { mediaId: MEDIA, assetId: ASSET, rendition: 'hardsub' });
    assert.deepEqual(classifyCrunchyrollManifest(HARD_ENUS, 'player'), { mediaId: MEDIA, assetId: ASSET, rendition: 'hardsub' });
    assert.deepEqual(classifyCrunchyrollManifest(CLEAN, 'player'), { mediaId: MEDIA, assetId: ASSET, rendition: 'clean' });
    assert.deepEqual(classifyCrunchyrollManifest(MODERN, 'player'), { mediaId: MODERN_MEDIA, assetId: MODERN_ASSET, rendition: 'host' });
    assert.deepEqual(classifyCrunchyrollManifest(HARD_URL, 'network'), { mediaId: MEDIA, assetId: ASSET, rendition: 'hardsub' });
    assert.equal(classifyCrunchyrollManifest(HARD, 'network'), null);
    assert.equal(classifyCrunchyrollManifest(`https://static.crunchyroll.com${HARD}`, 'network'), null);
    assert.equal(classifyCrunchyrollManifest(`https://www.crunchyroll.com.evil.test${HARD}`, 'network'), null);
    assert.equal(classifyCrunchyrollManifest('https://beta-api.crunchyroll.com/playback/v2/manifest/GR7592K3Y/static/stream/1/clean/dash/manifest.mpd', 'network'), null);
    assert.equal(classifyCrunchyrollManifest(`/playback/v2/manifest/${MEDIA}/static/${ASSET}/2/other/dash/manifest.mpd`, 'player'), null);
    assert.equal(classifyCrunchyrollManifest(`/playback/v2/manifest/${MEDIA}/static/majin/not-clean/dash/manifest.mpd`, 'player'), null);
  });

  it('accepts the observed CDN subtitle and BIF paths and rejects lookalikes', () => {
    assert.deepEqual(crunchyrollCdnFile(ASS), { assetId: ASSET, kind: 'ass', language: 'en-US', query: 'none' });
    assert.equal(crunchyrollCdnFile(BIF)?.kind, 'bif');
    assert.equal(crunchyrollCdnFile(BIF)?.query, 'none');
    assert.equal(crunchyrollCdnFile(VTT_SIGNED)?.assetId, MODERN_ASSET);
    assert.equal(crunchyrollCdnFile(VTT_SIGNED)?.query, 't');
    assert.equal(crunchyrollCdnFile(BIF_SIGNED)?.query, 't');
    assert.equal(crunchyrollCdnFile(`${VTT}?token=${SIGNATURE}`)?.query, 'other');
    assert.equal(classifyMediaFetchUrl(VTT_SIGNED), null);
    assert.equal(classifyMediaFetchUrl(ASS_SIGNED), null);
    assert.equal(classifyMediaFetchUrl(BIF_SIGNED), null);
    assert.deepEqual(classifyMediaFetchUrl(ASS), { provider: 'crunchyroll', kind: 'caption-track', url: ASS });
    assert.deepEqual(classifyMediaFetchUrl(VTT), { provider: 'crunchyroll', kind: 'caption-track', url: VTT });
    const allowed = { provider: 'crunchyroll' as const, kind: 'caption-track' as const, url: ASS };
    for (const bad of [
      `http://vod-fy-mod.crunchyrollcdn.com/static/${ASSET}/1/clean/subtitle-667360-en-US-1789593448.ass`,
      `https://user:pass@vod-fy-mod.crunchyrollcdn.com/static/${ASSET}/1/clean/subtitle-667360-en-US-1789593448.ass`,
      `https://vod-fy-mod.crunchyrollcdn.com:444/static/${ASSET}/1/clean/subtitle-667360-en-US-1789593448.ass`,
      `https://vod-fy-mod.crunchyrollcdn.com.evil.test/static/${ASSET}/1/clean/subtitle-1-en-US-1.ass`,
      `https://static.crunchyroll.com/subtitles/${MEDIA}/en-US.ass`,
      `https://vod-fy.crunchyrollcdn.com/static/${ASSET}/1/clean/subtitle-1-en-US-1.ass`,
      HARD_URL,
      VTT_SIGNED,
      ASS_SIGNED,
      `https://vod-fy-mod.crunchyrollcdn.com/static/../${ASSET}/1/clean/subtitle-1-en-US-1.ass`
    ]) {
      assert.equal(isAllowedMediaFetchUrl({ ...allowed, url: bad }), false, bad);
    }
    assert.equal(BIF.includes(MEDIA), false);
    assert.equal(ASS.includes(MEDIA), false);
  });

  it('keeps burned-in captions unavailable for /0/en-US and /0/enUS', () => {
    const page = installPage();
    try {
      harvestCrunchyrollData(PLAY, playback());
      let snapshot = readCrunchyrollSnapshot();
      assert.equal(snapshot?.rendition, 'unknown');
      assert.deepEqual(snapshot?.captionTracks, []);
      assert.deepEqual(snapshot?.hostTracks, []);
      assert.equal(crunchyrollAllowsCaptionFetch(ASS), false);

      noteCrunchyrollManifest(HARD_URL);
      noteCrunchyrollManifest(CLEAN_URL);
      snapshot = readCrunchyrollSnapshot();
      assert.equal(snapshot?.rendition, 'hardsub');
      assert.deepEqual(snapshot?.captionTracks, []);
      assert.equal(JSON.stringify(snapshot).includes('account-token'), false);
      assert.equal(JSON.stringify(snapshot).includes('widevine-secret'), false);
      assert.equal(crunchyrollAllowsCaptionFetch(ASS), false);

      usePlayer(page.doc, HARD_ENUS);
      snapshot = readCrunchyrollSnapshot();
      assert.equal(snapshot?.rendition, 'hardsub');
      assert.deepEqual(snapshot?.captionTracks, []);
      assert.deepEqual(snapshot?.hostTracks, []);
      assert.equal(page.requested.some((url) => url.includes('.ass')), false);
      assert.equal(JSON.stringify(readCrunchyrollSnapshot()).includes(SIGNATURE), false);
    } finally { page.restore(); }
  });

  it('binds CDN files to the playback asset and ignores another asset or a secret field', () => {
    const page = installPage();
    try {
      const parsed = parseCrunchyrollPlayback(playback(), MEDIA);
      assert.deepEqual(parsed?.assetIds, [ASSET]);
      assert.deepEqual(parsed?.softTracks, []);
      assert.equal(parsed?.bifUrl, BIF_SIGNED);
      assert.equal(JSON.stringify(parsed).includes('account-token'), false);
      const otherAsset = 'eeeeeeeeeeeeeeeeeeeeee';
      const rejected = parseCrunchyrollPlayback(playback({
        subtitles: { 'en-US': { url: ASS.replace(ASSET, otherAsset) } },
        bifs: BIF_SIGNED.replace(ASSET, otherAsset),
        files: { subtitle: ASS, preview: BIF_SIGNED },
        description: ASS_SIGNED
      }), MEDIA);
      assert.deepEqual(rejected?.softTracks, []);
      assert.equal(rejected?.bifUrl, undefined);
      const listed = parseCrunchyrollPlayback(playback({
        subtitles: { 'en-US': { url: ASS, format: 'ass' } },
        bifs: [BIF_SIGNED]
      }), MEDIA);
      assert.equal(listed?.softTracks[0]?.url, ASS);
      assert.equal(listed?.bifUrl, BIF_SIGNED);
      const fromCaptions = parseCrunchyrollPlayback(playback({
        subtitles: undefined,
        captions: { 'en-US': { url: ASS } }
      }), MEDIA);
      assert.equal(fromCaptions?.softTracks[0]?.url, ASS);
      const mismatched = parseCrunchyrollPlayback(playback({ assetId: otherAsset }), MEDIA);
      assert.equal(mismatched?.bifUrl, undefined);
      assert.deepEqual(mismatched?.softTracks, []);
      harvestCrunchyrollData(PLAY, playback({ burnedInLocale: 'en-US' }));
      assert.equal(readCrunchyrollSnapshot()?.rendition, 'hardsub');
      assert.equal(JSON.stringify(readCrunchyrollSnapshot()).includes(SIGNATURE), false);
      harvestCrunchyrollData('https://beta-api.crunchyroll.com/cms/v2/GR7592K3Y', { id: MEDIA, title: 'Ignored' });
      assert.equal(readCrunchyrollSnapshot()?.title, '07 Ghost Episode 2');
      usePlayer(page.doc, CLEAN, { list: () => [], enable: () => {}, disable: () => {} });
      harvestCrunchyrollData(PLAY, playback({ subtitles: { 'en-US': { url: ASS, format: 'ass' } } }));
      const clean = readCrunchyrollSnapshot();
      assert.equal(clean?.rendition, 'clean');
      assert.equal(clean?.captionTracks[0]?.url, ASS);
      assert.equal(crunchyrollAllowsCaptionFetch(ASS), true);
      assert.equal(crunchyrollAllowsCaptionFetch(ASS_SIGNED), false);
      assert.equal(crunchyrollAllowsCaptionFetch(VTT), false);
      assert.equal(JSON.stringify(clean).includes(SIGNATURE), false);
    } finally { page.restore(); }
  });

  it('imports only validated intro and credits for the episode on screen', async () => {
    const page = installPage(`/watch/${OTHER}/episode`);
    try {
      harvestCrunchyrollData(SKIP_OTHER, skipDocument(OTHER));
      const chapters = readCrunchyrollSnapshot()?.chapters || [];
      assert.deepEqual(chapters.map(({ start, end, title }) => ({ start, end, title })), [
        { start: 0, end: 5, title: 'Intro' },
        { start: 1310, end: 1400, title: 'Credits' }
      ]);
      assert.equal(JSON.stringify(readCrunchyrollSnapshot()).includes('account-token'), false);
      assert.equal(JSON.stringify(readCrunchyrollSnapshot()).includes('lastUpdated'), false);
      await flush();
      harvestCrunchyrollData(SKIP_OTHER, skipDocument(MEDIA));
      assert.equal(readCrunchyrollSnapshot()?.chapters.length, 2);
      harvestCrunchyrollData(SKIP_OTHER, skipDocument(OTHER, { title: 'Opening', type: 'intro', start: '0', end: 5 }));
      assert.deepEqual(readCrunchyrollSnapshot()?.chapters.map((chapter) => chapter.title), ['Credits']);
      harvestCrunchyrollData(SKIP_OTHER, {
        mediaId: OTHER,
        intro: { type: 'intro', start: -1, end: 5 },
        credits: { type: 'credits', start: 1, end: 999999 }
      });
      assert.deepEqual(readCrunchyrollSnapshot()?.chapters, []);
      assert.equal(parseCrunchyrollSkipEvents(skipDocument(MEDIA), OTHER), null);
    } finally { page.restore(); }
  });

  it('does not keep an old title on a new route, and restores a confirmed title on re-entry', () => {
    const page = installPage();
    try {
      assert.equal(crunchyrollContentTitle(LANDING), null);
      assert.equal(crunchyrollContentTitle('Crunchyroll'), null);
      assert.equal(readCrunchyrollSnapshot()?.title, '07 Ghost Episode 2');
      harvestCrunchyrollData(CMS, [{
        id: MEDIA,
        title: 'Nostalgic Memories Accompany Pain',
        episode_metadata: { series_title: '07 Ghost', episode: '2', duration_ms: 1427628 },
        token: 'account-token'
      }]);
      assert.equal(readCrunchyrollSnapshot()?.title, 'Nostalgic Memories Accompany Pain');
      assert.equal(JSON.stringify(readCrunchyrollSnapshot()).includes('account-token'), false);
      assert.equal(JSON.stringify(readCrunchyrollSnapshot()).includes('1427628'), false);

      page.location.pathname = `/watch/${OTHER}/next`;
      assert.equal(readCrunchyrollSnapshot()?.mediaId, OTHER);
      assert.equal(readCrunchyrollSnapshot()?.title, undefined);
      harvestCrunchyrollData(CMS, [{ id: MEDIA, title: 'Nostalgic Memories Accompany Pain' }]);
      assert.notEqual(readCrunchyrollSnapshot()?.title, 'Nostalgic Memories Accompany Pain');

      page.doc.title = 'Next Episode - Watch on Crunchyroll';
      assert.equal(readCrunchyrollSnapshot()?.title, 'Next Episode');
      page.location.pathname = `/watch/${MEDIA}/07-ghost-episode-2`;
      page.doc.title = '07 Ghost Episode 2 - Watch on Crunchyroll';
      assert.equal(readCrunchyrollSnapshot()?.title, 'Nostalgic Memories Accompany Pain');

      page.doc.title = LANDING;
      page.location.pathname = '/watch/G9ABCDEFG/home';
      assert.equal(readCrunchyrollSnapshot()?.title, undefined);
    } finally { page.restore(); }
  });

  it('keeps a repeated document title off a new media id until that route rewrites it', () => {
    const shared = '07 Ghost Episode 2 - Watch on Crunchyroll';
    const page = installPage();
    try {
      assert.equal(readCrunchyrollSnapshot()?.title, '07 Ghost Episode 2');
      page.location.pathname = `/watch/${OTHER}/next`;
      assert.equal(readCrunchyrollSnapshot()?.title, undefined);
      assert.equal(readCrunchyrollSnapshot()?.title, undefined);

      page.doc.title = LANDING;
      assert.equal(readCrunchyrollSnapshot()?.title, undefined);
      page.doc.title = shared;
      assert.equal(readCrunchyrollSnapshot()?.title, '07 Ghost Episode 2');

      page.location.pathname = '/watch/G9ABCDEFG/later';
      assert.equal(readCrunchyrollSnapshot()?.title, undefined);
      page.doc.title = 'Crunchyroll';
      assert.equal(readCrunchyrollSnapshot()?.title, undefined);
      page.doc.title = shared;
      assert.equal(readCrunchyrollSnapshot()?.title, '07 Ghost Episode 2');
      harvestCrunchyrollData('https://www.crunchyroll.com/content/v2/cms/objects/G9ABCDEFG', [{
        id: 'G9ABCDEFG',
        title: 'A Confirmed Later Episode'
      }]);
      assert.equal(readCrunchyrollSnapshot()?.title, 'A Confirmed Later Episode');
    } finally { page.restore(); }
  });

  it('decodes a Roku BIF from the observed CDN path and rejects a redirected file', async () => {
    assert.ok(MAX_SAFE_BIF());
    const summary = summarizeCrunchyrollBif(rokuBif([0, 1], 10000));
    assert.deepEqual(summary, { frames: 2, intervalMs: 10000 });
    const page = installPage();
    const buffer = rokuBif([0, 1]);
    let bifCalls = 0;
    globalThis.fetch = ((input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === BIF_SIGNED) {
        bifCalls += 1;
        assert.equal(init?.credentials, 'omit');
        return Promise.resolve(streamedResponse(new Uint8Array(buffer), { url: BIF_SIGNED, contentLength: null }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    }) as typeof fetch;
    try {
      harvestCrunchyrollData(PLAY, playback());
      await flush();
      await flush();
      assert.equal(bifCalls, 1);
      const snapshot = readCrunchyrollSnapshot();
      assert.equal(snapshot?.bifBlobUrl?.startsWith('blob:'), true);
      assert.equal(JSON.stringify(snapshot).includes(SIGNATURE), false);
      assert.equal(JSON.stringify(snapshot).includes('bifUrl'), false);
      globalThis.fetch = (() => Promise.resolve(streamedResponse(new Uint8Array(buffer), { url: BIF, contentLength: null }))) as unknown as typeof fetch;
      const stripped = await loadCrunchyrollUrl(BIF_SIGNED, 1000, (finalUrl) => {
        const file = crunchyrollCdnFile(finalUrl);
        return file?.kind === 'bif' && file.query === 't' && file.assetId === ASSET;
      }, 'buffer', 16 * 1024 * 1024);
      assert.equal(stripped, null);
    } finally { page.restore(); }
  });

  it('revokes a replaced BIF immediately and discards a stale read', async () => {
    const page = installPage();
    const urlApi = URL as unknown as { createObjectURL?: (obj: Blob) => string; revokeObjectURL?: (url: string) => void };
    const oldCreate = urlApi.createObjectURL;
    const oldRevoke = urlApi.revokeObjectURL;
    const revoked: string[] = [];
    let blobCount = 0;
    urlApi.createObjectURL = () => `blob:crunchyroll-bif-${++blobCount}`;
    urlApi.revokeObjectURL = (url: string) => { revoked.push(url); };
    const buffer = rokuBif([0, 1]);
    const lateBlob: { release: (() => void) | null } = { release: null };
    globalThis.fetch = ((input: unknown) => {
      const url = String(input);
      if (url.startsWith('blob:')) {
        return new Promise<Response>((resolve) => { lateBlob.release = () => resolve(new Response(buffer)); });
      }
      if (url.includes('bif-')) return new Promise<Response>(() => {});
      return Promise.resolve(new Response('', { status: 404 }));
    }) as typeof fetch;
    try {
      harvestCrunchyrollData(PLAY, playback({
        subtitles: { 'en-US': { url: ASS, format: 'ass' } },
        bifs: undefined
      }));
      rememberCrunchyrollBif(buffer, BIF_SIGNED);
      const first = readCrunchyrollSnapshot()?.bifBlobUrl || '';
      assert.equal(first, 'blob:crunchyroll-bif-1');
      assert.equal(JSON.stringify(readCrunchyrollSnapshot()).includes(SIGNATURE), false);
      rememberCrunchyrollBif(buffer, BIF_SIGNED.replace('1789659236', '1789659999'));
      assert.equal(revoked.includes(first), true);
      assert.equal(readCrunchyrollSnapshot()?.bifBlobUrl, 'blob:crunchyroll-bif-2');

      const adapter = new CrunchyrollAdapter();
      const pending = adapter.probe();
      await flush();
      assert.equal(typeof lateBlob.release, 'function');
      page.location.pathname = `/watch/${OTHER}/next`;
      readCrunchyrollSnapshot();
      lateBlob.release?.();
      const preview = await pending;
      assert.equal(preview.previews, false);

      let sawLate = false;
      globalThis.fetch = ((input: unknown) => {
        const url = String(input);
        if (!url.includes('bif-')) return Promise.resolve(new Response('', { status: 404 }));
        sawLate = true;
        return Promise.resolve(new Response(buffer));
      }) as typeof fetch;
      page.location.pathname = `/watch/${MEDIA}/07-ghost-episode-2`;
      const started = loadCrunchyrollUrl(BIF_SIGNED, 1000, () => true, 'buffer', 16 * 1024 * 1024);
      page.location.pathname = `/watch/${OTHER}/next`;
      readCrunchyrollSnapshot();
      const loaded = await started;
      assert.equal(sawLate, true);
      if (loaded?.buffer) rememberCrunchyrollBif(loaded.buffer, BIF_SIGNED);
      assert.equal(readCrunchyrollSnapshot()?.bifBlobUrl, undefined);
      assert.equal(JSON.stringify(readCrunchyrollSnapshot()).includes(SIGNATURE), false);
    } finally {
      urlApi.createObjectURL = oldCreate;
      urlApi.revokeObjectURL = oldRevoke;
      page.restore();
    }
  });

  it('overlays ASS only when the host renderer is absent or suppressed', async () => {
    const page = installPage();
    let delay = false;
    let release = () => {};
    page.win.postMessage = (request: WorldEnvelope) => {
      const send = () => page.win.dispatchEvent(Object.assign(new Event('message'), {
        source: page.win,
        data: createWorldMessage('PAGE_FETCH_RESULT', { ok: true, body: ASS_BODY }, request.requestId, request.nonce, request.origin)
      }));
      if (delay) release = send;
      else send();
    };
    try {
      usePlayer(page.doc, CLEAN, { list: () => [], enable: () => {}, disable: () => {} });
      harvestCrunchyrollData(PLAY, playback({ subtitles: { 'en-US': { url: ASS, format: 'ass' } } }));
      const adapter = new CrunchyrollAdapter();
      const tracks = await adapter.listCaptionTracks();
      assert.equal(tracks[0]?.delivery, 'overlay');
      assert.deepEqual(preferProviderCaptionTracks([
        { id: 'native', language: 'en', label: 'English', kind: 'subtitles', source: 'native-text-track' },
        { id: tracks[0].id, language: 'en', label: 'en-US', kind: 'subtitles', source: 'crunchyroll', delivery: 'overlay' }
      ]).map((track) => track.source), ['crunchyroll']);
      const active = await adapter.activateCaptionTrack(tracks[0].id);
      assert.equal(active.status, 'active');
      assert.equal(active.cues[0]?.text, 'Hello there');
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);

      const thrown = { list: () => { throw new Error('unreadable'); }, enable: () => {}, disable: () => {} };
      usePlayer(page.doc, CLEAN, thrown);
      await adapter.reload();
      assert.deepEqual(await adapter.listCaptionTracks(), []);
      assert.equal(crunchyrollAllowsCaptionFetch(ASS), false);

      const enabled = [{ id: 'caption-en-US', lang: 'en-US', label: 'English', kind: 'subtitle', enabled: true, url: 'https://evil.example/caption.vtt' }];
      usePlayer(page.doc, CLEAN, { list: () => enabled, enable: () => {}, disable: () => {} });
      await adapter.reload();
      assert.deepEqual(await adapter.listCaptionTracks(), []);

      delay = true;
      usePlayer(page.doc, CLEAN, { list: () => [], enable: () => {}, disable: () => {} });
      await adapter.reload();
      const again = await adapter.listCaptionTracks();
      const stale = adapter.activateCaptionTrack(again[0].id);
      await Promise.resolve();
      page.location.pathname = `/watch/${OTHER}/next`;
      release();
      assert.equal((await stale).status, 'failed');
    } finally { page.restore(); }
  });

  it('enables and disables host subtitles for the modern manifest and lifts only that renderer', async () => {
    const css = readFileSync(new URL('../../content.css', import.meta.url), 'utf8');
    assert.match(css, /theater-everywhere-crunchyroll-host-captions/);
    assert.match(css, /\.bitmovinplayer-container > div:last-child:has\(> div > ul\)/);
    assert.match(css, /theater-everywhere-crunchyroll-host-captions[\s\S]* > div > ul \{[^}]*bottom:\s*var\(--theater-caption-bottom,\s*48px\)/);
    assert.equal(css.includes('bmpui-'), false);
    assert.equal(CRUNCHYROLL_HOST_CAPTION_SELECTOR, '.bitmovinplayer-container > div:last-child > div > ul');

    const page = installPage(`/watch/${MODERN_MEDIA}/the-journeys-end`);
    const tracks = [{
      id: 'caption-en-US',
      lang: 'en-US',
      label: 'English',
      kind: 'subtitle',
      enabled: false,
      isFragmented: false,
      isSideloaded: false,
      forced: false,
      url: VTT_SIGNED
    }];
    let subtitleReads = 0;
    const subtitles = {
      list: () => tracks.map((track) => ({ ...track })),
      enable(id: string) {
        const track = tracks.find((item) => item.id === id);
        if (!track) throw new Error(`missing ${id}`);
        for (const item of tracks) item.enabled = item.id === id;
      },
      disable(id: string) {
        const track = tracks.find((item) => item.id === id);
        if (track) track.enabled = false;
      },
      getSubtitle() { subtitleReads += 1; }
    };
    page.win.addEventListener(CRUNCHYROLL_CAPTION_EVENT, handleCrunchyrollCaptionEvent as EventListener);
    try {
      usePlayer(page.doc, MODERN, subtitles);
      const listed = parseCrunchyrollHostList(subtitles.list(), MODERN_ASSET);
      assert.equal(listed.tracks[0]?.id, 'caption-en-US');
      assert.equal(listed.renderer, 'suppressed');
      assert.equal(JSON.stringify(listed).includes(SIGNATURE), false);
      const oddQuery = parseCrunchyrollHostList([{
        id: 'caption-en-US',
        lang: 'en-US',
        label: 'English',
        kind: 'subtitle',
        enabled: false,
        url: `${VTT}?token=${SIGNATURE}`
      }], MODERN_ASSET);
      assert.equal(oddQuery.tracks[0]?.id, 'caption-en-US');
      assert.equal(JSON.stringify(oddQuery).includes(SIGNATURE), false);
      const adapter = new CrunchyrollAdapter();
      const menu = await adapter.listCaptionTracks();
      assert.equal(menu[0]?.delivery, 'host');
      assert.equal(menu[0]?.id, `crunchyroll-host:${MODERN_MEDIA}:caption-en-US`);
      const active = await adapter.activateCaptionTrack(menu[0].id);
      assert.equal(active.status, 'active');
      assert.deepEqual(active.cues, []);
      assert.equal(tracks[0].enabled, true);
      assert.equal(subtitleReads, 0);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);
      assert.equal(parseCrunchyrollCaptionRequest({ requestId: 'te-cr-abcdefgh', trackId: null }), null);
      const hosted = readCrunchyrollSnapshot();
      assert.equal(hosted?.hostTracks[0]?.id, 'caption-en-US');
      assert.equal('url' in (hosted?.hostTracks[0] || {}), false);
      assert.equal(JSON.stringify(hosted).includes(SIGNATURE), false);
      assert.equal(classifyMediaFetchUrl(VTT_SIGNED), null);
      await adapter.reload();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);
      assert.equal(tracks[0].enabled, true);

      const off = await adapter.activateCaptionTrack(null);
      assert.equal(off.status, 'off');
      assert.equal(tracks[0].enabled, false);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      await adapter.reload();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal(tracks[0].enabled, false);

      assert.equal((await adapter.activateCaptionTrack(`crunchyroll-host:${MODERN_MEDIA}:missing`)).status, 'failed');
      assert.equal(tracks[0].enabled, false);

      tracks[0].enabled = true;
      const entered = new CrunchyrollAdapter();
      await entered.listCaptionTracks();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);
      assert.equal(tracks[0].enabled, true);
      await entered.reload();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);
      assert.equal(tracks[0].enabled, true);
      page.location.pathname = `/watch/${OTHER}/next`;
      await entered.reload();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      page.location.pathname = `/watch/${MODERN_MEDIA}/the-journeys-end`;
      tracks[0].enabled = true;
      await entered.reload();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);
      entered.dispose();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      tracks[0].enabled = false;

      const lateAck: { release: (() => void) | null } = { release: null };
      page.win.removeEventListener(CRUNCHYROLL_CAPTION_EVENT, handleCrunchyrollCaptionEvent as EventListener);
      page.win.addEventListener(CRUNCHYROLL_CAPTION_EVENT, ((event: Event) => {
        const request = parseCrunchyrollCaptionRequest((event as CustomEvent<unknown>).detail);
        page.win.dispatchEvent(new CustomEvent('theater-everywhere-crunchyroll-caption-ack', {
          detail: JSON.stringify({ requestId: 'te-cr-staleack1', ok: true, mediaId: MODERN_MEDIA, route: page.location.pathname, trackId: request?.trackId ?? null })
        }));
        lateAck.release = () => handleCrunchyrollCaptionEvent(event);
      }) as EventListener);
      const moved = adapter.activateCaptionTrack(menu[0].id);
      await Promise.resolve();
      page.location.pathname = `/watch/${OTHER}/next`;
      lateAck.release?.();
      assert.equal((await moved).status, 'failed');
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal((await applyCrunchyrollHostCaption({
        requestId: 'te-cr-abcdefgh',
        mediaId: MODERN_MEDIA,
        route: `/watch/${MODERN_MEDIA}/the-journeys-end`,
        trackId: 'caption-en-US'
      })).ok, false);
    } finally { page.restore(); }
  });

  it('waits for a delayed host track list before the first enable and the first off', async () => {
    const page = installPage(`/watch/${MODERN_MEDIA}/the-journeys-end`);
    const tracks = [
      { id: 'caption-en-US', lang: 'en-US', label: 'English', kind: 'subtitle', enabled: false, url: VTT_SIGNED },
      { id: 'caption-ja-JP', lang: 'ja-JP', label: 'Japanese', kind: 'subtitle', enabled: false, url: VTT_JA }
    ];
    let revision = 0;
    const subtitles = {
      list: () => tracks.map((track) => ({ ...track })),
      enable(id: string) {
        const ticket = ++revision;
        setTimeout(() => {
          if (ticket !== revision) return;
          for (const item of tracks) item.enabled = item.id === id;
        }, 30);
        return Promise.resolve();
      },
      disable(id: string) {
        const ticket = ++revision;
        setTimeout(() => {
          if (ticket !== revision) return;
          const track = tracks.find((item) => item.id === id);
          if (track) track.enabled = false;
        }, 30);
      }
    };
    const acks: Array<{ ok: boolean; trackId: string | null }> = [];
    page.win.addEventListener(CRUNCHYROLL_CAPTION_ACK_EVENT, ((event: Event) => {
      const ack = parseCrunchyrollCaptionAck((event as CustomEvent<unknown>).detail);
      if (ack) acks.push({ ok: ack.ok, trackId: ack.trackId });
    }) as EventListener);
    page.win.addEventListener(CRUNCHYROLL_CAPTION_EVENT, handleCrunchyrollCaptionEvent as EventListener);
    try {
      usePlayer(page.doc, MODERN, subtitles);
      const adapter = new CrunchyrollAdapter();
      const menu = await adapter.listCaptionTracks();
      const english = menu.find((track) => track.id.endsWith(':caption-en-US'));
      const japanese = menu.find((track) => track.id.endsWith(':caption-ja-JP'));
      assert.ok(english);
      assert.ok(japanese);
      assert.equal(JSON.stringify(menu).includes(SIGNATURE), false);

      const first = await adapter.activateCaptionTrack(english.id);
      assert.equal(first.status, 'active');
      assert.equal(tracks[0].enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);
      assert.equal(acks.at(-1)?.ok, true);

      const off = await adapter.activateCaptionTrack(null);
      assert.equal(off.status, 'off');
      assert.equal(tracks[0].enabled, false);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal(acks.at(-1)?.ok, true);
      assert.equal(acks.at(-1)?.trackId, null);

      const enabling = adapter.activateCaptionTrack(english.id);
      await wait(15);
      page.location.pathname = `/watch/${OTHER}/next`;
      assert.equal((await enabling).status, 'failed');
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      await wait(50);
      page.location.pathname = `/watch/${MODERN_MEDIA}/the-journeys-end`;
      tracks[0].enabled = false;
      tracks[1].enabled = false;
      await adapter.reload();
      const pending = adapter.activateCaptionTrack(english.id);
      await wait(10);
      page.attrs.add('data-te-crunchyroll-integration-off');
      assert.equal((await pending).status, 'failed');
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      page.attrs.delete('data-te-crunchyroll-integration-off');
      await wait(40);
      tracks[0].enabled = false;
      tracks[1].enabled = false;
      await adapter.reload();

      const staleOn = adapter.activateCaptionTrack(english.id);
      await wait(15);
      const newerOff = adapter.activateCaptionTrack(null);
      assert.equal((await staleOn).status, 'failed');
      assert.equal((await newerOff).status, 'off');
      assert.equal(tracks[0].enabled, false);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal(acks.filter((ack) => ack.trackId === 'caption-en-US').at(-1)?.ok, false);

      const staleTrack = adapter.activateCaptionTrack(english.id);
      await wait(15);
      const replacement = adapter.activateCaptionTrack(japanese.id);
      assert.equal((await staleTrack).status, 'failed');
      assert.equal((await replacement).status, 'active');
      assert.equal(tracks[0].enabled, false);
      assert.equal(tracks[1].enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);
      adapter.dispose();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
    } finally { page.restore(); }
  });

  it('turns host captions off after invalidate clears the snapshot, and not on another route', async () => {
    const page = installPage(`/watch/${MODERN_MEDIA}/the-journeys-end`);
    const tracks = [
      { id: 'caption-en-US', lang: 'en-US', label: 'English', kind: 'subtitle', enabled: false, url: VTT_SIGNED },
      { id: 'caption-ja-JP', lang: 'ja-JP', label: 'Japanese', kind: 'subtitle', enabled: false, url: VTT_JA }
    ];
    let revision = 0;
    const calls: string[] = [];
    const subtitles = {
      list: () => tracks.map((track) => ({ ...track })),
      enable(id: string) {
        calls.push(`enable:${id}`);
        const ticket = ++revision;
        setTimeout(() => {
          if (ticket !== revision) return;
          for (const item of tracks) item.enabled = item.id === id;
        }, 20);
      },
      disable(id: string) {
        calls.push(`disable:${id}`);
        const ticket = ++revision;
        setTimeout(() => {
          if (ticket !== revision) return;
          const track = tracks.find((item) => item.id === id);
          if (track) track.enabled = false;
        }, 20);
      }
    };
    page.win.addEventListener(CRUNCHYROLL_CAPTION_EVENT, handleCrunchyrollCaptionEvent as EventListener);
    try {
      usePlayer(page.doc, MODERN, subtitles);
      const adapter = new CrunchyrollAdapter();
      const menu = await adapter.listCaptionTracks();
      const english = menu.find((track) => track.id.endsWith(':caption-en-US'))!;
      // Controller.invalidate() clears the adapter, then asks for Off. The host target has to survive that order.
      assert.equal((await adapter.activateCaptionTrack(english.id)).status, 'active');
      assert.equal(tracks[0].enabled, true);
      adapter.invalidate();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'off');
      assert.equal(tracks[0].enabled, false);
      assert.equal(calls.filter((call) => call.startsWith('disable:')).length, 1);

      assert.equal((await adapter.activateCaptionTrack(english.id)).status, 'active');
      let armed = calls.length;
      adapter.invalidate();
      page.location.pathname = `/watch/${OTHER}/next`;
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'off');
      assert.equal(calls.length, armed);
      assert.equal(tracks[0].enabled, true);
      await wait(40);
      assert.equal(tracks[0].enabled, true);

      page.location.pathname = `/watch/${MODERN_MEDIA}/the-journeys-end`;
      assert.equal((await adapter.activateCaptionTrack(english.id)).status, 'active');
      armed = calls.length;
      page.attrs.add('data-te-crunchyroll-integration-off');
      adapter.invalidate();
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'off');
      assert.equal(calls.length, armed);
      assert.equal(tracks[0].enabled, true);
    } finally { page.restore(); }
  });

  it('acks the latest host caption after one queued settle and rejects the intermediate', async () => {
    assert.equal(CRUNCHYROLL_CAPTION_ACK_TIMEOUT_MS, 2 * CRUNCHYROLL_HOST_CAPTION_SETTLE_MS + 200);
    const listDelay = CRUNCHYROLL_HOST_CAPTION_SETTLE_MS - 120;
    assert.ok(listDelay * 2 > CRUNCHYROLL_HOST_CAPTION_SETTLE_MS + 200);
    const page = installPage(`/watch/${MODERN_MEDIA}/the-journeys-end`);
    const tracks = [
      { id: 'caption-en-US', lang: 'en-US', label: 'English', kind: 'subtitle', enabled: false, url: VTT_SIGNED },
      { id: 'caption-ja-JP', lang: 'ja-JP', label: 'Japanese', kind: 'subtitle', enabled: false, url: VTT_JA }
    ];
    let revision = 0;
    const calls: string[] = [];
    const subtitles = {
      list: () => tracks.map((track) => ({ ...track })),
      enable(id: string) {
        calls.push(`enable:${id}`);
        const ticket = ++revision;
        setTimeout(() => {
          if (ticket !== revision) return;
          for (const item of tracks) item.enabled = item.id === id;
        }, listDelay);
      },
      disable(id: string) {
        calls.push(`disable:${id}`);
        const ticket = ++revision;
        setTimeout(() => {
          if (ticket !== revision) return;
          const track = tracks.find((item) => item.id === id);
          if (track) track.enabled = false;
        }, listDelay);
      }
    };
    const acks: Array<{ ok: boolean; trackId: string | null }> = [];
    page.win.addEventListener(CRUNCHYROLL_CAPTION_ACK_EVENT, ((event: Event) => {
      const ack = parseCrunchyrollCaptionAck((event as CustomEvent<unknown>).detail);
      if (ack) acks.push({ ok: ack.ok, trackId: ack.trackId });
    }) as EventListener);
    page.win.addEventListener(CRUNCHYROLL_CAPTION_EVENT, handleCrunchyrollCaptionEvent as EventListener);
    try {
      usePlayer(page.doc, MODERN, subtitles);
      const adapter = new CrunchyrollAdapter();
      const menu = await adapter.listCaptionTracks();
      const english = menu.find((track) => track.id.endsWith(':caption-en-US'))!;
      const japanese = menu.find((track) => track.id.endsWith(':caption-ja-JP'))!;
      const first = adapter.activateCaptionTrack(english.id);
      await wait(40);
      const middleAt = Date.now();
      const middle = adapter.activateCaptionTrack(null).then((result) => ({ result, elapsed: Date.now() - middleAt }));
      const latestAt = Date.now();
      const latest = adapter.activateCaptionTrack(japanese.id).then((result) => ({ result, elapsed: Date.now() - latestAt }));
      const [firstResult, middleTimed, latestTimed] = await Promise.all([first, middle, latest]);
      assert.equal(firstResult.status, 'failed');
      assert.equal(middleTimed.result.status, 'failed');
      assert.equal(latestTimed.result.status, 'active');
      assert.ok(latestTimed.elapsed > CRUNCHYROLL_HOST_CAPTION_SETTLE_MS + 200, `latest elapsed ${latestTimed.elapsed}`);
      assert.ok(middleTimed.elapsed < CRUNCHYROLL_HOST_CAPTION_SETTLE_MS + 350, `intermediate elapsed ${middleTimed.elapsed}`);
      assert.equal(tracks[0].enabled, false);
      assert.equal(tracks[1].enabled, true);
      assert.equal(acks.filter((ack) => ack.ok).map((ack) => ack.trackId).join(','), 'caption-ja-JP');
      assert.equal(acks.some((ack) => ack.trackId === null && ack.ok), false);
      const englishEnable = calls.indexOf('enable:caption-en-US');
      const japaneseEnable = calls.indexOf('enable:caption-ja-JP');
      assert.equal(calls.filter((call) => call === 'enable:caption-en-US').length, 1);
      assert.ok(japaneseEnable > englishEnable);
      await wait(50);
      assert.equal(tracks[0].enabled, false);
      assert.equal(tracks[1].enabled, true);
      assert.equal(acks.filter((ack) => ack.ok && ack.trackId === 'caption-en-US').length, 0);
    } finally { page.restore(); }
  });

  it('loads preview frames from reload and list without probing', async () => {
    const page = installPage();
    const buffer = rokuBif([0, 1]);
    let blobReads = 0;
    let holdBlob = true;
    const blobGate: { release: (() => void) | null } = { release: null };
    globalThis.fetch = ((input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === BIF_SIGNED) {
        assert.equal(init?.credentials, 'omit');
        return Promise.resolve(streamedResponse(new Uint8Array(buffer), { url: BIF_SIGNED, contentLength: null }));
      }
      if (url.startsWith('blob:')) {
        blobReads += 1;
        if (!holdBlob) return Promise.resolve(new Response(buffer));
        return new Promise<Response>((resolve) => {
          blobGate.release = () => {
            holdBlob = false;
            resolve(new Response(buffer));
          };
        });
      }
      return Promise.resolve(new Response('', { status: 404 }));
    }) as typeof fetch;
    try {
      harvestCrunchyrollData(PLAY, playback());
      await flush();
      await flush();
      const adapter = new CrunchyrollAdapter();
      await adapter.reload();
      await adapter.listCaptionTracks();
      await adapter.getChapters();
      assert.equal(blobReads, 1);
      assert.equal(adapter.getTitle(), '07 Ghost Episode 2');
      assert.equal(adapter.getPreviewFrame(0), null);
      assert.equal(typeof blobGate.release, 'function');
      blobGate.release?.();
      await flush();
      await flush();
      const frame = adapter.getPreviewFrame(0);
      assert.equal(frame?.image.kind, 'sprite');
      assert.equal(typeof frame?.image.url, 'string');
      const reads = blobReads;
      await adapter.reload();
      await adapter.listCaptionTracks();
      await flush();
      assert.equal(blobReads, reads);
      assert.equal(adapter.getPreviewFrame(5)?.image.kind, 'sprite');
      page.location.pathname = `/watch/${OTHER}/next`;
      await adapter.reload();
      assert.equal(adapter.getPreviewFrame(0), null);
    } finally { page.restore(); }
  });

  it('keeps a newer BIF read when an older one settles', async () => {
    const page = installPage();
    const urlApi = URL as unknown as { createObjectURL?: (obj: Blob) => string; revokeObjectURL?: (url: string) => void };
    const oldCreate = urlApi.createObjectURL;
    const oldRevoke = urlApi.revokeObjectURL;
    let blobCount = 0;
    urlApi.createObjectURL = () => `blob:crunchyroll-bif-${++blobCount}`;
    urlApi.revokeObjectURL = () => {};
    const buffer = rokuBif([0, 1]);
    const pending: Array<(response: Response) => void> = [];
    globalThis.fetch = ((input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('blob:')) {
        return new Promise<Response>((resolve) => pending.push(resolve));
      }
      if (url === BIF_SIGNED) {
        assert.equal(init?.credentials, 'omit');
        return Promise.resolve(streamedResponse(new Uint8Array(buffer), { url: BIF_SIGNED, contentLength: null }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    }) as typeof fetch;
    try {
      harvestCrunchyrollData(PLAY, playback());
      await flush();
      const adapter = new CrunchyrollAdapter();
      const first = adapter.probe();
      await flush();
      assert.equal(pending.length, 1);
      adapter.invalidate();
      const second = adapter.probe();
      await flush();
      assert.equal(pending.length, 2);
      pending[0](new Response(buffer));
      await flush();
      const third = adapter.probe();
      await flush();
      assert.equal(pending.length, 2);
      pending[1](new Response(buffer));
      assert.equal((await first).previews, false);
      assert.equal((await second).previews, true);
      assert.equal((await third).previews, true);
      assert.equal(JSON.stringify(readCrunchyrollSnapshot()).includes(SIGNATURE), false);
    } finally {
      urlApi.createObjectURL = oldCreate;
      urlApi.revokeObjectURL = oldRevoke;
      page.restore();
    }
  });

  it('reloads skip metadata when integration is turned back on without navigation', async () => {
    const page = installPage();
    let notes = 0;
    let calls = 0;
    page.win.addEventListener(CRUNCHYROLL_HARVEST_EVENT, () => { notes += 1; });
    globalThis.fetch = ((input: unknown) => {
      const url = String(input);
      if (!url.includes('skip-events')) return Promise.resolve(new Response('', { status: 404 }));
      calls += 1;
      const body = JSON.stringify(skipDocument());
      captureCrunchyrollNetworkResponse(url, new Response(body));
      return Promise.resolve(new Response(body));
    }) as typeof fetch;
    try {
      readCrunchyrollSnapshot();
      await flush();
      await flush();
      assert.equal(readCrunchyrollSnapshot()?.chapters.length, 2);
      const afterFirst = calls;
      assert.equal(afterFirst, 1);
      const noted = notes;
      readCrunchyrollSnapshot();
      await flush();
      assert.equal(calls, afterFirst);
      assert.equal(notes, noted);
      page.attrs.add('data-te-crunchyroll-integration-off');
      assert.equal(readCrunchyrollSnapshot(), null);
      page.attrs.delete('data-te-crunchyroll-integration-off');
      readCrunchyrollSnapshot();
      await flush();
      await flush();
      assert.equal(calls, 2);
      assert.equal(readCrunchyrollSnapshot()?.chapters.length, 2);
    } finally { page.restore(); }
  });

  it('aborts a metadata fetch that does not finish', async () => {
    const page = installPage();
    globalThis.fetch = ((_url: unknown, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as typeof fetch;
    try {
      const result = await loadCrunchyrollUrl(SKIP, 20, () => true, 'text', 1000);
      assert.equal(result, null);
    } finally { page.restore(); }
  });

  it('retries a failed skip document without pinning the episode or clearing a newer session', async () => {
    const page = installPage();
    const realNow = Date.now;
    let now = 1_700_000_000_000;
    Date.now = () => now;
    const calls: string[] = [];
    const pending: Array<{ url: string; resolve: (response: Response) => void }> = [];
    globalThis.fetch = ((input: unknown) => {
      const url = String(input);
      if (!url.includes('skip-events')) return Promise.resolve(new Response('', { status: 404 }));
      calls.push(url);
      return new Promise((resolve) => pending.push({ url, resolve }));
    }) as typeof fetch;
    const finish = (index: number, body: string | null, status = 200) => {
      const item = pending[index];
      item.resolve(streamedResponse(new TextEncoder().encode(body ?? ''), {
        url: item.url,
        status,
        contentLength: null
      }));
    };
    try {
      readCrunchyrollSnapshot();
      await flush();
      assert.equal(calls.length, 1);
      assert.equal(calls[0], SKIP);
      readCrunchyrollSnapshot();
      await flush();
      assert.equal(calls.length, 1);

      finish(0, null, 503);
      await flush();
      await flush();
      readCrunchyrollSnapshot();
      readCrunchyrollSnapshot();
      await flush();
      assert.equal(calls.length, 1);

      now += CRUNCHYROLL_SKIP_RETRY_MS;
      readCrunchyrollSnapshot();
      await flush();
      assert.equal(calls.length, 2);
      finish(1, '{');
      await flush();
      await flush();
      readCrunchyrollSnapshot();
      readCrunchyrollSnapshot();
      await flush();
      assert.equal(calls.length, 2);
      assert.deepEqual(readCrunchyrollSnapshot()?.chapters, []);

      now += CRUNCHYROLL_SKIP_RETRY_MS;
      readCrunchyrollSnapshot();
      await flush();
      assert.equal(calls.length, 3);
      finish(2, JSON.stringify({ mediaId: MEDIA }));
      await flush();
      await flush();
      assert.deepEqual(readCrunchyrollSnapshot()?.chapters, []);
      now += CRUNCHYROLL_SKIP_RETRY_MS * 5;
      readCrunchyrollSnapshot();
      readCrunchyrollSnapshot();
      await flush();
      assert.equal(calls.length, 3);

      page.location.pathname = `/watch/${OTHER}/next`;
      readCrunchyrollSnapshot();
      await flush();
      const staleOther = calls.length - 1;
      assert.equal(calls[staleOther], SKIP_OTHER);
      page.location.pathname = `/watch/${MEDIA}/07-ghost-episode-2`;
      readCrunchyrollSnapshot();
      await flush();
      const activeMedia = calls.length - 1;
      assert.equal(calls[activeMedia], SKIP);
      finish(staleOther, null, 503);
      await flush();
      await flush();
      now += CRUNCHYROLL_SKIP_RETRY_MS;
      readCrunchyrollSnapshot();
      await flush();
      assert.equal(calls.length, activeMedia + 1);
      finish(activeMedia, JSON.stringify(skipDocument()));
      await flush();
      await flush();
      assert.equal(readCrunchyrollSnapshot()?.chapters.length, 2);
      now += CRUNCHYROLL_SKIP_RETRY_MS;
      readCrunchyrollSnapshot();
      await flush();
      assert.equal(calls.length, activeMedia + 1);
    } finally {
      Date.now = realNow;
      page.restore();
    }
  });

  it('uses the replacement BIF when the blob URL changes during an older read', async () => {
    const page = installPage();
    const assetB = 'ffffeeeeffffeeeeffffeeee';
    const bifB = `https://vod-fy-mod.crunchyrollcdn.com/static/${assetB}/1/clean/bif-1789659999.bif?t=${SIGNATURE}`;
    const playB = `https://www.crunchyroll.com/playback/v3/${OTHER}/web/chrome/play`;
    const lateMedia = 'G9ABCDEFG';
    const assetC = 'abcdeabcdeabcdeabcdeabcd';
    const bifC = `https://vod-fy-mod.crunchyrollcdn.com/static/${assetC}/1/clean/bif-1789659998.bif?t=${SIGNATURE}`;
    const playC = `https://www.crunchyroll.com/playback/v3/${lateMedia}/web/chrome/play`;
    const manifestFor = (mediaId: string, assetId: string) => (
      `https://www.crunchyroll.com/playback/v2/manifest/${mediaId}/static/${assetId}/1/clean/dash/manifest.mpd`
    );
    const described = (mediaId: string, assetId: string, bifUrl: string) => playback({
      assetId,
      url: manifestFor(mediaId, assetId),
      hardSubs: undefined,
      burnedInLocale: '',
      subtitles: {},
      bifs: bifUrl
    });
    const urlApi = URL as unknown as { createObjectURL?: (obj: Blob) => string; revokeObjectURL?: (url: string) => void };
    const oldCreate = urlApi.createObjectURL;
    const oldRevoke = urlApi.revokeObjectURL;
    let blobCount = 0;
    urlApi.createObjectURL = () => `blob:crunchyroll-bif-${++blobCount}`;
    urlApi.revokeObjectURL = () => {};
    const early = rokuBif([0, 1]);
    const replacement = rokuBif([0, 50], 1000);
    const blocked = rokuBif([0, 2], 1000);
    const blobs: Array<(response: Response) => void> = [];
    globalThis.fetch = ((input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('blob:')) return new Promise<Response>((resolve) => blobs.push(resolve));
      if (url === BIF_SIGNED || url === bifB || url === bifC) {
        assert.equal(init?.credentials, 'omit');
        const buffer = url === bifB ? replacement : url === bifC ? blocked : early;
        return Promise.resolve(streamedResponse(new Uint8Array(buffer), { url, contentLength: null }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    }) as typeof fetch;
    try {
      harvestCrunchyrollData(PLAY, playback());
      await flush();
      await flush();
      const adapter = new CrunchyrollAdapter();
      const first = adapter.probe();
      await flush();
      assert.equal(blobs.length, 1);
      void adapter.getPreviewSource();
      await flush();
      assert.equal(blobs.length, 1);

      page.location.pathname = `/watch/${OTHER}/next`;
      harvestCrunchyrollData(playB, described(OTHER, assetB, bifB));
      await flush();
      await flush();
      assert.equal(readCrunchyrollSnapshot()?.bifBlobUrl, 'blob:crunchyroll-bif-2');
      const current = adapter.probe();
      await flush();
      assert.equal(blobs.length, 2);
      blobs[1](new Response(replacement));
      await flush();
      assert.equal((await current).previews, true);
      assert.equal(adapter.getPreviewFrame(40)?.time, 0);
      blobs[0](new Response(early));
      await flush();
      assert.equal(blobs.length, 2);
      assert.equal((await first).previews, true);
      assert.equal(adapter.getPreviewFrame(40)?.time, 0);

      page.location.pathname = `/watch/${lateMedia}/later`;
      harvestCrunchyrollData(playC, described(lateMedia, assetC, bifC));
      await flush();
      await flush();
      const unpublished = adapter.probe();
      await flush();
      assert.equal(blobs.length, 3);
      page.attrs.add('data-te-crunchyroll-integration-off');
      blobs[2](new Response(blocked));
      await flush();
      assert.equal((await unpublished).previews, false);
      assert.equal(adapter.getPreviewFrame(0), null);
      page.location.pathname = `/watch/${lateMedia}/elsewhere`;
      assert.equal((await adapter.probe()).previews, false);
      assert.equal(adapter.getPreviewFrame(0), null);
      assert.equal(blobs.length, 3);
    } finally {
      urlApi.createObjectURL = oldCreate;
      urlApi.revokeObjectURL = oldRevoke;
      page.restore();
    }
  });

  it('parses the flattened ASS cue without positioning', () => {
    assert.equal(parseCrunchyrollCaptionBody(ASS_BODY, 'ass')[0]?.text, 'Hello there');
  });

  it('keeps the host lift until Off is confirmed and does not adopt an external track', async () => {
    const page = installPage(`/watch/${MODERN_MEDIA}/the-journeys-end`);
    const tracks = [
      { id: 'caption-en-US', lang: 'en-US', label: 'English', kind: 'subtitle', enabled: false, url: VTT_SIGNED },
      { id: 'caption-ja-JP', lang: 'ja-JP', label: 'Japanese', kind: 'subtitle', enabled: false, url: VTT_JA }
    ];
    let mode = 'work';
    let releaseDisable = () => {};
    const calls: string[] = [];
    const subtitles = {
      list: () => tracks.map((track) => ({ ...track })),
      enable(id: string) {
        calls.push(`enable:${id}`);
        if (mode === 'throw-enable' || mode === 'keep-enabled') throw new Error('enable failed');
        for (const item of tracks) item.enabled = item.id === id;
      },
      disable(id: string) {
        calls.push(`disable:${id}`);
        if (mode === 'throw-disable' || mode === 'keep-enabled') throw new Error('disable failed');
        if (mode === 'noop-disable') return undefined;
        if (mode === 'gate') return new Promise<void>((resolve) => { releaseDisable = resolve; });
        const track = tracks.find((item) => item.id === id);
        if (track) track.enabled = false;
        if (mode === 'lie-after-disable') throw new Error('disabled but the ack failed');
        return undefined;
      }
    };
    page.win.addEventListener(CRUNCHYROLL_CAPTION_EVENT, handleCrunchyrollCaptionEvent as EventListener);
    try {
      usePlayer(page.doc, MODERN, subtitles);
      tracks[0].enabled = true;
      const external = new CrunchyrollAdapter();
      await external.listCaptionTracks();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);
      let armed = calls.length;
      external.invalidate();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal((await external.activateCaptionTrack(null)).status, 'off');
      assert.equal(calls.length, armed);
      assert.equal(tracks[0].enabled, true);

      const choosing = new CrunchyrollAdapter();
      await choosing.listCaptionTracks();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);
      assert.equal((await choosing.activateCaptionTrack(null)).status, 'off');
      assert.equal(tracks[0].enabled, false);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);

      const adapter = new CrunchyrollAdapter();
      const menu = await adapter.listCaptionTracks();
      const english = menu.find((track) => track.id.endsWith(':caption-en-US'))!;
      const japanese = menu.find((track) => track.id.endsWith(':caption-ja-JP'))!;
      assert.equal((await adapter.activateCaptionTrack(english.id)).status, 'active');
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);

      mode = 'keep-enabled';
      assert.equal((await adapter.activateCaptionTrack(japanese.id)).status, 'failed');
      assert.equal(tracks[0].enabled, true);
      assert.equal(tracks[1].enabled, false);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);
      mode = 'work';
      armed = calls.length;
      adapter.invalidate();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'off');
      assert.equal(calls.length, armed + 1);
      assert.equal(tracks[0].enabled, false);
      await wait(30);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);

      assert.equal((await adapter.activateCaptionTrack(english.id)).status, 'active');
      mode = 'throw-disable';
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'failed');
      assert.equal(tracks[0].enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);
      mode = 'lie-after-disable';
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'failed');
      assert.equal(tracks[0].enabled, false);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      armed = calls.length;
      adapter.invalidate();
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'off');
      assert.equal(calls.length, armed);

      mode = 'work';
      tracks[0].enabled = false;
      assert.equal((await adapter.activateCaptionTrack(english.id)).status, 'active');
      const moved = adapter.activateCaptionTrack(null);
      page.location.pathname = `/watch/${OTHER}/next`;
      assert.equal((await moved).status, 'failed');
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal(tracks[0].enabled, true);

      page.location.pathname = `/watch/${MODERN_MEDIA}/the-journeys-end`;
      tracks[0].enabled = false;
      await adapter.reload();
      assert.equal((await adapter.activateCaptionTrack(english.id)).status, 'active');
      const integrationOff = adapter.activateCaptionTrack(null);
      page.attrs.add('data-te-crunchyroll-integration-off');
      assert.equal((await integrationOff).status, 'failed');
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      page.attrs.delete('data-te-crunchyroll-integration-off');

      tracks[0].enabled = false;
      await adapter.reload();
      assert.equal((await adapter.activateCaptionTrack(english.id)).status, 'active');
      mode = 'gate';
      let classWhenStaleOffFinished = false;
      const staleOff = adapter.activateCaptionTrack(null).then((result) => {
        classWhenStaleOffFinished = page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS);
        return result;
      });
      await flush();
      mode = 'work';
      const replacement = adapter.activateCaptionTrack(english.id);
      releaseDisable();
      assert.equal((await staleOff).status, 'failed');
      assert.equal(classWhenStaleOffFinished, true);
      assert.equal((await replacement).status, 'active');
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);
      assert.equal(tracks[0].enabled, true);

      mode = 'noop-disable';
      const offAt = Date.now();
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'failed');
      const offElapsed = Date.now() - offAt;
      assert.ok(offElapsed > CRUNCHYROLL_HOST_CAPTION_SETTLE_MS - 50, `off elapsed ${offElapsed}`);
      assert.ok(offElapsed < CRUNCHYROLL_HOST_CAPTION_SETTLE_MS + 700, `off elapsed ${offElapsed}`);
      assert.equal(tracks[0].enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);

      mode = 'work';
      const exiting = adapter.activateCaptionTrack(null);
      adapter.dispose();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal((await exiting).status, 'failed');
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
    } finally { page.restore(); }
  });

  it('leaves a player-selected track on when automatic Off follows an RTE track', async () => {
    const route = `/watch/${MODERN_MEDIA}/the-journeys-end`;
    const page = installPage(route);
    const tracks = [
      { id: 'caption-en-US', lang: 'en-US', label: 'English', kind: 'subtitle', enabled: false, url: VTT_SIGNED },
      { id: 'caption-ja-JP', lang: 'ja-JP', label: 'Japanese', kind: 'subtitle', enabled: false, url: VTT_JA }
    ];
    const calls: string[] = [];
    const seen: string[] = [];
    const subtitles = {
      list: () => tracks.map((track) => ({ ...track })),
      enable(id: string) {
        calls.push(`enable:${id}`);
        for (const item of tracks) item.enabled = item.id === id;
      },
      disable(id: string) {
        calls.push(`disable:${id}`);
        const track = tracks.find((item) => item.id === id);
        if (track) track.enabled = false;
      }
    };
    const selectJapanese = () => {
      tracks[0].enabled = false;
      tracks[1].enabled = true;
    };
    page.win.addEventListener(CRUNCHYROLL_CAPTION_EVENT, ((event: Event) => {
      const request = parseCrunchyrollCaptionRequest((event as CustomEvent<unknown>).detail);
      if (request) seen.push(`${request.trackId ?? 'off'}:${request.ownedTrackId ?? ''}`);
    }) as EventListener);
    page.win.addEventListener(CRUNCHYROLL_CAPTION_EVENT, handleCrunchyrollCaptionEvent as EventListener);
    try {
      const owned = parseCrunchyrollCaptionRequest(JSON.stringify({
        requestId: 'te-cr-abcdefgh',
        mediaId: MODERN_MEDIA,
        route,
        trackId: null,
        ownedTrackId: 'caption-en-US'
      }));
      assert.equal(owned?.ownedTrackId, 'caption-en-US');
      assert.equal(parseCrunchyrollCaptionRequest(JSON.stringify({
        requestId: 'te-cr-abcdefgh',
        mediaId: MODERN_MEDIA,
        route,
        trackId: null,
        ownedTrackId: 'not a track'
      })), null);
      const both = parseCrunchyrollCaptionRequest(JSON.stringify({
        requestId: 'te-cr-abcdefgh',
        mediaId: MODERN_MEDIA,
        route,
        trackId: null,
        ownedTrackId: 'caption-ja-JP',
        priorOwnedTrackId: 'caption-en-US'
      }));
      assert.equal(both?.ownedTrackId, 'caption-ja-JP');
      assert.equal(both?.priorOwnedTrackId, 'caption-en-US');
      assert.equal(parseCrunchyrollCaptionRequest(JSON.stringify({
        requestId: 'te-cr-abcdefgh',
        mediaId: MODERN_MEDIA,
        route,
        trackId: null,
        ownedTrackId: 'caption-en-US',
        priorOwnedTrackId: 'caption-en-US'
      }))?.priorOwnedTrackId, undefined);
      assert.equal(parseCrunchyrollCaptionRequest(JSON.stringify({
        requestId: 'te-cr-abcdefgh',
        mediaId: MODERN_MEDIA,
        route,
        trackId: null,
        ownedTrackId: 'caption-en-US',
        priorOwnedTrackId: 'not a track'
      })), null);
      const listed = parseCrunchyrollCaptionRequest(JSON.stringify({
        requestId: 'te-cr-abcdefgh',
        mediaId: MODERN_MEDIA,
        route,
        trackId: null,
        ownedTrackId: 'caption-de-DE',
        priorOwnedTrackId: 'caption-ja-JP',
        ownedTrackIds: ['caption-de-DE', 'caption-ja-JP', 'caption-en-US']
      }));
      assert.deepEqual(listed?.ownedTrackIds, ['caption-de-DE', 'caption-ja-JP', 'caption-en-US']);
      const many = Array.from({ length: MAX_CRUNCHYROLL_OWNED_CAPTION_TRACKS }, (_, index) => `caption-${index}`);
      assert.equal(parseCrunchyrollCaptionRequest(JSON.stringify({
        requestId: 'te-cr-abcdefgh',
        mediaId: MODERN_MEDIA,
        route,
        trackId: null,
        ownedTrackId: many[0],
        priorOwnedTrackId: many[1],
        ownedTrackIds: many
      }))?.ownedTrackIds?.length, MAX_CRUNCHYROLL_OWNED_CAPTION_TRACKS);
      assert.equal(parseCrunchyrollCaptionRequest(JSON.stringify({
        requestId: 'te-cr-abcdefgh',
        mediaId: MODERN_MEDIA,
        route,
        trackId: null,
        ownedTrackIds: [...many, 'caption-extra']
      })), null);
      assert.equal(parseCrunchyrollCaptionRequest(JSON.stringify({
        requestId: 'te-cr-abcdefgh',
        mediaId: MODERN_MEDIA,
        route,
        trackId: null,
        ownedTrackIds: ['caption-en-US', 'caption-en-US']
      })), null);
      assert.equal(parseCrunchyrollCaptionRequest(JSON.stringify({
        requestId: 'te-cr-abcdefgh',
        mediaId: MODERN_MEDIA,
        route,
        trackId: null,
        ownedTrackId: 'caption-en-US',
        ownedTrackIds: ['caption-ja-JP', 'caption-en-US']
      })), null);
      assert.equal(parseCrunchyrollCaptionAck(JSON.stringify({
        requestId: 'te-cr-abcdefgh',
        ok: true,
        mediaId: MODERN_MEDIA,
        route,
        trackId: null,
        kept: true
      }))?.kept, true);

      usePlayer(page.doc, MODERN, subtitles);
      const adapter = new CrunchyrollAdapter();
      const menu = await adapter.listCaptionTracks();
      const english = menu.find((track) => track.id.endsWith(':caption-en-US'))!;
      assert.equal((await adapter.activateCaptionTrack(english.id)).status, 'active');
      assert.equal(tracks[0].enabled, true);
      selectJapanese();
      let armed = calls.length;
      adapter.invalidate();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'off');
      assert.equal(calls.length, armed);
      assert.equal(tracks[0].enabled, false);
      assert.equal(tracks[1].enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);
      assert.equal(seen.at(-1), 'off:caption-en-US');

      tracks[1].enabled = false;
      assert.equal((await adapter.activateCaptionTrack(english.id)).status, 'active');
      assert.equal(tracks[0].enabled, true);
      assert.equal(tracks[1].enabled, false);
      adapter.invalidate();
      armed = calls.length;
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'off');
      assert.equal(calls.slice(armed).join(','), 'disable:caption-en-US');
      assert.equal(tracks[0].enabled, false);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);

      assert.equal((await adapter.activateCaptionTrack(english.id)).status, 'active');
      selectJapanese();
      armed = calls.length;
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'off');
      assert.equal(calls.slice(armed).join(','), 'disable:caption-ja-JP');
      assert.equal(tracks[1].enabled, false);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal(seen.at(-1), 'off:');

      assert.equal((await adapter.activateCaptionTrack(english.id)).status, 'active');
      selectJapanese();
      adapter.invalidate();
      const exiting = adapter.activateCaptionTrack(null);
      adapter.dispose();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal((await exiting).status, 'failed');
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal(tracks[1].enabled, true);

      page.location.pathname = route;
      tracks[0].enabled = false;
      tracks[1].enabled = false;
      assert.equal((await adapter.activateCaptionTrack(english.id)).status, 'active');
      selectJapanese();
      adapter.invalidate();
      const moved = adapter.activateCaptionTrack(null);
      page.location.pathname = `/watch/${OTHER}/next`;
      assert.equal((await moved).status, 'failed');
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal(tracks[1].enabled, true);

      page.location.pathname = route;
      tracks[0].enabled = false;
      tracks[1].enabled = false;
      assert.equal((await adapter.activateCaptionTrack(english.id)).status, 'active');
      selectJapanese();
      adapter.invalidate();
      page.attrs.add('data-te-crunchyroll-integration-off');
      armed = calls.length;
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'off');
      assert.equal(calls.length, armed);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal(tracks[1].enabled, true);
      page.attrs.delete('data-te-crunchyroll-integration-off');

      tracks[0].enabled = false;
      tracks[1].enabled = false;
      assert.equal((await adapter.activateCaptionTrack(english.id)).status, 'active');
      selectJapanese();
      adapter.invalidate();
      const integrationOff = adapter.activateCaptionTrack(null);
      page.attrs.add('data-te-crunchyroll-integration-off');
      assert.equal((await integrationOff).status, 'failed');
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal(tracks[1].enabled, true);
    } finally { page.restore(); }
  });

  it('keeps the owned caption visible when automatic Off fails after invalidate', async () => {
    const route = `/watch/${MODERN_MEDIA}/the-journeys-end`;
    const page = installPage(route);
    const tracks = [
      { id: 'caption-en-US', lang: 'en-US', label: 'English', kind: 'subtitle', enabled: false, url: VTT_SIGNED },
      { id: 'caption-ja-JP', lang: 'ja-JP', label: 'Japanese', kind: 'subtitle', enabled: false, url: VTT_JA }
    ];
    let mode = 'work';
    const calls: string[] = [];
    const subtitles = {
      list: () => tracks.map((track) => ({ ...track })),
      enable(id: string) {
        calls.push(`enable:${id}`);
        for (const item of tracks) item.enabled = item.id === id;
      },
      disable(id: string) {
        calls.push(`disable:${id}`);
        if (mode === 'throw-disable') throw new Error('disable failed');
        if (mode === 'noop-disable') return undefined;
        const track = tracks.find((item) => item.id === id);
        if (track) track.enabled = false;
        if (mode === 'lie-after-disable') throw new Error('disabled but the ack failed');
        return undefined;
      }
    };
    page.win.addEventListener(CRUNCHYROLL_CAPTION_EVENT, handleCrunchyrollCaptionEvent as EventListener);
    try {
      usePlayer(page.doc, MODERN, subtitles);
      const adapter = new CrunchyrollAdapter();
      const menu = await adapter.listCaptionTracks();
      const english = menu.find((track) => track.id.endsWith(':caption-en-US'))!;
      const activateEnglish = async () => {
        tracks[0].enabled = false;
        tracks[1].enabled = false;
        mode = 'work';
        assert.equal((await adapter.activateCaptionTrack(english.id)).status, 'active');
        assert.equal(tracks[0].enabled, true);
        assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);
      };

      await activateEnglish();
      mode = 'throw-disable';
      adapter.invalidate();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'failed');
      assert.equal(tracks[0].enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);
      mode = 'work';
      let armed = calls.length;
      adapter.invalidate();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'off');
      assert.equal(calls.slice(armed).join(','), 'disable:caption-en-US');
      assert.equal(tracks[0].enabled, false);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);

      await activateEnglish();
      mode = 'noop-disable';
      adapter.invalidate();
      const offAt = Date.now();
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'failed');
      const offElapsed = Date.now() - offAt;
      assert.ok(offElapsed > CRUNCHYROLL_HOST_CAPTION_SETTLE_MS - 50, `off elapsed ${offElapsed}`);
      assert.ok(offElapsed < CRUNCHYROLL_HOST_CAPTION_SETTLE_MS + 700, `off elapsed ${offElapsed}`);
      assert.equal(tracks[0].enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);

      mode = 'lie-after-disable';
      armed = calls.length;
      adapter.invalidate();
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'failed');
      assert.equal(calls.slice(armed).join(','), 'disable:caption-en-US');
      assert.equal(tracks[0].enabled, false);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);

      await activateEnglish();
      page.holdProbes();
      mode = 'throw-disable';
      adapter.invalidate();
      armed = calls.length;
      const switched = adapter.activateCaptionTrack(null);
      await flush();
      tracks[0].enabled = false;
      tracks[1].enabled = true;
      page.releaseProbes();
      assert.equal((await switched).status, 'failed');
      assert.equal(calls.slice(armed).join(','), 'disable:caption-en-US');
      assert.equal(tracks[0].enabled, false);
      assert.equal(tracks[1].enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);
      adapter.invalidate();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      armed = calls.length;
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'off');
      assert.equal(calls.length, armed);
      assert.equal(tracks[1].enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);

      tracks[1].enabled = false;
      await activateEnglish();
      page.holdProbes();
      mode = 'throw-disable';
      adapter.invalidate();
      const exiting = adapter.activateCaptionTrack(null);
      await flush();
      adapter.dispose();
      page.releaseProbes();
      assert.equal((await exiting).status, 'failed');
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      await flush();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal(tracks[0].enabled, true);

      await activateEnglish();
      page.holdProbes();
      mode = 'throw-disable';
      adapter.invalidate();
      const replaced = adapter.activateCaptionTrack(null);
      await flush();
      adapter.invalidate();
      page.releaseProbes();
      assert.equal((await replaced).status, 'failed');
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      await flush();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal(tracks[0].enabled, true);

      await activateEnglish();
      page.holdProbes();
      mode = 'throw-disable';
      adapter.invalidate();
      const moved = adapter.activateCaptionTrack(null);
      await flush();
      page.location.pathname = `/watch/${OTHER}/next`;
      page.releaseProbes();
      assert.equal((await moved).status, 'failed');
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal(tracks[0].enabled, true);
      page.location.pathname = route;

      await activateEnglish();
      page.holdProbes();
      mode = 'throw-disable';
      adapter.invalidate();
      const integrationOff = adapter.activateCaptionTrack(null);
      await flush();
      page.attrs.add('data-te-crunchyroll-integration-off');
      page.releaseProbes();
      assert.equal((await integrationOff).status, 'failed');
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal(tracks[0].enabled, true);
      page.attrs.delete('data-te-crunchyroll-integration-off');
    } finally {
      page.releaseProbes();
      page.restore();
    }
  });

  it('leaves forced narrative tracks out of host control and visible after explicit Off', async () => {
    const route = `/watch/${MODERN_MEDIA}/the-journeys-end`;
    const page = installPage(route);
    const forced = {
      id: 'caption-forced-en-US',
      lang: 'en-US',
      label: 'English (Forced)',
      kind: 'subtitle',
      enabled: true,
      forced: true,
      url: VTT_FORCED
    };
    const tracks = [
      { id: 'caption-en-US', lang: 'en-US', label: 'English', kind: 'subtitle', enabled: false, forced: false, url: VTT_SIGNED },
      { id: 'caption-ja-JP', lang: 'ja-JP', label: 'Japanese', kind: 'subtitle', enabled: false, forced: false, url: VTT_JA },
      forced
    ];
    const calls: string[] = [];
    const acks: string[] = [];
    const subtitles = {
      list: () => tracks.map((track) => ({ ...track })),
      enable(id: string) {
        calls.push(`enable:${id}`);
        const track = tracks.find((item) => item.id === id);
        if (track) track.enabled = true;
      },
      disable(id: string) {
        calls.push(`disable:${id}`);
        const track = tracks.find((item) => item.id === id);
        if (track) track.enabled = false;
      }
    };
    page.win.addEventListener(CRUNCHYROLL_CAPTION_ACK_EVENT, ((event: Event) => {
      const ack = parseCrunchyrollCaptionAck((event as CustomEvent<unknown>).detail);
      if (ack) acks.push(`${ack.trackId ?? 'off'}:${ack.ok}:${ack.kept === true}`);
    }) as EventListener);
    page.win.addEventListener(CRUNCHYROLL_CAPTION_EVENT, handleCrunchyrollCaptionEvent as EventListener);
    try {
      usePlayer(page.doc, MODERN, subtitles);
      const parsed = parseCrunchyrollHostList(subtitles.list(), MODERN_ASSET);
      assert.equal(parsed.renderer, 'active');
      assert.deepEqual(parsed.tracks.map((track) => track.id), ['caption-en-US', 'caption-ja-JP']);
      const adapter = new CrunchyrollAdapter();
      const menu = await adapter.listCaptionTracks();
      assert.deepEqual(menu.map((track) => track.id), [
        `crunchyroll-host:${MODERN_MEDIA}:caption-en-US`,
        `crunchyroll-host:${MODERN_MEDIA}:caption-ja-JP`
      ]);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);
      assert.equal((await adapter.activateCaptionTrack(`crunchyroll-host:${MODERN_MEDIA}:caption-forced-en-US`)).status, 'failed');
      assert.equal(calls.length, 0);
      let armed = calls.length;
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'off');
      assert.equal(calls.length, armed);
      assert.equal(forced.enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);
      assert.equal(acks.at(-1), 'off:true:true');

      const english = menu[0];
      const japanese = menu[1];
      assert.equal((await adapter.activateCaptionTrack(english.id)).status, 'active');
      assert.equal(tracks[0].enabled, true);
      assert.equal(forced.enabled, true);
      adapter.invalidate();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      armed = calls.length;
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'off');
      assert.equal(calls.slice(armed).join(','), 'disable:caption-en-US');
      assert.equal(tracks[0].enabled, false);
      assert.equal(forced.enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal(acks.at(-1), 'off:true:false');

      assert.equal((await adapter.activateCaptionTrack(english.id)).status, 'active');
      armed = calls.length;
      assert.equal((await adapter.activateCaptionTrack(japanese.id)).status, 'active');
      assert.equal(calls.slice(armed).join(','), 'disable:caption-en-US,enable:caption-ja-JP');
      assert.equal(tracks[0].enabled, false);
      assert.equal(tracks[1].enabled, true);
      assert.equal(forced.enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);
      armed = calls.length;
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'off');
      assert.equal(calls.slice(armed).join(','), 'disable:caption-ja-JP');
      assert.equal(tracks[1].enabled, false);
      assert.equal(forced.enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);
      assert.equal(acks.at(-1), 'off:true:true');
      armed = calls.length;
      adapter.invalidate();
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'off');
      assert.equal(calls.length, armed);
      assert.equal(forced.enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);

      tracks[0].enabled = false;
      tracks[1].enabled = false;
      forced.enabled = false;
      await adapter.reload();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      forced.enabled = true;
      armed = calls.length;
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'off');
      assert.equal(calls.length, armed);
      assert.equal(forced.enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);
      assert.equal((await adapter.listCaptionTracks()).some((track) => track.id.endsWith('caption-forced-en-US')), false);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);

      tracks.splice(0, tracks.length, forced);
      forced.enabled = true;
      const only = new CrunchyrollAdapter();
      assert.deepEqual(await only.listCaptionTracks(), []);
      armed = calls.length;
      assert.equal((await only.activateCaptionTrack(null)).status, 'off');
      assert.equal(calls.length, armed);
      assert.equal(forced.enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      only.dispose();

      tracks.splice(0, tracks.length,
        { id: 'caption-en-US', lang: 'en-US', label: 'English', kind: 'subtitle', enabled: false, forced: false, url: VTT_SIGNED },
        { id: 'caption-ja-JP', lang: 'ja-JP', label: 'Japanese', kind: 'subtitle', enabled: false, forced: false, url: VTT_JA },
        forced
      );
      forced.enabled = true;
      await adapter.reload();
      assert.equal((await adapter.activateCaptionTrack(english.id)).status, 'active');
      assert.equal(tracks[0].enabled, true);
      const exiting = adapter.activateCaptionTrack(null);
      adapter.dispose();
      assert.equal((await exiting).status, 'failed');
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal(forced.enabled, true);
      await flush();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);

      tracks[0].enabled = true;
      forced.enabled = true;
      tracks[1].enabled = false;
      const movedAdapter = new CrunchyrollAdapter();
      await movedAdapter.listCaptionTracks();
      assert.equal((await movedAdapter.activateCaptionTrack(english.id)).status, 'active');
      const moved = movedAdapter.activateCaptionTrack(null);
      page.location.pathname = `/watch/${OTHER}/next`;
      assert.equal((await moved).status, 'failed');
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal(forced.enabled, true);
      page.location.pathname = route;

      tracks[0].enabled = false;
      forced.enabled = true;
      await movedAdapter.reload();
      assert.equal((await movedAdapter.activateCaptionTrack(english.id)).status, 'active');
      const integrationOff = movedAdapter.activateCaptionTrack(null);
      page.attrs.add('data-te-crunchyroll-integration-off');
      assert.equal((await integrationOff).status, 'failed');
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal(forced.enabled, true);
      page.attrs.delete('data-te-crunchyroll-integration-off');
      assert.equal(calls.some((call) => call.includes('caption-forced-en-US')), false);
    } finally { page.restore(); }
  });

  it('stops an oversized Crunchyroll body without a second clone or an arrayBuffer fallback', async () => {
    const runtime = readFileSync(new URL('../../platform/main-world-runtime.ts', import.meta.url), 'utf8');
    assert.match(runtime, /consumeCrunchyrollWrappedFetch\(url, response, foreignProviderHarvestUrl\)/);
    const page = installPage();
    const urlApi = URL as unknown as { createObjectURL?: (obj: Blob) => string; revokeObjectURL?: (url: string) => void };
    const oldCreate = urlApi.createObjectURL;
    const oldRevoke = urlApi.revokeObjectURL;
    let blobCount = 0;
    urlApi.createObjectURL = () => `blob:crunchyroll-bif-${++blobCount}`;
    urlApi.revokeObjectURL = () => {};
    const chunk = (size: number, fill: number) => {
      const bytes = new Uint8Array(size);
      bytes.fill(fill);
      return bytes;
    };
    const counted = (parts: Uint8Array[], hangAt?: number) => {
      let pulls = 0;
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          if (hangAt != null && pulls >= hangAt) return new Promise<void>(() => {});
          const part = parts[pulls - 1];
          if (!part) controller.close();
          else controller.enqueue(part);
          return undefined;
        },
        cancel() {
          cancelled = true;
          return new Promise(() => {});
        }
      }, { highWaterMark: 0 });
      return {
        stream,
        pulls: () => pulls,
        cancelled: () => cancelled,
        response(url: string, contentLength: string | null) {
          return {
            ok: true,
            url,
            headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? contentLength : null) },
            body: stream
          } as unknown as Response;
        }
      };
    };
    try {
      const exact = counted([chunk(8, 1), chunk(8, 2)]);
      globalThis.fetch = ((input: unknown) => Promise.resolve(exact.response(String(input), null))) as typeof fetch;
      const exactBody = await loadCrunchyrollUrl(BIF_SIGNED, 1000, () => true, 'buffer', 16);
      assert.equal(exactBody?.buffer?.byteLength, 16);
      assert.equal(exact.pulls(), 3);
      assert.equal(exact.cancelled(), false);

      const missing = counted([chunk(8, 1), chunk(8, 2), chunk(8, 3)]);
      globalThis.fetch = ((input: unknown) => Promise.resolve(missing.response(String(input), null))) as typeof fetch;
      const missingLength = await loadCrunchyrollUrl(BIF_SIGNED, 1000, () => true, 'buffer', 12);
      assert.equal(missingLength, null);
      assert.equal(missing.pulls(), 2);
      assert.equal(missing.cancelled(), true);

      const lying = counted([chunk(8, 1), chunk(8, 2), chunk(8, 3)]);
      globalThis.fetch = ((input: unknown) => Promise.resolve(lying.response(String(input), '4'))) as typeof fetch;
      const lyingLength = await loadCrunchyrollUrl(SKIP, 1000, () => true, 'text', 12);
      assert.equal(lyingLength, null);
      assert.equal(lying.pulls(), 2);
      assert.equal(lying.cancelled(), true);

      const advertised = counted([chunk(8, 1), chunk(8, 2), chunk(8, 3)]);
      globalThis.fetch = ((input: unknown) => Promise.resolve(advertised.response(String(input), '100'))) as typeof fetch;
      const advertisedOver = await loadCrunchyrollUrl(BIF_SIGNED, 1000, () => true, 'buffer', 16);
      assert.equal(advertisedOver, null);
      assert.equal(advertised.pulls(), 0);
      assert.equal(advertised.cancelled(), true);

      const hanging = counted([chunk(8, 1)], 1);
      globalThis.fetch = ((input: unknown) => Promise.resolve(hanging.response(String(input), null))) as typeof fetch;
      const hangAt = Date.now();
      const hung = await Promise.race([
        loadCrunchyrollUrl(BIF_SIGNED, 40, () => true, 'buffer', 16),
        wait(500).then(() => 'still-hanging' as const)
      ]);
      assert.equal(hung, null);
      assert.ok(Date.now() - hangAt < 400);
      assert.equal(hanging.cancelled(), true);

      const text = new TextEncoder().encode('{"ok":true}');
      globalThis.fetch = ((input: unknown) => Promise.resolve(streamedResponse(text, { url: String(input), contentLength: null }))) as typeof fetch;
      const loadedText = await loadCrunchyrollUrl(SKIP, 1000, () => true, 'text', text.byteLength);
      assert.equal(loadedText?.text, '{"ok":true}');

      globalThis.fetch = (() => Promise.resolve(new Response('', { status: 404 }))) as typeof fetch;
      harvestCrunchyrollData(PLAY, playback());
      await flush();
      await flush();
      assert.equal(readCrunchyrollSnapshot()?.bifBlobUrl, undefined);

      const bif = new Uint8Array(rokuBif([0, 1]));
      let clones = 0;
      let arrayBuffers = 0;
      const passive = new Response(bif);
      const nativeClone = passive.clone.bind(passive);
      passive.clone = () => {
        clones += 1;
        const cloned = nativeClone();
        const readAll = cloned.arrayBuffer.bind(cloned);
        cloned.arrayBuffer = () => {
          arrayBuffers += 1;
          return readAll();
        };
        return cloned;
      };
      assert.equal(consumeCrunchyrollWrappedFetch(BIF_SIGNED, passive, () => false), 'handled');
      assert.equal(clones, 1);
      await flush();
      await flush();
      assert.equal(arrayBuffers, 0);
      assert.equal((await passive.arrayBuffer()).byteLength, bif.byteLength);
      assert.equal(readCrunchyrollSnapshot()?.bifBlobUrl, 'blob:crunchyroll-bif-1');

      let ownedClones = 0;
      globalThis.fetch = ((input: unknown) => {
        const response = streamedResponse(bif, { url: String(input), contentLength: null });
        (response as Response & { clone: () => Response }).clone = () => {
          ownedClones += 1;
          return response;
        };
        assert.equal(consumeCrunchyrollWrappedFetch(String(input), response, () => false), 'handled');
        return Promise.resolve(response);
      }) as typeof fetch;
      const owned = await loadCrunchyrollUrl(BIF_SIGNED, 1000, () => true, 'buffer', bif.byteLength);
      assert.equal(ownedClones, 0);
      assert.equal(owned?.buffer?.byteLength, bif.byteLength);

      let segmentClones = 0;
      let segmentPulls = 0;
      const segment = new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          segmentPulls += 1;
          controller.enqueue(chunk(8, 9));
          controller.close();
        }
      }));
      const segmentClone = segment.clone.bind(segment);
      segment.clone = () => {
        segmentClones += 1;
        return segmentClone();
      };
      const segmentUrl = 'https://vod-fy-mod.crunchyrollcdn.com/static/asset/video.mp4';
      assert.equal(consumeCrunchyrollWrappedFetch(segmentUrl, segment, () => false), 'handled');
      assert.equal(segmentClones, 0);
      assert.equal(segmentPulls, 0);

      const oversized = counted([chunk(8, 4), chunk(8, 4)]);
      let oversizedClones = 0;
      const oversizedResponse = oversized.response(BIF_SIGNED, String(MAX_CRUNCHYROLL_BIF_BYTES + 1));
      (oversizedResponse as Response & { clone: () => Response }).clone = () => {
        oversizedClones += 1;
        return oversizedResponse;
      };
      assert.equal(consumeCrunchyrollWrappedFetch(BIF_SIGNED, oversizedResponse, () => false), 'handled');
      assert.equal(oversizedClones, 0);
      assert.equal(oversized.pulls(), 0);

      const published = blobCount;
      const malformed = streamedResponse(chunk(80, 7), { url: BIF_SIGNED, contentLength: null });
      (malformed as Response & { arrayBuffer: () => Promise<ArrayBuffer>; clone: () => Response; text: () => Promise<string> }).arrayBuffer = () => {
        throw new Error('arrayBuffer');
      };
      (malformed as Response & { clone: () => Response }).clone = () => { throw new Error('clone'); };
      (malformed as Response & { text: () => Promise<string> }).text = () => { throw new Error('text'); };
      captureCrunchyrollNetworkResponse(BIF_SIGNED, malformed);
      await flush();
      await flush();
      assert.equal(blobCount, published);
      assert.equal(readCrunchyrollSnapshot()?.bifBlobUrl, 'blob:crunchyroll-bif-1');

      const lateGate: { release: (() => void) | null } = { release: null };
      const late = new ReadableStream<Uint8Array>({
        start(controller) {
          lateGate.release = () => {
            controller.enqueue(bif);
            controller.close();
          };
        }
      });
      globalThis.fetch = (() => Promise.resolve({
        ok: true,
        url: BIF_SIGNED,
        headers: { get: () => null },
        body: late
      } as unknown as Response)) as typeof fetch;
      const started = loadCrunchyrollUrl(BIF_SIGNED, 1000, () => true, 'buffer', MAX_CRUNCHYROLL_BIF_BYTES);
      page.location.pathname = `/watch/${OTHER}/next`;
      readCrunchyrollSnapshot();
      lateGate.release?.();
      const lateLoaded = await started;
      if (lateLoaded?.buffer) rememberCrunchyrollBif(lateLoaded.buffer, BIF_SIGNED);
      assert.equal(readCrunchyrollSnapshot()?.bifBlobUrl, undefined);
      page.location.pathname = `/watch/${MEDIA}/07-ghost-episode-2`;
      page.attrs.add('data-te-crunchyroll-integration-off');
      assert.equal(readCrunchyrollSnapshot(), null);
      captureCrunchyrollNetworkResponse(BIF_SIGNED, streamedResponse(bif, { url: BIF_SIGNED, contentLength: null }));
      await flush();
      await flush();
      page.attrs.delete('data-te-crunchyroll-integration-off');
      assert.equal(readCrunchyrollSnapshot()?.bifBlobUrl, undefined);
    } finally {
      urlApi.createObjectURL = oldCreate;
      urlApi.revokeObjectURL = oldRevoke;
      page.restore();
    }
  });

  it('keeps a missing subtitle API unknown and does not ack an unreadable list as off', async () => {
    const page = installPage();
    const calls: string[] = [];
    const acks: string[] = [];
    let handlerThrew = false;
    const mount = (subtitles: object | null) => {
      page.doc.querySelectorAll = () => [{
        parentElement: {
          player: {
            getSource: () => ({ dash: CLEAN }),
            ...(subtitles ? { subtitles } : {})
          },
          parentElement: null
        }
      }];
    };
    const off = (requestId: string) => ({
      requestId,
      mediaId: MEDIA,
      route: page.location.pathname,
      trackId: null as null
    });
    page.win.addEventListener(CRUNCHYROLL_CAPTION_ACK_EVENT, ((event: Event) => {
      const ack = parseCrunchyrollCaptionAck((event as CustomEvent<unknown>).detail);
      if (ack) acks.push(`${ack.ok}:${ack.trackId ?? 'off'}`);
    }) as EventListener);
    page.win.addEventListener(CRUNCHYROLL_CAPTION_EVENT, ((event: Event) => {
      try {
        handleCrunchyrollCaptionEvent(event);
      } catch {
        handlerThrew = true;
      }
    }) as EventListener);
    try {
      harvestCrunchyrollData(PLAY, playback({ subtitles: { 'en-US': { url: ASS, format: 'ass' } } }));
      const missing: Array<object | null> = [
        null,
        { enable: () => { calls.push('enable'); }, disable: () => { calls.push('disable'); } },
        { list: () => { calls.push('list'); return []; }, disable: () => { calls.push('disable'); } },
        { list: () => { calls.push('list'); return []; }, enable: () => { calls.push('enable'); } }
      ];
      for (const subtitles of missing) {
        mount(subtitles);
        const snapshot = readCrunchyrollSnapshot();
        assert.equal(snapshot?.rendition, 'clean');
        assert.equal(snapshot?.hostRenderer, 'unknown');
        assert.deepEqual(snapshot?.captionTracks, []);
        assert.equal(crunchyrollAllowsCaptionFetch(ASS), false);
        const adapter = new CrunchyrollAdapter();
        assert.deepEqual(await adapter.listCaptionTracks(), []);
        assert.equal((await adapter.activateCaptionTrack(null)).status, 'off');
        assert.equal((await applyCrunchyrollHostCaption(off('te-cr-missing01'))).ok, false);
      }
      assert.equal(calls.length, 0);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);

      mount({ list: () => [], enable: () => {}, disable: () => {} });
      const empty = readCrunchyrollSnapshot();
      assert.equal(empty?.hostRenderer, 'absent');
      assert.equal(empty?.captionTracks[0]?.url, ASS);
      assert.equal(crunchyrollAllowsCaptionFetch(ASS), true);
      assert.equal((await requestCrunchyrollHostCaption(MEDIA, page.location.pathname, null)).ok, true);
      assert.equal(acks.at(-1), 'true:off');

      const enabled = [{ id: 'caption-en-US', lang: 'en-US', label: 'English', kind: 'subtitle', enabled: true, url: VTT }];
      let mode = 'throw';
      mount({
        list: () => {
          if (mode === 'throw') throw new Error('list failed');
          if (mode === 'object') return { length: 1 };
          if (mode === 'text') return 'nope';
          if (mode === 'null') return null;
          return enabled.map((track) => ({ ...track }));
        },
        enable: (id: string) => { calls.push(`enable:${id}`); },
        disable: (id: string) => { calls.push(`disable:${id}`); }
      });
      for (const next of ['throw', 'object', 'text', 'null'] as const) {
        mode = next;
        assert.equal((await applyCrunchyrollHostCaption(off(`te-cr-${next}list`))).ok, false);
        assert.equal((await applyCrunchyrollHostCaption({
          requestId: 'te-cr-switchfail',
          mediaId: MEDIA,
          route: page.location.pathname,
          trackId: 'caption-en-US'
        })).ok, false);
        assert.equal((await applyCrunchyrollHostCaption({
          requestId: 'te-cr-ownedfail',
          mediaId: MEDIA,
          route: page.location.pathname,
          trackId: null,
          ownedTrackId: 'caption-en-US'
        })).ok, false);
      }
      assert.equal(calls.length, 0);
      mode = 'throw';
      assert.equal((await requestCrunchyrollHostCaption(MEDIA, page.location.pathname, null)).ok, false);
      assert.equal(handlerThrew, false);
      assert.equal(acks.at(-1), 'false:off');

      let reads = 0;
      mount({
        list: () => {
          reads += 1;
          if (reads === 1) return enabled.map((track) => ({ ...track }));
          if (reads === 2) throw new Error('poll failed');
          return enabled.map((track) => ({ ...track }));
        },
        enable: (id: string) => { calls.push(`enable:${id}`); },
        disable: (id: string) => {
          calls.push(`disable:${id}`);
          enabled[0].enabled = false;
        }
      });
      assert.equal((await requestCrunchyrollHostCaption(MEDIA, page.location.pathname, null)).ok, false);
      assert.deepEqual(calls, ['disable:caption-en-US']);
      assert.equal(acks.at(-1), 'false:off');
      assert.equal(handlerThrew, false);

      calls.length = 0;
      page.location.pathname = `/watch/${MODERN_MEDIA}/the-journeys-end`;
      const hostTrack = {
        id: 'caption-en-US',
        lang: 'en-US',
        label: 'English',
        kind: 'subtitle',
        enabled: true,
        url: VTT_SIGNED
      };
      let phase: 'ready' | 'throw-once' | 'throw' = 'ready';
      page.doc.querySelectorAll = () => [{
        parentElement: {
          player: {
            getSource: () => ({ dash: MODERN }),
            subtitles: {
              list: () => {
                if (phase === 'throw-once') {
                  phase = 'ready';
                  throw new Error('off unread');
                }
                if (phase === 'throw') throw new Error('still unread');
                return [{ ...hostTrack }];
              },
              enable: () => { calls.push('enable'); },
              disable: (id: string) => { calls.push(`disable:${id}`); }
            }
          },
          parentElement: null
        }
      }];
      const adapter = new CrunchyrollAdapter();
      assert.equal((await adapter.listCaptionTracks()).length, 1);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);
      phase = 'throw-once';
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'failed');
      assert.equal(calls.some((call) => call.startsWith('disable:')), false);
      assert.equal(hostTrack.enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), true);
      phase = 'throw';
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'failed');
      assert.equal(calls.some((call) => call.startsWith('disable:')), false);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
    } finally { page.restore(); }
  });

  it('turns off only the owned track when the adapter is disposed', async () => {
    const route = `/watch/${MODERN_MEDIA}/the-journeys-end`;
    const page = installPage(route);
    const forced = {
      id: 'caption-forced-en-US',
      lang: 'en-US',
      label: 'English (Forced)',
      kind: 'subtitle',
      enabled: true,
      forced: true,
      url: VTT_FORCED
    };
    const tracks = [
      { id: 'caption-en-US', lang: 'en-US', label: 'English', kind: 'subtitle', enabled: false, forced: false, url: VTT_SIGNED },
      { id: 'caption-ja-JP', lang: 'ja-JP', label: 'Japanese', kind: 'subtitle', enabled: false, forced: false, url: VTT_JA },
      forced
    ];
    let mode = 'work';
    const calls: string[] = [];
    const subtitles = {
      list: () => tracks.map((track) => ({ ...track })),
      enable(id: string) {
        calls.push(`enable:${id}`);
        if (mode === 'throw-enable') throw new Error('enable failed');
        for (const item of tracks) {
          if (item.forced) continue;
          item.enabled = item.id === id;
        }
      },
      disable(id: string) {
        calls.push(`disable:${id}`);
        if (mode === 'throw-disable') throw new Error('disable failed');
        if (mode === 'noop-disable') return undefined;
        const track = tracks.find((item) => item.id === id);
        if (track) track.enabled = false;
      }
    };
    page.win.addEventListener(CRUNCHYROLL_CAPTION_EVENT, handleCrunchyrollCaptionEvent as EventListener);
    try {
      usePlayer(page.doc, MODERN, subtitles);
      const adapter = new CrunchyrollAdapter();
      const english = (await adapter.listCaptionTracks()).find((track) => track.id.endsWith(':caption-en-US'))!;
      const activateEnglish = async () => {
        mode = 'work';
        tracks[0].enabled = false;
        tracks[1].enabled = false;
        assert.equal((await adapter.activateCaptionTrack(english.id)).status, 'active');
        assert.equal(tracks[0].enabled, true);
      };

      await activateEnglish();
      let armed = calls.length;
      adapter.dispose();
      await flush();
      assert.equal(calls.slice(armed).join(','), 'disable:caption-en-US');
      assert.equal(tracks[0].enabled, false);
      assert.equal(forced.enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      armed = calls.length;
      adapter.dispose();
      await flush();
      assert.equal(calls.length, armed);

      await activateEnglish();
      tracks[0].enabled = false;
      tracks[1].enabled = true;
      armed = calls.length;
      adapter.dispose();
      await flush();
      assert.equal(calls.length, armed);
      assert.equal(tracks[1].enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      await flush();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);

      forced.enabled = true;
      await activateEnglish();
      armed = calls.length;
      adapter.dispose();
      await flush();
      assert.equal(calls.slice(armed).join(','), 'disable:caption-en-US');
      assert.equal(tracks[0].enabled, false);
      assert.equal(forced.enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);

      await activateEnglish();
      adapter.invalidate();
      assert.equal(tracks[0].enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      armed = calls.length;
      adapter.dispose();
      await flush();
      assert.equal(calls.slice(armed).join(','), 'disable:caption-en-US');
      assert.equal(tracks[0].enabled, false);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);

      await activateEnglish();
      mode = 'throw-disable';
      adapter.dispose();
      await flush();
      assert.equal(tracks[0].enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      await flush();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);

      mode = 'work';
      tracks[0].enabled = false;
      await activateEnglish();
      mode = 'noop-disable';
      const started = Date.now();
      adapter.dispose();
      await wait(CRUNCHYROLL_HOST_CAPTION_SETTLE_MS + 80);
      assert.ok(Date.now() - started >= CRUNCHYROLL_HOST_CAPTION_SETTLE_MS);
      assert.equal(tracks[0].enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);

      mode = 'work';
      tracks[0].enabled = false;
      await activateEnglish();
      armed = calls.length;
      page.location.pathname = `/watch/${OTHER}/next`;
      adapter.dispose();
      await flush();
      assert.equal(calls.length, armed);
      assert.equal(tracks[0].enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);

      page.location.pathname = route;
      tracks[0].enabled = false;
      await activateEnglish();
      page.attrs.add('data-te-crunchyroll-integration-off');
      armed = calls.length;
      adapter.dispose();
      await flush();
      assert.equal(calls.length, armed);
      assert.equal(tracks[0].enabled, true);
      page.attrs.delete('data-te-crunchyroll-integration-off');

      tracks[0].enabled = false;
      await activateEnglish();
      armed = calls.length;
      adapter.dispose();
      const kept = await requestCrunchyrollHostCaption(MODERN_MEDIA, route, 'caption-en-US');
      assert.equal(kept.ok, true);
      assert.equal(calls.length, armed);
      assert.equal(tracks[0].enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
    } finally { page.restore(); }
  });

  it('turns off a host track whose enable was still waiting when the adapter is disposed', async () => {
    const route = `/watch/${MODERN_MEDIA}/the-journeys-end`;
    const page = installPage(route);
    const forced = {
      id: 'caption-forced-en-US',
      lang: 'en-US',
      label: 'English (Forced)',
      kind: 'subtitle',
      enabled: true,
      forced: true,
      url: VTT_FORCED
    };
    const tracks = [
      { id: 'caption-en-US', lang: 'en-US', label: 'English', kind: 'subtitle', enabled: false, forced: false, url: VTT_SIGNED },
      { id: 'caption-ja-JP', lang: 'ja-JP', label: 'Japanese', kind: 'subtitle', enabled: false, forced: false, url: VTT_JA },
      forced
    ];
    const calls: string[] = [];
    const offs: string[] = [];
    let gateEnable = false;
    let gateDisable = false;
    let throwDisable = false;
    let releaseEnable = () => {};
    let releaseDisable = () => {};
    const subtitles = {
      list: () => tracks.map((track) => ({ ...track })),
      enable(id: string) {
        calls.push(`enable:${id}`);
        const apply = () => {
          for (const item of tracks) {
            if (item.forced) continue;
            item.enabled = item.id === id;
          }
        };
        if (!gateEnable) {
          apply();
          return undefined;
        }
        return new Promise<void>((resolve) => {
          releaseEnable = () => {
            apply();
            resolve();
          };
        });
      },
      disable(id: string) {
        calls.push(`disable:${id}`);
        if (throwDisable) throw new Error('disable failed');
        if (gateDisable) {
          return new Promise<void>((resolve) => {
            releaseDisable = () => resolve();
          });
        }
        const track = tracks.find((item) => item.id === id);
        if (track) track.enabled = false;
        return undefined;
      }
    };
    page.win.addEventListener(CRUNCHYROLL_CAPTION_EVENT, ((event: Event) => {
      const request = parseCrunchyrollCaptionRequest((event as CustomEvent<unknown>).detail);
      if (request?.trackId === null && request.ownedTrackId) {
        offs.push(`${request.ownedTrackId}:${request.priorOwnedTrackId ?? ''}`);
      }
    }) as EventListener);
    page.win.addEventListener(CRUNCHYROLL_CAPTION_EVENT, handleCrunchyrollCaptionEvent as EventListener);
    const englishOn = () => tracks[0].enabled;
    const japaneseOn = () => tracks[1].enabled;
    const reset = () => {
      gateEnable = false;
      gateDisable = false;
      throwDisable = false;
      tracks[0].enabled = false;
      tracks[1].enabled = false;
      forced.enabled = true;
      releaseEnable = () => {};
      releaseDisable = () => {};
    };
    try {
      usePlayer(page.doc, MODERN, subtitles);
      const adapter = new CrunchyrollAdapter();
      const menu = () => adapter.listCaptionTracks();
      const englishId = async () => (await menu()).find((track) => track.id.endsWith(':caption-en-US'))!;
      const japaneseId = async () => (await menu()).find((track) => track.id.endsWith(':caption-ja-JP'))!;

      reset();
      gateEnable = true;
      const pending = adapter.activateCaptionTrack((await englishId()).id);
      await flush();
      assert.equal(calls.join(','), 'enable:caption-en-US');
      adapter.dispose();
      releaseEnable();
      assert.equal((await pending).status, 'failed');
      await flush();
      await flush();
      assert.equal(englishOn(), false);
      assert.equal(forced.enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal(offs.join(','), 'caption-en-US:');
      const afterParent = calls.length;
      adapter.dispose();
      await flush();
      assert.equal(calls.length, afterParent);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);

      calls.length = 0;
      offs.length = 0;
      reset();
      const beforeStart = adapter.activateCaptionTrack((await englishId()).id);
      adapter.dispose();
      assert.equal((await beforeStart).status, 'failed');
      await flush();
      assert.equal(calls.join(','), '');
      assert.equal(englishOn(), false);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);

      calls.length = 0;
      reset();
      gateEnable = true;
      const first = adapter.activateCaptionTrack((await englishId()).id);
      await flush();
      const second = adapter.activateCaptionTrack((await englishId()).id);
      await flush();
      assert.equal(calls.join(','), 'enable:caption-en-US');
      adapter.dispose();
      releaseEnable();
      assert.equal((await first).status, 'failed');
      assert.equal((await second).status, 'failed');
      await flush();
      await flush();
      assert.equal(calls.join(','), 'enable:caption-en-US,disable:caption-en-US');
      assert.equal(englishOn(), false);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);

      calls.length = 0;
      offs.length = 0;
      reset();
      tracks[1].enabled = true;
      const manual = adapter.activateCaptionTrack((await englishId()).id);
      adapter.dispose();
      assert.equal((await manual).status, 'failed');
      await flush();
      assert.equal(calls.join(','), '');
      assert.equal(japaneseOn(), true);
      assert.equal(forced.enabled, true);
      assert.equal(englishOn(), false);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);

      calls.length = 0;
      offs.length = 0;
      reset();
      assert.equal((await adapter.activateCaptionTrack((await englishId()).id)).status, 'active');
      assert.equal(englishOn(), true);
      gateEnable = true;
      const switched = adapter.activateCaptionTrack((await japaneseId()).id);
      await flush();
      assert.equal(calls.includes('enable:caption-ja-JP'), true);
      adapter.dispose();
      releaseEnable();
      assert.equal((await switched).status, 'failed');
      await flush();
      await flush();
      assert.equal(englishOn(), false);
      assert.equal(japaneseOn(), false);
      assert.equal(forced.enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal(offs.at(-1), 'caption-ja-JP:caption-en-US');
      assert.equal(calls.includes('disable:caption-ja-JP'), true);
      assert.equal(calls.some((call) => call.includes('forced')), false);

      calls.length = 0;
      offs.length = 0;
      reset();
      assert.equal((await adapter.activateCaptionTrack((await englishId()).id)).status, 'active');
      const earlySwitch = adapter.activateCaptionTrack((await japaneseId()).id);
      adapter.dispose();
      assert.equal((await earlySwitch).status, 'failed');
      await flush();
      assert.equal(calls.includes('enable:caption-ja-JP'), false);
      assert.equal(englishOn(), false);
      assert.equal(japaneseOn(), false);
      assert.equal(forced.enabled, true);
      assert.equal(offs.at(-1), 'caption-en-US:');
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);

      calls.length = 0;
      offs.length = 0;
      reset();
      assert.equal((await adapter.activateCaptionTrack((await englishId()).id)).status, 'active');
      gateDisable = true;
      const heldSwitch = adapter.activateCaptionTrack((await japaneseId()).id);
      await flush();
      assert.equal(calls.join(','), 'enable:caption-en-US,disable:caption-en-US');
      assert.equal(englishOn(), true);
      adapter.dispose();
      gateDisable = false;
      releaseDisable();
      assert.equal((await heldSwitch).status, 'failed');
      await flush();
      await flush();
      assert.equal(calls.includes('enable:caption-ja-JP'), false);
      assert.equal(englishOn(), false);
      assert.equal(japaneseOn(), false);
      assert.equal(forced.enabled, true);
      assert.equal(offs.at(-1), 'caption-ja-JP:caption-en-US');
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);

      calls.length = 0;
      reset();
      gateEnable = true;
      const superseded = adapter.activateCaptionTrack((await englishId()).id);
      await flush();
      const armed = calls.length;
      adapter.dispose();
      const kept = requestCrunchyrollHostCaption(MODERN_MEDIA, route, 'caption-en-US');
      releaseEnable();
      assert.equal((await superseded).status, 'failed');
      assert.equal((await kept).ok, true);
      await flush();
      assert.equal(calls.length, armed);
      assert.equal(englishOn(), true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      await flush();
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);

      calls.length = 0;
      reset();
      gateEnable = true;
      const failing = adapter.activateCaptionTrack((await englishId()).id);
      await flush();
      throwDisable = true;
      adapter.dispose();
      releaseEnable();
      assert.equal((await failing).status, 'failed');
      await flush();
      await flush();
      assert.equal(englishOn(), true);
      assert.equal(forced.enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);

      calls.length = 0;
      reset();
      gateEnable = true;
      const moved = adapter.activateCaptionTrack((await englishId()).id);
      await flush();
      const movedAt = calls.length;
      page.location.pathname = `/watch/${OTHER}/next`;
      adapter.dispose();
      releaseEnable();
      assert.equal((await moved).status, 'failed');
      await flush();
      assert.equal(calls.length, movedAt);
      assert.equal(englishOn(), true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      page.location.pathname = route;

      calls.length = 0;
      reset();
      gateEnable = true;
      const integrationOff = adapter.activateCaptionTrack((await englishId()).id);
      await flush();
      const integrationAt = calls.length;
      page.attrs.add('data-te-crunchyroll-integration-off');
      adapter.dispose();
      releaseEnable();
      assert.equal((await integrationOff).status, 'failed');
      await flush();
      assert.equal(calls.length, integrationAt);
      assert.equal(englishOn(), true);
      page.attrs.delete('data-te-crunchyroll-integration-off');
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.equal(calls.some((call) => call.includes('forced')), false);
    } finally { page.restore(); }
  });

  it('turns off every unsettled host enable when a later request is still queued', async () => {
    const route = `/watch/${MODERN_MEDIA}/the-journeys-end`;
    const page = installPage(route);
    const forced = {
      id: 'caption-forced-en-US',
      lang: 'en-US',
      label: 'English (Forced)',
      kind: 'subtitle',
      enabled: true,
      forced: true,
      url: VTT_FORCED
    };
    const tracks = [
      { id: 'caption-en-US', lang: 'en-US', label: 'English', kind: 'subtitle', enabled: false, forced: false, url: VTT_SIGNED },
      { id: 'caption-ja-JP', lang: 'ja-JP', label: 'Japanese', kind: 'subtitle', enabled: false, forced: false, url: VTT_JA },
      { id: 'caption-de-DE', lang: 'de-DE', label: 'German', kind: 'subtitle', enabled: false, forced: false, url: VTT_DE },
      forced
    ];
    let release = () => {};
    const calls: string[] = [];
    const named: string[][] = [];
    page.win.addEventListener(CRUNCHYROLL_CAPTION_EVENT, ((event: Event) => {
      const request = parseCrunchyrollCaptionRequest((event as CustomEvent<unknown>).detail);
      if (request?.trackId === null && request.ownedTrackIds?.length) named.push(request.ownedTrackIds);
    }) as EventListener);
    page.win.addEventListener(CRUNCHYROLL_CAPTION_EVENT, handleCrunchyrollCaptionEvent as EventListener);
    try {
      usePlayer(page.doc, MODERN, {
        list: () => tracks.map((track) => ({ ...track })),
        enable(id: string) {
          calls.push(`enable:${id}`);
          return new Promise<void>((resolve) => {
            release = () => {
              for (const item of tracks) {
                if (item.forced) continue;
                item.enabled = item.id === id;
              }
              resolve();
            };
          });
        },
        disable(id: string) {
          calls.push(`disable:${id}`);
          const track = tracks.find((item) => item.id === id);
          if (track) track.enabled = false;
        }
      });
      const adapter = new CrunchyrollAdapter();
      const menu = await adapter.listCaptionTracks();
      const idFor = (trackId: string) => menu.find((track) => track.id.endsWith(`:${trackId}`))!.id;
      const first = adapter.activateCaptionTrack(idFor('caption-en-US'));
      await flush();
      assert.deepEqual(calls, ['enable:caption-en-US']);
      const second = adapter.activateCaptionTrack(idFor('caption-ja-JP'));
      await flush();
      const third = adapter.activateCaptionTrack(idFor('caption-de-DE'));
      await flush();
      adapter.dispose();
      release();
      assert.equal((await first).status, 'failed');
      assert.equal((await second).status, 'failed');
      assert.equal((await third).status, 'failed');
      await flush();
      await flush();
      assert.deepEqual(calls, ['enable:caption-en-US', 'disable:caption-en-US']);
      assert.equal(tracks[0].enabled, false);
      assert.equal(tracks[1].enabled, false);
      assert.equal(tracks[2].enabled, false);
      assert.equal(forced.enabled, true);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);
      assert.deepEqual(named.at(-1)?.slice().sort(), ['caption-de-DE', 'caption-en-US', 'caption-ja-JP']);
      assert.equal(named.at(-1)?.includes('caption-forced-en-US'), false);
      const after = calls.length;
      adapter.dispose();
      await flush();
      assert.equal(calls.length, after);
      assert.equal(page.classes.has(CRUNCHYROLL_HOST_CAPTION_CLASS), false);

      tracks[0].enabled = false;
      tracks[1].enabled = false;
      tracks[2].enabled = true;
      calls.length = 0;
      const manual = await requestCrunchyrollHostCaption(
        MODERN_MEDIA,
        route,
        null,
        page.win as unknown as Window,
        undefined,
        ['caption-en-US', 'caption-ja-JP']
      );
      assert.equal(manual.ok, true);
      assert.equal(manual.kept, true);
      assert.deepEqual(calls, []);
      assert.equal(tracks[2].enabled, true);
      assert.equal(forced.enabled, true);
    } finally { page.restore(); }
  });

  it('does not disable a second owned track after a newer caption request', async () => {
    const route = `/watch/${MODERN_MEDIA}/the-journeys-end`;
    const page = installPage(route);
    const tracks = [
      { id: 'caption-en-US', lang: 'en-US', label: 'English', kind: 'subtitle', enabled: true, url: VTT_SIGNED },
      { id: 'caption-ja-JP', lang: 'ja-JP', label: 'Japanese', kind: 'subtitle', enabled: false, url: VTT_JA }
    ];
    let release = () => {};
    const calls: string[] = [];
    page.win.addEventListener(CRUNCHYROLL_CAPTION_EVENT, handleCrunchyrollCaptionEvent as EventListener);
    try {
      usePlayer(page.doc, MODERN, {
        list: () => tracks.map((track) => ({ ...track })),
        enable(id: string) {
          calls.push(`enable:${id}`);
          tracks.find((track) => track.id === id)!.enabled = true;
        },
        disable(id: string) {
          calls.push(`disable:${id}`);
          if (id === 'caption-en-US') return new Promise<void>((resolve) => { release = resolve; });
          tracks.find((track) => track.id === id)!.enabled = false;
          return undefined;
        }
      });
      const cleanup = requestCrunchyrollHostCaption(
        MODERN_MEDIA,
        route,
        null,
        page.win as unknown as Window,
        undefined,
        'caption-en-US',
        'caption-ja-JP'
      );
      await flush();
      assert.deepEqual(calls, ['disable:caption-en-US']);
      tracks[0].enabled = false;
      tracks[1].enabled = true;
      const newer = requestCrunchyrollHostCaption(MODERN_MEDIA, route, 'caption-ja-JP');
      release();
      await cleanup;
      await newer;
      assert.deepEqual(calls, ['disable:caption-en-US']);
      assert.equal(tracks[1].enabled, true);
    } finally { page.restore(); }
  });

  it('lets the latest BIF win when an older body finishes last', async () => {
    const page = installPage();
    const urlApi = URL as unknown as { createObjectURL?: (obj: Blob) => string; revokeObjectURL?: (url: string) => void };
    const oldCreate = urlApi.createObjectURL;
    const oldRevoke = urlApi.revokeObjectURL;
    let blobCount = 0;
    urlApi.createObjectURL = () => `blob:crunchyroll-bif-${++blobCount}`;
    urlApi.revokeObjectURL = () => {};
    const bifB = BIF_SIGNED.replace('1789659236', '1789659999');
    const bifC = BIF_SIGNED.replace('1789659236', '1789660000');
    const bifD = BIF_SIGNED.replace('1789659236', '1789660001');
    const early = rokuBif([0, 1]);
    const replacement = rokuBif([0, 50], 1000);
    const later = rokuBif([0, 80], 1000);
    const blocked = rokuBif([0, 3], 1000);
    const gates = new Map<string, (response: Response) => void>();
    globalThis.fetch = ((input: unknown) => {
      const url = String(input);
      if (url === BIF_SIGNED || url === bifB || url === bifC || url === bifD) {
        return new Promise<Response>((resolve) => gates.set(url, resolve));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    }) as typeof fetch;
    const hold = (url: string, bytes: ArrayBuffer) => {
      let release = () => {};
      let opened = false;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          release = () => {
            if (opened) return;
            opened = true;
            controller.enqueue(new Uint8Array(bytes));
            controller.close();
          };
        }
      });
      const response = {
        ok: true,
        url,
        headers: { get: () => null },
        body: stream
      } as unknown as Response;
      return { response, release: () => release() };
    };
    try {
      harvestCrunchyrollData(PLAY, playback({ bifs: BIF_SIGNED }));
      await flush();
      harvestCrunchyrollData(PLAY, playback({ bifs: bifB }));
      await flush();
      assert.equal(gates.has(BIF_SIGNED), true);
      assert.equal(gates.has(bifB), true);
      gates.get(bifB)?.(streamedResponse(new Uint8Array(replacement), { url: bifB, contentLength: null }));
      await flush();
      await flush();
      const newest = readCrunchyrollSnapshot()?.bifBlobUrl;
      assert.equal(newest, 'blob:crunchyroll-bif-1');
      gates.get(BIF_SIGNED)?.(streamedResponse(new Uint8Array(early), { url: BIF_SIGNED, contentLength: null }));
      await flush();
      await flush();
      assert.equal(readCrunchyrollSnapshot()?.bifBlobUrl, newest);

      harvestCrunchyrollData(PLAY, playback({ bifs: bifC }));
      await flush();
      gates.get(bifC)?.(streamedResponse(new Uint8Array(later), { url: bifC, contentLength: null }));
      await flush();
      await flush();
      assert.equal(readCrunchyrollSnapshot()?.bifBlobUrl, 'blob:crunchyroll-bif-2');

      harvestCrunchyrollData(PLAY, playback({ bifs: bifD }));
      await flush();
      page.location.search = '?late=1';
      gates.get(bifD)?.(streamedResponse(new Uint8Array(blocked), { url: bifD, contentLength: null }));
      await flush();
      await flush();
      assert.equal(readCrunchyrollSnapshot()?.bifBlobUrl, 'blob:crunchyroll-bif-2');

      page.location.search = '';
      page.attrs.add('data-te-crunchyroll-integration-off');
      readCrunchyrollSnapshot();
      page.attrs.delete('data-te-crunchyroll-integration-off');
      const beforePassive = blobCount;
      const older = hold(BIF_SIGNED, early);
      const newer = hold(bifB, replacement);
      captureCrunchyrollNetworkResponse(BIF_SIGNED, older.response);
      captureCrunchyrollNetworkResponse(bifB, newer.response);
      older.release();
      await flush();
      await flush();
      assert.equal(readCrunchyrollSnapshot()?.bifBlobUrl, undefined);
      noteCrunchyrollManifest(CLEAN_URL);
      assert.equal(readCrunchyrollSnapshot()?.bifBlobUrl, undefined);
      assert.equal(blobCount, beforePassive);
      newer.release();
      await flush();
      await flush();
      assert.equal(readCrunchyrollSnapshot()?.bifBlobUrl, `blob:crunchyroll-bif-${beforePassive + 1}`);
      older.release();
      await flush();
      assert.equal(readCrunchyrollSnapshot()?.bifBlobUrl, `blob:crunchyroll-bif-${beforePassive + 1}`);
      assert.equal(blobCount, beforePassive + 1);
    } finally {
      urlApi.createObjectURL = oldCreate;
      urlApi.revokeObjectURL = oldRevoke;
      page.restore();
    }
  });

  it('keeps a passive BIF body on the route and session that captured it', async () => {
    const page = installPage();
    const urlApi = URL as unknown as { createObjectURL?: (obj: Blob) => string; revokeObjectURL?: (url: string) => void };
    const oldCreate = urlApi.createObjectURL;
    const oldRevoke = urlApi.revokeObjectURL;
    let blobCount = 0;
    urlApi.createObjectURL = () => `blob:crunchyroll-bif-${++blobCount}`;
    urlApi.revokeObjectURL = () => {};
    const otherClean = `https://www.crunchyroll.com/playback/v2/manifest/${OTHER}/static/${ASSET}/1/clean/dash/manifest.mpd`;
    const replacement = BIF_SIGNED.replace('1789659236', '1789659999');
    const hold = (url: string, bytes: ArrayBuffer) => {
      let release = () => {};
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          release = () => {
            controller.enqueue(new Uint8Array(bytes));
            controller.close();
          };
        }
      });
      return {
        response: { ok: true, url, headers: { get: () => null }, body: stream } as unknown as Response,
        release: () => release()
      };
    };
    const publish = async (url: string, bytes: ArrayBuffer) => {
      captureCrunchyrollNetworkResponse(url, streamedResponse(new Uint8Array(bytes), { url, contentLength: null }));
      await flush();
      await flush();
    };
    try {
      noteCrunchyrollManifest(CLEAN_URL);
      const staleRoute = hold(BIF_SIGNED, rokuBif([0, 1]));
      captureCrunchyrollNetworkResponse(BIF_SIGNED, staleRoute.response);
      page.location.search = '?new-route=1';
      staleRoute.release();
      await flush();
      await flush();
      assert.equal(readCrunchyrollSnapshot()?.bifBlobUrl, undefined);

      await publish(BIF_SIGNED, rokuBif([0, 2]));
      assert.equal(readCrunchyrollSnapshot()?.bifBlobUrl, 'blob:crunchyroll-bif-1');

      const acrossReset = hold(replacement, rokuBif([0, 50], 1000));
      captureCrunchyrollNetworkResponse(replacement, acrossReset.response);
      page.attrs.add('data-te-crunchyroll-integration-off');
      assert.equal(readCrunchyrollSnapshot(), null);
      page.attrs.delete('data-te-crunchyroll-integration-off');
      noteCrunchyrollManifest(CLEAN_URL);
      acrossReset.release();
      await flush();
      await flush();
      assert.equal(readCrunchyrollSnapshot()?.bifBlobUrl, undefined);
      await publish(replacement, rokuBif([0, 80], 1000));
      assert.equal(readCrunchyrollSnapshot()?.bifBlobUrl, 'blob:crunchyroll-bif-2');

      page.location.pathname = `/watch/${MEDIA}/07-ghost-episode-2`;
      page.location.search = '';
      page.attrs.add('data-te-crunchyroll-integration-off');
      readCrunchyrollSnapshot();
      page.attrs.delete('data-te-crunchyroll-integration-off');
      const crossedEpisode = hold(BIF_SIGNED, rokuBif([0, 1]));
      captureCrunchyrollNetworkResponse(BIF_SIGNED, crossedEpisode.response);
      page.location.pathname = `/watch/${OTHER}/next`;
      noteCrunchyrollManifest(otherClean);
      crossedEpisode.release();
      await flush();
      await flush();
      const switched = readCrunchyrollSnapshot();
      assert.equal(switched?.mediaId, OTHER);
      assert.equal(switched?.bifBlobUrl, undefined);
      await publish(BIF_SIGNED, rokuBif([0, 4]));
      assert.equal(readCrunchyrollSnapshot()?.bifBlobUrl, 'blob:crunchyroll-bif-3');

      page.location.pathname = `/watch/${MEDIA}/07-ghost-episode-2`;
      page.attrs.add('data-te-crunchyroll-integration-off');
      readCrunchyrollSnapshot();
      page.attrs.delete('data-te-crunchyroll-integration-off');
      await publish(BIF_SIGNED, rokuBif([0, 5]));
      assert.equal(readCrunchyrollSnapshot()?.bifBlobUrl, undefined);
      page.location.search = '?pending=1';
      noteCrunchyrollManifest(CLEAN_URL);
      assert.equal(readCrunchyrollSnapshot()?.bifBlobUrl, undefined);
      await publish(replacement, rokuBif([0, 6], 1000));
      assert.equal(readCrunchyrollSnapshot()?.bifBlobUrl, 'blob:crunchyroll-bif-4');
    } finally {
      urlApi.createObjectURL = oldCreate;
      urlApi.revokeObjectURL = oldRevoke;
      page.restore();
    }
  });
});

function MAX_SAFE_BIF(): boolean {
  return 16 * 1024 * 1024 >= 2069407;
}
