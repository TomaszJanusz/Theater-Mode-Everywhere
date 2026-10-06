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
  parseCrunchyrollSkipEvents,
  summarizeCrunchyrollBif
} from '../../media-features/parsers/crunchyroll';
import { serviceHomeUrl } from '../../platform/service-home';
import { createWorldMessage, type WorldEnvelope } from '../../protocol/world-messages';
import { isCrunchyrollHost } from '../hosts';
import { CrunchyrollAdapter } from './adapter';
import { CRUNCHYROLL_HOST_CAPTION_CLASS, CRUNCHYROLL_HOST_CAPTION_SELECTOR } from './host-surface';
import {
  applyCrunchyrollHostCaption,
  captureCrunchyrollNetworkResponse,
  CRUNCHYROLL_CAPTION_ACK_TIMEOUT_MS,
  CRUNCHYROLL_HARVEST_EVENT,
  CRUNCHYROLL_HOST_CAPTION_SETTLE_MS,
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
  win.addEventListener('theater-everywhere-media-probe', (event) => {
    const requestId = (event as CustomEvent<{ requestId: number }>).detail.requestId;
    win.dispatchEvent(new CustomEvent('theater-everywhere-media-probe-result', {
      detail: { requestId, crunchyroll: readCrunchyrollSnapshot() }
    }));
  });
  return {
    win, attrs, classes, location, doc, requested,
    fetches: () => fetches,
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
      usePlayer(page.doc, CLEAN);
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
        return Promise.resolve({
          ok: true,
          url: BIF_SIGNED,
          headers: { get: () => null },
          arrayBuffer: async () => buffer,
          text: async () => ''
        });
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
      globalThis.fetch = (() => Promise.resolve({
        ok: true,
        url: BIF,
        headers: { get: () => null },
        arrayBuffer: async () => buffer,
        text: async () => ''
      })) as unknown as typeof fetch;
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
      usePlayer(page.doc, CLEAN);
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
      usePlayer(page.doc, CLEAN);
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
      assert.equal(await applyCrunchyrollHostCaption({
        requestId: 'te-cr-abcdefgh',
        mediaId: MODERN_MEDIA,
        route: `/watch/${MODERN_MEDIA}/the-journeys-end`,
        trackId: 'caption-en-US'
      }), false);
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
        return Promise.resolve({
          ok: true,
          url: BIF_SIGNED,
          headers: { get: () => null },
          arrayBuffer: async () => buffer,
          text: async () => ''
        });
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
        return Promise.resolve({
          ok: true,
          url: BIF_SIGNED,
          headers: { get: () => null },
          arrayBuffer: async () => buffer,
          text: async () => ''
        } as unknown as Response);
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

  it('parses the flattened ASS cue without positioning', () => {
    assert.equal(parseCrunchyrollCaptionBody(ASS_BODY, 'ass')[0]?.text, 'Hello there');
  });
});

function MAX_SAFE_BIF(): boolean {
  return 16 * 1024 * 1024 >= 2069407;
}
