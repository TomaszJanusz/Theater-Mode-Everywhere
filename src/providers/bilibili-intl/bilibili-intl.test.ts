import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyMediaFetchUrl, isAllowedMediaFetchUrl, assertSafeRedirect } from '../../media-features/fetch-allowlist';
import {
  bilibiliIntlCaptionTracks,
  bilibiliIntlPreviewFrame,
  bilibiliIntlShotImageUrl,
  bilibiliIntlSubtitleUrl,
  bilibiliIntlTitle,
  mergeBilibiliIntlSnapshot,
  normalizeBilibiliIntlSnapshot,
  parseBilibiliIntlCaptions,
  parseBilibiliIntlShotIndex,
  parseBilibiliIntlStoryboard
} from '../../media-features/parsers/bilibili-intl';
import { BilibiliIntlAdapter } from './adapter';
import { bilibiliIntlPageId, readBilibiliIntlSnapshot } from './main';
import { createWorldMessage, type WorldEnvelope } from '../../protocol/world-messages';

// English ASS lines and the thumbnail index prefix from
// https://www.bilibili.tv/en/play/1053337 episode 11371243. Drawing line is synthetic.
const ASS = `[Script Info]
ScriptType: v4.00+
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:33.64,0:00:36.33,Default - sample,,0,0,0,,Every object has its spirit.
Dialogue: 0,0:00:47.16,0:00:48.33,Default - sample,,0,0,0,,Since ancient times,
Dialogue: 0,0:04:57.60,0:04:58.35,Default - sample,,0,0,0,,I have\\NDid you notice him?
Dialogue: 0,0:00:14.85,0:00:19.35,5-normal,,0,0,0,,{\\bord0\\c&HF0F0F0&\\fs58\\fad(1000,1000)\\pos(960,411.75)}Adapted from the popular comic book
Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\p1}m 0 0 l 10 0{\\p0}Shown
Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,{\\p1}m 0 0 l 10 0
`;

// First 8 big-endian uint16 values of the live pv_data index.
const SHOT_PREFIX = Uint8Array.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x18, 0x00, 0x1f, 0x00, 0x2e, 0x00, 0x34, 0x00, 0x39, 0x00, 0x3f]);
const SUBTITLE_URL = 'https://s.bstarstatic.com/ogv/subtitle/c350955fde09ca9f62098c78ddf0add4.ass?auth_key=fixture';
const JSON_URL = 'https://s.bstarstatic.com/ogv/subtitle/b57587f25806de4e30ce9d86394f30bc02844aed.json?auth_key=fixture';
const IMAGE = 'https://pic.bstarstatic.com/videoshot/n240826er2gfbhsx7mrzqd1eeshl4f6l.jpg';
const IMAGE_2 = 'https://pic.bstarstatic.com/videoshot/n240826er2gfbhsx7mrzqd1eeshl4f6l-1.jpg';
const BIN = 'https://pic.bstarstatic.com/videoshot/n240826er2gfbhsx7mrzqd1eeshl4f6l.bin';
// Full pv_data for episode 11371243 (189 big-endian uint16s). The last value, 1489, is the end boundary.
const SHOT_INDEX_HEX = '000000000018001f002e00340039003f0045004b006200670076007d00820088008e0094009a009f00a400a900af00b400ba00bf00c400c900ce00d300d900de00ef00f70102010c0116011f0128012e0135013b0141014a01530159015f0166016d017201790183018a01900196019d01a401a901af01b801c501d301de01e401ea01ef01f70206020d0218021d02290235023c02470254025e026a0271027802820288028f029402a002a502ad02b302bd02c702cd02d702dc02e602f002f802ff0309030f0314031a03220328032f03370340034603500356035d0365036b03730379037e0385038a0390039803a103a603ac03b203b903c203cc03d303d903df03e703ee03f303fb0402040a040f041b0427042d04320438043d04460452045904600466046b04700477047f048904900497049d04a504aa04af04b504bb04d004d604dd04e704f404fc0502050905130518051e05230528052e053305380544054c05530558055f0565056b057805800586059f05b805d1';

function vueRef<T>(value: T): { __v_isRef: true; _rawValue: T; _value: T; readonly value: T } {
  return {
    __v_isRef: true,
    _rawValue: value,
    _value: value,
    get value() { return value; }
  };
}

const state = {
  ogv: {
    epId: '11371243',
    season: { season_id: '1053337', title: 'The Last Summoner' },
    sectionsList: [{ episodes: [{ episode_id: '11371243', title_display: 'E1', long_title_display: '' }] }]
  }
};

describe('Bilibili.tv RTE', () => {
  it('parses the observed ASS and JSON cue shapes', () => {
    const cues = parseBilibiliIntlCaptions(ASS);
    assert.deepEqual(cues.map((cue) => cue.text), [
      'Shown',
      'Adapted from the popular comic book',
      'Every object has its spirit.',
      'Since ancient times,',
      'I have\nDid you notice him?'
    ]);
    assert.equal(cues[2].start, 33.64);
    assert.equal(cues[2].end, 36.33);
    assert.deepEqual(parseBilibiliIntlCaptions(JSON.stringify({
      font_size: 0.4,
      body: [
        { from: 33.64, to: 36.33, location: 2, content: 'لكل شيء روحه الخاصة.' },
        { from: 36.83, to: 40.37, content: 'line one\\nline two' },
        { from: 3, to: 3, content: 'bad' }
      ]
    })), [
      { start: 33.64, end: 36.33, text: 'لكل شيء روحه الخاصة.' },
      { start: 36.83, end: 40.37, text: 'line one\nline two' }
    ]);
    // A cue may contain the ASS marker. That must stay JSON, while [Script Info] stays ASS.
    assert.deepEqual(parseBilibiliIntlCaptions(JSON.stringify({
      body: [{ from: 1.25, to: 2.5, content: 'He said Dialogue: hello' }]
    })), [{ start: 1.25, end: 2.5, text: 'He said Dialogue: hello' }]);
    assert.deepEqual(parseBilibiliIntlCaptions('<html>login</html>'), []);
  });

  it('keeps only signed subtitle files and the live thumbnail grid', () => {
    assert.equal(bilibiliIntlSubtitleUrl(SUBTITLE_URL), SUBTITLE_URL);
    assert.equal(bilibiliIntlSubtitleUrl('https://s.bstarstatic.com.evil.test/ogv/subtitle/c350955fde09ca9f62098c78ddf0add4.ass'), null);
    assert.equal(bilibiliIntlSubtitleUrl('https://s.bstarstatic.com/ogv/subtitle/abcd/../c350955fde09ca9f62098c78ddf0add4.ass'), null);
    assert.equal(bilibiliIntlSubtitleUrl('https://s.bstarstatic.com/ogv/foo/../subtitle/c350955fde09ca9f62098c78ddf0add4.ass'), null);
    assert.equal(bilibiliIntlShotImageUrl('https://pic.bstarstatic.com/videoshot/foo/../n240826er2gfbhsx7mrzqd1eeshl4f6l.jpg'), null);
    assert.equal(bilibiliIntlSubtitleUrl('https://api.bilibili.tv/intl/gateway/web/playurl?episode_id=1'), null);
    const tracks = bilibiliIntlCaptionTracks('11371243', {
      subtitles: [
        { url: SUBTITLE_URL, lang: 'English', lang_key: 'en', subtitle_id: 1617629757006 },
        { url: 'https://evil.test/ogv/subtitle/a.ass', lang: 'Bad', lang_key: 'xx' }
      ]
    });
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].id, 'bilibiliIntl:11371243:en:c350955fde09ca9f62098c78ddf0add4.ass');
    assert.equal(tracks[0].label, 'English');
    const legacy = bilibiliIntlCaptionTracks('11371243', {
      video_subtitle: [{ lang_key: 'en', lang: 'English', srt: { url: '' }, ass: { url: SUBTITLE_URL } }]
    });
    assert.equal(legacy[0].url, SUBTITLE_URL);
    assert.deepEqual(classifyMediaFetchUrl(SUBTITLE_URL), { provider: 'bilibiliIntl', kind: 'caption-track', url: SUBTITLE_URL });
    assert.equal(isAllowedMediaFetchUrl({ provider: 'bilibiliIntl', kind: 'caption-track', url: JSON_URL }), true);
    for (const url of [
      'http://s.bstarstatic.com/ogv/subtitle/c350955fde09ca9f62098c78ddf0add4.ass',
      'https://user@s.bstarstatic.com/ogv/subtitle/c350955fde09ca9f62098c78ddf0add4.ass',
      'https://s.bstarstatic.com/ogv/subtitle/../secret.ass',
      'https://s.bstarstatic.com/ogv/subtitle/c350955fde09ca9f62098c78ddf0add4.ass/%2e%2e/secret.ass',
      'https://pic.bstarstatic.com/videoshot/n240826er2gfbhsx7mrzqd1eeshl4f6l.jpg',
      `${SUBTITLE_URL}&next=https://evil.test/a.ass`
    ]) {
      assert.equal(isAllowedMediaFetchUrl({ provider: 'bilibiliIntl', kind: 'caption-track', url }), false, url);
    }
    assert.equal(assertSafeRedirect('https://evil.test/ogv/subtitle/c350955fde09ca9f62098c78ddf0add4.ass', {
      provider: 'bilibiliIntl', kind: 'caption-track', url: SUBTITLE_URL
    }), false);

    const times = parseBilibiliIntlShotIndex(SHOT_PREFIX);
    assert.deepEqual(times, [0, 0, 24, 31, 46, 52, 57, 63]);
    const storyboard = parseBilibiliIntlStoryboard({
      x_len: 10, y_len: 10, x_size: 160, y_size: 90, images: [IMAGE, IMAGE_2], pv_data: BIN
    }, times);
    assert.equal(bilibiliIntlPreviewFrame(storyboard!, 0)?.image.x, 0);
    assert.equal(bilibiliIntlPreviewFrame(storyboard!, 24)?.image.x, 160);
    assert.equal(bilibiliIntlPreviewFrame(storyboard!, 24)?.time, 24);
    assert.equal(bilibiliIntlPreviewFrame(storyboard!, Number.NaN), null);
    const wideTimes = Array.from({ length: 120 }, (_, index) => index);
    const wide = parseBilibiliIntlStoryboard({
      x_len: 10, y_len: 10, x_size: 160, y_size: 90, images: [IMAGE, IMAGE_2]
    }, wideTimes)!;
    const wrapped = bilibiliIntlPreviewFrame(wide, 101)!;
    assert.equal(wrapped.image.url, IMAGE_2);
    assert.equal(wrapped.image.x, 0);
    assert.equal(parseBilibiliIntlStoryboard({ x_len: 10, y_len: 10, x_size: 160, y_size: 90, images: ['https://evil.test/a.jpg'] }, times), null);
    assert.equal(parseBilibiliIntlShotIndex(Uint8Array.from([0x00, 0x02, 0x00, 0x01])), null);
    assert.equal(parseBilibiliIntlStoryboard({
      x_len: 10, y_len: 10, x_size: 160, y_size: 90, images: [IMAGE]
    }, [0, 2, 1]), null);
    assert.equal(parseBilibiliIntlStoryboard({
      x_len: 10, y_len: 10, x_size: 160, y_size: 90, images: [IMAGE]
    }, [0, Number.NaN, 2]), null);
    assert.equal(parseBilibiliIntlStoryboard({
      x_len: 10, y_len: 10, x_size: 160, y_size: 90, images: [IMAGE]
    }, [0, 10]), null);

    const full = parseBilibiliIntlShotIndex(Uint8Array.from(Buffer.from(SHOT_INDEX_HEX, 'hex')))!;
    assert.equal(full.length, 189);
    assert.equal(full[0], 0);
    assert.equal(full.at(-1), 1489);
    const liveBoard = parseBilibiliIntlStoryboard({
      x_len: 10, y_len: 10, x_size: 160, y_size: 90, images: [IMAGE, IMAGE_2]
    }, full)!;
    const lastStart = full[full.length - 2];
    const end = full[full.length - 1];
    const beforeEnd = bilibiliIntlPreviewFrame(liveBoard, end - 0.1)!;
    const atEnd = bilibiliIntlPreviewFrame(liveBoard, end)!;
    const pastDuration = bilibiliIntlPreviewFrame(liveBoard, 1504)!;
    const lastIndex = full.length - 3;
    assert.equal(lastIndex, 186);
    assert.equal(beforeEnd.time, lastStart);
    assert.equal(beforeEnd.image.url, IMAGE_2);
    assert.equal(beforeEnd.image.x, (lastIndex % 10) * 160);
    assert.equal(beforeEnd.image.y, Math.floor((lastIndex % 100) / 10) * 90);
    assert.deepEqual(atEnd.image, beforeEnd.image);
    assert.equal(atEnd.time, lastStart);
    assert.deepEqual(pastDuration.image, beforeEnd.image);
    // Official Da would select index 187 here (one cell past the last tile) because the sheet still has room.
    assert.notEqual(atEnd.image.x, ((lastIndex + 1) % 10) * 160);
    const oneSheet = parseBilibiliIntlStoryboard({
      x_len: 10, y_len: 10, x_size: 160, y_size: 90, images: [IMAGE]
    }, full)!;
    assert.equal(bilibiliIntlPreviewFrame(oneSheet, full[100])?.image.url, IMAGE);
    assert.equal(bilibiliIntlPreviewFrame(oneSheet, full[101]), null);
    assert.equal(bilibiliIntlPreviewFrame(oneSheet, lastStart), null);
  });

  it('names the current episode from page state and does not invent chapters', () => {
    assert.equal(bilibiliIntlTitle(state, 'The Last Summoner E1 - BiliBili'), 'The Last Summoner E1');
    assert.equal(bilibiliIntlTitle({}, 'The Last Summoner E1 - BiliBili'), 'The Last Summoner E1');
    assert.equal(bilibiliIntlTitle({}, 'BiliBili'), null);
    const snapshot = normalizeBilibiliIntlSnapshot('11371243', 'The Last Summoner E1', 1504, {
      subtitles: [{ url: SUBTITLE_URL, lang: 'English', lang_key: 'en' }]
    }, null);
    assert.equal(snapshot.duration, 1504);
    assert.equal(snapshot.captionTracks.length, 1);
    assert.equal(mergeBilibiliIntlSnapshot(snapshot, { ...snapshot, captionTracks: [] })?.captionTracks.length, 1);
    assert.equal(mergeBilibiliIntlSnapshot(snapshot, { ...snapshot, videoId: '9', captionTracks: [] })?.captionTracks.length, 0);
    assert.equal(mergeBilibiliIntlSnapshot(snapshot, null), null);
    const hydrated = {
      ogv: {
        epId: vueRef('11371243'),
        season: vueRef({ season_id: '1053337', title: 'The Last Summoner' }),
        sectionsList: vueRef([{ episodes: [{ episode_id: '11371243', title_display: 'E1' }] }])
      }
    };
    assert.equal(bilibiliIntlTitle(hydrated, 'ignored'), 'The Last Summoner E1');
    const storedOnly = {
      ogv: {
        epId: {
          __v_isRef: true,
          _rawValue: '11371243',
          _value: '11371243',
          get value(): string { throw new Error('getter'); }
        },
        season: vueRef({ title: 'The Last Summoner' }),
        sectionsList: vueRef([{ episodes: [{ episode_id: vueRef('11371243'), title_display: 'E1' }] }])
      }
    };
    assert.equal(bilibiliIntlTitle(storedOnly), 'The Last Summoner E1');
  });

  it('drops a late episode response, ignores play URLs, and honors RTE-off', async () => {
    const oldWindow = globalThis.window;
    const oldDocument = globalThis.document;
    const oldFetch = globalThis.fetch;
    const page = { ...state, ogv: { ...state.ogv, epId: '11371243' } };
    let off = false;
    const attrs = new Map<string, string>();
    const resolvers: Array<(value: Response) => void> = [];
    const requested: string[] = [];
    try {
      globalThis.window = { location: { hostname: 'www.bilibili.tv', pathname: '/en/play/1053337' }, __initialState: page } as any;
      globalThis.document = {
        title: 'The Last Summoner E1 - BiliBili',
        querySelector: () => null,
        documentElement: {
          hasAttribute: (name: string) => name === 'data-te-bilibili-intl-integration-off' ? off : attrs.has(name),
          getAttribute: (name: string) => attrs.get(name) ?? null,
          setAttribute: (name: string, value: string) => { attrs.set(name, value); },
          removeAttribute: (name: string) => { attrs.delete(name); }
        }
      } as any;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        requested.push(url);
        assert.equal(!url.includes('playurl'), true);
        return new Promise<Response>((resolve) => { resolvers.push(resolve); });
      }) as typeof fetch;
      const stale = readBilibiliIntlSnapshot();
      page.ogv.epId = '42';
      for (const resolve of resolvers) resolve(new Response('{"code":0,"data":{}}'));
      assert.equal(await stale, null);
      off = true;
      assert.equal(await readBilibiliIntlSnapshot(), null);
      assert.equal(attrs.has('data-te-bilibili-intl-episode'), false);
      off = false;
      page.ogv.epId = '42';
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        requested.push(url);
        assert.equal(init?.credentials, 'omit');
        if (url.includes('/subtitle')) {
          return new Response(JSON.stringify({ code: 0, data: { subtitles: [
            { url: SUBTITLE_URL, lang: 'English', lang_key: 'en' }
          ] } }));
        }
        if (url.endsWith('.bin')) {
          assert.equal(new URL(url).hostname, 'pic.bstarstatic.com');
          return new Response(SHOT_PREFIX);
        }
        return new Response(JSON.stringify({ code: 0, data: {
          x_len: 10, y_len: 10, x_size: 160, y_size: 90, images: [IMAGE], pv_data: BIN
        } }));
      }) as typeof fetch;
      const fresh = await readBilibiliIntlSnapshot();
      assert.equal(fresh?.videoId, '42');
      assert.equal(fresh?.title, 'The Last Summoner');
      assert.equal(fresh?.captionTracks[0]?.language, 'en');
      assert.equal(fresh?.storyboard?.times[2], 24);
      assert.equal(requested.some((url) => url.includes('playurl')), false);
      assert.equal(
        requested.find((url) => url.includes('/v2/subtitle?') && url.includes('episode_id=42')),
        'https://api.bilibili.tv/intl/gateway/web/v2/subtitle?s_locale=en_US&platform=web&episode_id=42&spm_id=bstar-web.pgc-video-detail.0.0&from_spm_id='
      );
      assert.equal(
        requested.find((url) => url.includes('/v2/video/shot?') && url.includes('episode_id=42')),
        'https://api.bilibili.tv/intl/gateway/web/v2/video/shot?s_locale=en_US&platform=web&episode_id=42'
      );
      assert.equal(attrs.get('data-te-bilibili-intl-episode'), '42');
    } finally {
      off = true;
      await readBilibiliIntlSnapshot().catch(() => {});
      globalThis.window = oldWindow;
      globalThis.document = oldDocument;
      globalThis.fetch = oldFetch;
    }
  });

  it('reads a hydrated Vue initial state on an episode page and ignores upload pages', async () => {
    const oldWindow = globalThis.window;
    const oldDocument = globalThis.document;
    const oldFetch = globalThis.fetch;
    const attrs = new Map<string, string>();
    const page = {
      ogv: {
        epId: vueRef('11371243'),
        season: vueRef({ season_id: '1053337', title: 'The Last Summoner' }),
        sectionsList: vueRef([{ episodes: [{ episode_id: '11371243', title_display: 'E1' }] }])
      }
    };
    try {
      globalThis.window = { location: { hostname: 'www.bilibili.tv', pathname: '/en/play/1053337' }, __initialState: page } as any;
      globalThis.document = {
        title: 'The Last Summoner E1 - BiliBili',
        querySelector: () => ({ duration: 1504 }),
        documentElement: {
          hasAttribute: (name: string) => attrs.has(name),
          getAttribute: (name: string) => attrs.get(name) ?? null,
          setAttribute: (name: string, value: string) => { attrs.set(name, value); },
          removeAttribute: (name: string) => { attrs.delete(name); }
        }
      } as any;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/subtitle')) {
          return new Response(JSON.stringify({ code: 0, data: { subtitles: [
            { url: SUBTITLE_URL, lang: 'English', lang_key: 'en' }
          ] } }));
        }
        if (url.endsWith('.bin')) return new Response(SHOT_PREFIX);
        return new Response(JSON.stringify({ code: 0, data: {
          x_len: 10, y_len: 10, x_size: 160, y_size: 90, images: [IMAGE], pv_data: BIN
        } }));
      }) as typeof fetch;
      const fresh = await readBilibiliIntlSnapshot();
      assert.equal(fresh?.videoId, '11371243');
      assert.equal(fresh?.title, 'The Last Summoner E1');
      assert.equal(fresh?.duration, 1504);
      assert.equal(fresh?.captionTracks[0]?.language, 'en');
      assert.equal(attrs.get('data-te-bilibili-intl-episode'), '11371243');
      (globalThis.window as { location: { pathname: string } }).location.pathname = '/en/video/8848';
      assert.equal(await readBilibiliIntlSnapshot(), null);
      assert.equal(attrs.has('data-te-bilibili-intl-episode'), false);
    } finally {
      (globalThis.window as { location: { pathname: string } }).location.pathname = '/en/video/8848';
      await readBilibiliIntlSnapshot().catch(() => {});
      globalThis.window = oldWindow;
      globalThis.document = oldDocument;
      globalThis.fetch = oldFetch;
    }
  });

  it('reads s_locale from page state or the route, not from a network URL', async () => {
    const oldWindow = globalThis.window;
    const oldDocument = globalThis.document;
    const oldFetch = globalThis.fetch;
    const attrs = new Map<string, string>();
    const requested: string[] = [];
    const page = {
      global: { sLocale: vueRef('th') },
      ogv: {
        epId: vueRef('11371243'),
        season: vueRef({ title: 'The Last Summoner' }),
        sectionsList: vueRef([{ episodes: [{ episode_id: '11371243', title_display: 'E1' }] }])
      }
    };
    try {
      globalThis.window = {
        location: { hostname: 'www.bilibili.tv', pathname: '/en/play/1053337', search: '?bstar_from=pgc.1&episode_id=999' },
        __initialState: page
      } as any;
      globalThis.document = {
        title: 'The Last Summoner E1 - BiliBili',
        querySelector: () => null,
        documentElement: {
          hasAttribute: (name: string) => attrs.has(name),
          getAttribute: (name: string) => attrs.get(name) ?? null,
          setAttribute: (name: string, value: string) => { attrs.set(name, value); },
          removeAttribute: (name: string) => { attrs.delete(name); }
        }
      } as any;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        requested.push(String(input));
        return new Response(JSON.stringify({ code: 0, data: {} }));
      }) as typeof fetch;
      await readBilibiliIntlSnapshot();
      assert.equal(
        requested.find((url) => url.includes('/v2/subtitle?')),
        'https://api.bilibili.tv/intl/gateway/web/v2/subtitle?s_locale=th_TH&platform=web&episode_id=11371243&spm_id=bstar-web.pgc-video-detail.0.0&from_spm_id=pgc.1'
      );
      assert.equal(
        requested.find((url) => url.includes('/v2/video/shot?')),
        'https://api.bilibili.tv/intl/gateway/web/v2/video/shot?s_locale=th_TH&platform=web&episode_id=11371243'
      );
      (globalThis.window as { location: { pathname: string; search: string } }).location.pathname = '/vi/play/1053337';
      (globalThis.window as { location: { search: string } }).location.search = '?bstar_from=https://evil.test/playurl';
      (page.global as { sLocale: unknown }).sLocale = 'not-a-locale';
      attrs.set('data-te-bilibili-intl-integration-off', '');
      await readBilibiliIntlSnapshot();
      attrs.delete('data-te-bilibili-intl-integration-off');
      requested.length = 0;
      await readBilibiliIntlSnapshot();
      assert.equal(requested.some((url) => url.includes('playurl')), false);
      assert.match(requested.find((url) => url.includes('/v2/subtitle?')) || '', /s_locale=vi_VN&platform=web&episode_id=11371243&spm_id=bstar-web\.pgc-video-detail\.0\.0&from_spm_id=$/);
      (globalThis.window as { location: { pathname: string } }).location.pathname = '/ms/play/1053337';
      attrs.set('data-te-bilibili-intl-integration-off', '');
      await readBilibiliIntlSnapshot();
      attrs.delete('data-te-bilibili-intl-integration-off');
      requested.length = 0;
      await readBilibiliIntlSnapshot();
      assert.match(requested.find((url) => url.includes('/v2/subtitle?')) || '', /s_locale=en_MY&platform=web/);
    } finally {
      attrs.set('data-te-bilibili-intl-integration-off', '');
      await readBilibiliIntlSnapshot().catch(() => {});
      globalThis.window = oldWindow;
      globalThis.document = oldDocument;
      globalThis.fetch = oldFetch;
    }
  });

  it('hides both subtitle layers for Off and restores the host layer on exit', async () => {
    const oldWindow = globalThis.window;
    const oldDocument = globalThis.document;
    const attrs = new Map<string, string>();
    const win = Object.assign(new EventTarget(), {
      location: { hostname: 'www.bilibili.tv', origin: 'https://www.bilibili.tv', pathname: '/en/play/1053337' },
      setTimeout, clearTimeout
    });
    globalThis.window = win as any;
    globalThis.document = {
      documentElement: {
        hasAttribute: (name: string) => attrs.has(name),
        getAttribute: (name: string) => attrs.get(name) ?? null,
        setAttribute: (name: string, value: string) => { attrs.set(name, value); },
        removeAttribute: (name: string) => { attrs.delete(name); },
        toggleAttribute: (name: string, on?: boolean) => {
          const next = on ?? !attrs.has(name);
          if (next) attrs.set(name, '');
          else attrs.delete(name);
          return next;
        }
      }
    } as any;
    attrs.set('data-te-bilibili-intl-episode', '11371243');
    win.addEventListener('theater-everywhere-media-probe', (event) => {
      const requestId = (event as CustomEvent).detail.requestId;
      win.dispatchEvent(new CustomEvent('theater-everywhere-bilibili-intl-probe-result', {
        detail: { requestId, bilibiliIntl: normalizeBilibiliIntlSnapshot('11371243', 'The Last Summoner E1', 1504, {
          subtitles: [{ url: SUBTITLE_URL, lang: 'English', lang_key: 'en' }]
        }, null) }
      }));
    });
    (win as any).postMessage = (request: WorldEnvelope) => {
      win.dispatchEvent(Object.assign(new Event('message'), {
        source: win,
        data: createWorldMessage('PAGE_FETCH_RESULT', { ok: true, body: ASS }, request.requestId, request.nonce, request.origin)
      }));
    };
    const adapter = new BilibiliIntlAdapter();
    try {
      const tracks = await adapter.listCaptionTracks();
      const active = await adapter.activateCaptionTrack(tracks[0].id);
      assert.equal(active.status, 'active');
      assert.equal(active.cues[0].text, 'Shown');
      assert.equal(attrs.has('data-te-bilibili-intl-captions-hidden'), true);
      await adapter.activateCaptionTrack(null);
      assert.equal(attrs.has('data-te-bilibili-intl-captions-hidden'), true);
      await adapter.activateCaptionTrack(tracks[0].id);
      attrs.set('data-te-bilibili-intl-integration-off', '');
      await adapter.activateCaptionTrack(null);
      assert.equal(attrs.has('data-te-bilibili-intl-captions-hidden'), false);
      attrs.delete('data-te-bilibili-intl-integration-off');
      await adapter.activateCaptionTrack(tracks[0].id);
      adapter.dispose();
      assert.equal(attrs.has('data-te-bilibili-intl-captions-hidden'), false);
    } finally {
      adapter.dispose();
      globalThis.window = oldWindow;
      globalThis.document = oldDocument;
    }
  });

  it('drops a late subtitle body when the episode changes, captions are turned off, or the adapter is disposed', async () => {
    const oldWindow = globalThis.window;
    const oldDocument = globalThis.document;
    const attrs = new Map<string, string>();
    const win = Object.assign(new EventTarget(), {
      location: { hostname: 'www.bilibili.tv', origin: 'https://www.bilibili.tv', pathname: '/en/play/1053337' },
      setTimeout, clearTimeout
    });
    globalThis.window = win as any;
    globalThis.document = {
      documentElement: {
        hasAttribute: (name: string) => attrs.has(name),
        getAttribute: (name: string) => attrs.get(name) ?? null,
        setAttribute: (name: string, value: string) => { attrs.set(name, value); },
        removeAttribute: (name: string) => { attrs.delete(name); },
        toggleAttribute: (name: string, on?: boolean) => {
          const next = on ?? !attrs.has(name);
          if (next) attrs.set(name, '');
          else attrs.delete(name);
          return next;
        }
      }
    } as any;
    attrs.set('data-te-bilibili-intl-episode', '11371243');
    win.addEventListener('theater-everywhere-media-probe', (event) => {
      const requestId = (event as CustomEvent).detail.requestId;
      win.dispatchEvent(new CustomEvent('theater-everywhere-bilibili-intl-probe-result', {
        detail: { requestId, bilibiliIntl: normalizeBilibiliIntlSnapshot('11371243', 'The Last Summoner E1', 1504, {
          subtitles: [{ url: SUBTITLE_URL, lang: 'English', lang_key: 'en' }]
        }, null) }
      }));
    });
    const deliveries: Array<(body: string) => void> = [];
    (win as any).postMessage = (request: WorldEnvelope) => {
      deliveries.push((body: string) => {
        win.dispatchEvent(Object.assign(new Event('message'), {
          source: win,
          data: createWorldMessage('PAGE_FETCH_RESULT', { ok: true, body }, request.requestId, request.nonce, request.origin)
        }));
      });
    };
    const adapter = new BilibiliIntlAdapter();
    try {
      const tracks = await adapter.listCaptionTracks();
      const changedEpisode = adapter.activateCaptionTrack(tracks[0].id);
      await Promise.resolve();
      assert.equal(deliveries.length, 1);
      attrs.set('data-te-bilibili-intl-episode', '99');
      deliveries[0](ASS);
      assert.equal((await changedEpisode).status, 'failed');
      assert.equal(attrs.has('data-te-bilibili-intl-captions-hidden'), false);

      attrs.set('data-te-bilibili-intl-episode', '11371243');
      const turnedOff = adapter.activateCaptionTrack(tracks[0].id);
      await Promise.resolve();
      assert.equal(deliveries.length, 2);
      await adapter.activateCaptionTrack(null);
      assert.equal(attrs.has('data-te-bilibili-intl-captions-hidden'), true);
      deliveries[1](ASS);
      assert.equal((await turnedOff).status, 'failed');
      assert.equal(attrs.has('data-te-bilibili-intl-captions-hidden'), true);

      const disposed = adapter.activateCaptionTrack(tracks[0].id);
      await Promise.resolve();
      assert.equal(deliveries.length, 3);
      adapter.dispose();
      assert.equal(attrs.has('data-te-bilibili-intl-captions-hidden'), false);
      deliveries[2](ASS);
      assert.equal((await disposed).status, 'failed');
      assert.equal(attrs.has('data-te-bilibili-intl-captions-hidden'), false);
    } finally {
      adapter.dispose();
      globalThis.window = oldWindow;
      globalThis.document = oldDocument;
    }
  });

  it('drops a late subtitle body when a season-only path changes but the episode attribute does not', async () => {
    const oldWindow = globalThis.window;
    const oldDocument = globalThis.document;
    const attrs = new Map<string, string>();
    const hidden = 'data-te-bilibili-intl-captions-hidden';
    const win = Object.assign(new EventTarget(), {
      location: { hostname: 'www.bilibili.tv', origin: 'https://www.bilibili.tv', pathname: '/en/play/1053337' },
      setTimeout, clearTimeout
    });
    globalThis.window = win as any;
    globalThis.document = {
      documentElement: {
        hasAttribute: (name: string) => attrs.has(name),
        getAttribute: (name: string) => attrs.get(name) ?? null,
        setAttribute: (name: string, value: string) => { attrs.set(name, value); },
        removeAttribute: (name: string) => { attrs.delete(name); },
        toggleAttribute: (name: string, on?: boolean) => {
          const next = on ?? !attrs.has(name);
          if (next) attrs.set(name, '');
          else attrs.delete(name);
          return next;
        }
      }
    } as any;
    attrs.set('data-te-bilibili-intl-episode', '11371243');
    win.addEventListener('theater-everywhere-media-probe', (event) => {
      const requestId = (event as CustomEvent).detail.requestId;
      win.dispatchEvent(new CustomEvent('theater-everywhere-bilibili-intl-probe-result', {
        detail: { requestId, bilibiliIntl: normalizeBilibiliIntlSnapshot('11371243', 'The Last Summoner E1', 1504, {
          subtitles: [{ url: SUBTITLE_URL, lang: 'English', lang_key: 'en' }]
        }, null) }
      }));
    });
    const deliveries: Array<(body: string) => void> = [];
    (win as any).postMessage = (request: WorldEnvelope) => {
      deliveries.push((body: string) => {
        win.dispatchEvent(Object.assign(new Event('message'), {
          source: win,
          data: createWorldMessage('PAGE_FETCH_RESULT', { ok: true, body }, request.requestId, request.nonce, request.origin)
        }));
      });
    };
    const adapter = new BilibiliIntlAdapter();
    try {
      const tracks = await adapter.listCaptionTracks();
      const movedSeason = adapter.activateCaptionTrack(tracks[0].id);
      await Promise.resolve();
      assert.equal(deliveries.length, 1);
      win.location.pathname = '/en/play/2000002';
      assert.equal(bilibiliIntlPageId(), '11371243');
      deliveries[0](ASS);
      const stale = await movedSeason;
      assert.equal(stale.status, 'failed');
      assert.deepEqual(stale.cues, []);
      assert.equal(attrs.has(hidden), false);

      win.location.pathname = '/en/play/1053337';
      const samePage = adapter.activateCaptionTrack(tracks[0].id);
      await Promise.resolve();
      assert.equal(deliveries.length, 2);
      deliveries[1](ASS);
      const active = await samePage;
      assert.equal(active.status, 'active');
      assert.equal(active.cues[0].text, 'Shown');
      assert.equal(attrs.has(hidden), true);
    } finally {
      adapter.dispose();
      globalThis.window = oldWindow;
      globalThis.document = oldDocument;
    }
  });

  it('clears the previous episode when the next id, route, or probe does not match', async () => {
    const oldWindow = globalThis.window;
    const oldDocument = globalThis.document;
    const attrs = new Map<string, string>();
    const win = Object.assign(new EventTarget(), {
      location: { hostname: 'www.bilibili.tv', origin: 'https://www.bilibili.tv', pathname: '/en/play/1053337' },
      setTimeout, clearTimeout
    });
    globalThis.window = win as any;
    globalThis.document = {
      documentElement: {
        hasAttribute: (name: string) => attrs.has(name),
        getAttribute: (name: string) => attrs.get(name) ?? null,
        setAttribute: (name: string, value: string) => { attrs.set(name, value); },
        removeAttribute: (name: string) => { attrs.delete(name); },
        toggleAttribute: () => false
      }
    } as any;
    attrs.set('data-te-bilibili-intl-episode', '11371243');
    const replies: Array<(payload: ReturnType<typeof normalizeBilibiliIntlSnapshot> | null) => void> = [];
    win.addEventListener('theater-everywhere-media-probe', (event) => {
      const requestId = (event as CustomEvent).detail.requestId;
      replies.push((payload) => {
        win.dispatchEvent(new CustomEvent('theater-everywhere-bilibili-intl-probe-result', {
          detail: { requestId, bilibiliIntl: payload }
        }));
      });
    });
    const storyboard = parseBilibiliIntlStoryboard({
      x_len: 10, y_len: 10, x_size: 160, y_size: 90, images: [IMAGE]
    }, parseBilibiliIntlShotIndex(SHOT_PREFIX));
    const episode = (id: string, title: string, tracks: boolean) => normalizeBilibiliIntlSnapshot(id, title, 1504, {
      subtitles: tracks ? [{ url: SUBTITLE_URL, lang: 'English', lang_key: 'en' }] : []
    }, storyboard);
    const adapter = new BilibiliIntlAdapter();
    try {
      const listed = adapter.listCaptionTracks();
      replies[0](episode('11371243', 'Old title', true));
      assert.equal((await listed).length, 1);
      assert.equal(adapter.getTitle(), 'Old title');
      assert.equal(adapter.getPreviewFrame(24)?.image.x, 160);

      const refresh = adapter.reload();
      replies[1](episode('11371243', 'Old title refreshed', false));
      await refresh;
      assert.equal((await adapter.listCaptionTracks()).length, 1);
      assert.equal(adapter.getTitle(), 'Old title refreshed');

      attrs.set('data-te-bilibili-intl-episode', '99');
      assert.equal(adapter.getTitle(), null);
      assert.equal(adapter.getPreviewFrame(24), null);
      assert.equal(adapter.mediaId(), null);
      const moved = adapter.reload();
      assert.equal(adapter.getTitle(), null);
      replies.at(-1)!(null);
      await moved;
      assert.equal(adapter.getTitle(), null);
      assert.equal(adapter.mediaId(), null);

      attrs.set('data-te-bilibili-intl-episode', '100');
      const mismatched = adapter.reload();
      replies.at(-1)!(episode('11371243', 'Old title', true));
      await mismatched;
      assert.equal(adapter.getTitle(), null);
      assert.equal(adapter.getPreviewFrame(0), null);

      win.location.pathname = '/en/play/1053337/77';
      attrs.set('data-te-bilibili-intl-episode', '11371243');
      assert.equal(bilibiliIntlPageId(), '77');
      const routed = adapter.reload();
      replies.at(-1)!(episode('11371243', 'Stale attribute', true));
      await routed;
      assert.equal(adapter.getTitle(), null);

      win.location.pathname = '/en/video/8848';
      await adapter.reload();
      assert.equal(bilibiliIntlPageId(), null);
      assert.equal(adapter.getTitle(), null);
    } finally {
      adapter.dispose();
      globalThis.window = oldWindow;
      globalThis.document = oldDocument;
    }
  });

  it('probes a season page before any episode id exists and ignores a stale attribute', async () => {
    const oldWindow = globalThis.window;
    const oldDocument = globalThis.document;
    const attrs = new Map<string, string>();
    const win = Object.assign(new EventTarget(), {
      location: { hostname: 'www.bilibili.tv', origin: 'https://www.bilibili.tv', pathname: '/en/play/1053337', search: '' },
      setTimeout, clearTimeout
    });
    globalThis.window = win as any;
    globalThis.document = {
      documentElement: {
        hasAttribute: (name: string) => attrs.has(name),
        getAttribute: (name: string) => attrs.get(name) ?? null,
        setAttribute: (name: string, value: string) => { attrs.set(name, value); },
        removeAttribute: (name: string) => { attrs.delete(name); },
        toggleAttribute: () => false
      }
    } as any;
    const episode = (id: string, title: string) => normalizeBilibiliIntlSnapshot(id, title, 1504, {
      subtitles: [{ url: SUBTITLE_URL, lang: 'English', lang_key: 'en' }]
    }, null);
    const replies: Array<(publish: string | null, payload: ReturnType<typeof normalizeBilibiliIntlSnapshot> | null) => void> = [];
    win.addEventListener('theater-everywhere-media-probe', (event) => {
      const requestId = (event as CustomEvent).detail.requestId;
      replies.push((publish, payload) => {
        if (publish) attrs.set('data-te-bilibili-intl-episode', publish);
        win.dispatchEvent(new CustomEvent('theater-everywhere-bilibili-intl-probe-result', {
          detail: { requestId, bilibiliIntl: payload }
        }));
      });
    });
    const adapter = new BilibiliIntlAdapter();
    try {
      assert.equal('__initialState' in win, false);
      assert.equal(bilibiliIntlPageId(), null);
      const listed = adapter.listCaptionTracks();
      assert.equal(replies.length, 1);
      replies[0]('11371243', episode('11371243', 'The Last Summoner E1'));
      assert.equal((await listed).length, 1);
      assert.equal(adapter.getTitle(), 'The Last Summoner E1');
      assert.equal(bilibiliIntlPageId(), '11371243');

      const moved = adapter.reload();
      win.location.pathname = '/en/play/42';
      replies.at(-1)!('11371243', episode('11371243', 'The Last Summoner E1'));
      await moved;
      assert.equal(adapter.getTitle(), null);
      assert.equal(adapter.mediaId(), null);

      win.location.pathname = '/en/play/1053337/11371243';
      const rerouted = adapter.reload();
      win.location.pathname = '/en/play/1053337/77';
      replies.at(-1)!('11371243', episode('11371243', 'The Last Summoner E1'));
      await rerouted;
      assert.equal(adapter.getTitle(), null);

      win.location.pathname = '/en/play/2000002';
      attrs.set('data-te-bilibili-intl-episode', '555');
      assert.equal(bilibiliIntlPageId(), '555');
      const current = adapter.reload();
      replies.at(-1)!('11371243', episode('11371243', 'Current season'));
      await current;
      assert.equal(adapter.getTitle(), 'Current season');
      assert.equal(adapter.mediaId(), '11371243');
      assert.equal((await adapter.listCaptionTracks()).length, 1);

      const unpublished = adapter.reload();
      replies.at(-1)!('999', episode('11371243', 'Wrong id'));
      await unpublished;
      assert.equal(adapter.getTitle(), null);

      attrs.set('data-te-bilibili-intl-integration-off', '');
      const disabled = adapter.reload();
      assert.equal(replies.length, 5);
      attrs.delete('data-te-bilibili-intl-integration-off');
      await disabled;
      assert.equal(adapter.getTitle(), null);
    } finally {
      adapter.dispose();
      globalThis.window = oldWindow;
      globalThis.document = oldDocument;
    }
  });

  it('does not hide host captions when Off or dispose wins the first probe, or when activation fails', async () => {
    const oldWindow = globalThis.window;
    const oldDocument = globalThis.document;
    const attrs = new Map<string, string>();
    const win = Object.assign(new EventTarget(), {
      location: { hostname: 'www.bilibili.tv', origin: 'https://www.bilibili.tv', pathname: '/en/play/1053337', search: '' },
      setTimeout, clearTimeout
    });
    globalThis.window = win as any;
    globalThis.document = {
      documentElement: {
        hasAttribute: (name: string) => attrs.has(name),
        getAttribute: (name: string) => attrs.get(name) ?? null,
        setAttribute: (name: string, value: string) => { attrs.set(name, value); },
        removeAttribute: (name: string) => { attrs.delete(name); },
        toggleAttribute: (name: string, on?: boolean) => {
          const next = on ?? !attrs.has(name);
          if (next) attrs.set(name, '');
          else attrs.delete(name);
          return next;
        }
      }
    } as any;
    const snapshot = normalizeBilibiliIntlSnapshot('11371243', 'The Last Summoner E1', 1504, {
      subtitles: [{ url: SUBTITLE_URL, lang: 'English', lang_key: 'en' }]
    }, null);
    const replies: Array<() => void> = [];
    win.addEventListener('theater-everywhere-media-probe', (event) => {
      const requestId = (event as CustomEvent).detail.requestId;
      replies.push(() => {
        attrs.set('data-te-bilibili-intl-episode', '11371243');
        win.dispatchEvent(new CustomEvent('theater-everywhere-bilibili-intl-probe-result', {
          detail: { requestId, bilibiliIntl: snapshot }
        }));
      });
    });
    (win as any).postMessage = (request: WorldEnvelope) => {
      win.dispatchEvent(Object.assign(new Event('message'), {
        source: win,
        data: createWorldMessage('PAGE_FETCH_RESULT', { ok: true, body: '<html>login</html>' }, request.requestId, request.nonce, request.origin)
      }));
    };
    const trackId = snapshot.captionTracks[0].id;
    const adapter = new BilibiliIntlAdapter();
    const duringDispose = new BilibiliIntlAdapter();
    const afterFailure = new BilibiliIntlAdapter();
    try {
      const cancelled = adapter.activateCaptionTrack(trackId);
      await Promise.resolve();
      assert.equal(replies.length, 1);
      await adapter.activateCaptionTrack(null);
      replies[0]();
      assert.equal((await cancelled).status, 'failed');
      assert.equal(attrs.has('data-te-bilibili-intl-captions-hidden'), false);

      const disposed = duringDispose.activateCaptionTrack(trackId);
      await Promise.resolve();
      assert.equal(replies.length, 2);
      duringDispose.dispose();
      replies[1]();
      assert.equal((await disposed).status, 'failed');
      assert.equal(attrs.has('data-te-bilibili-intl-captions-hidden'), false);

      const tracks = afterFailure.listCaptionTracks();
      replies[2]();
      assert.equal((await tracks).length, 1);
      const failed = await afterFailure.activateCaptionTrack(trackId);
      assert.equal(failed.status, 'failed');
      assert.equal(attrs.has('data-te-bilibili-intl-captions-hidden'), false);
      await afterFailure.activateCaptionTrack(null);
      assert.equal(attrs.has('data-te-bilibili-intl-captions-hidden'), false);
      await afterFailure.activateCaptionTrack(null);
      assert.equal(attrs.has('data-te-bilibili-intl-captions-hidden'), true);
    } finally {
      adapter.dispose();
      duringDispose.dispose();
      afterFailure.dispose();
      globalThis.window = oldWindow;
      globalThis.document = oldDocument;
    }
  });

  it('lets only the latest caption selection change host fallback when requests overlap', async () => {
    const oldWindow = globalThis.window;
    const oldDocument = globalThis.document;
    const attrs = new Map<string, string>();
    const hidden = 'data-te-bilibili-intl-captions-hidden';
    const win = Object.assign(new EventTarget(), {
      location: { hostname: 'www.bilibili.tv', origin: 'https://www.bilibili.tv', pathname: '/en/play/1053337' },
      setTimeout, clearTimeout
    });
    globalThis.window = win as any;
    globalThis.document = {
      documentElement: {
        hasAttribute: (name: string) => attrs.has(name),
        getAttribute: (name: string) => attrs.get(name) ?? null,
        setAttribute: (name: string, value: string) => { attrs.set(name, value); },
        removeAttribute: (name: string) => { attrs.delete(name); },
        toggleAttribute: (name: string, on?: boolean) => {
          const next = on ?? !attrs.has(name);
          if (next) attrs.set(name, '');
          else attrs.delete(name);
          return next;
        }
      }
    } as any;
    attrs.set('data-te-bilibili-intl-episode', '11371243');
    const arabic = JSON.stringify({ body: [{ from: 1, to: 2, content: 'سطر جديد' }] });
    win.addEventListener('theater-everywhere-media-probe', (event) => {
      const requestId = (event as CustomEvent).detail.requestId;
      win.dispatchEvent(new CustomEvent('theater-everywhere-bilibili-intl-probe-result', {
        detail: { requestId, bilibiliIntl: normalizeBilibiliIntlSnapshot('11371243', 'The Last Summoner E1', 1504, {
          subtitles: [
            { url: SUBTITLE_URL, lang: 'English', lang_key: 'en' },
            { url: JSON_URL, lang: 'العربية', lang_key: 'ar' }
          ]
        }, null) }
      }));
    });
    const deliveries: Array<{ url: string; send: (body: string) => void }> = [];
    (win as any).postMessage = (request: WorldEnvelope) => {
      deliveries.push({
        url: String(request.payload.url),
        send: (body: string) => {
          win.dispatchEvent(Object.assign(new Event('message'), {
            source: win,
            data: createWorldMessage('PAGE_FETCH_RESULT', { ok: true, body }, request.requestId, request.nonce, request.origin)
          }));
        }
      });
    };
    const take = (url: string) => {
      const index = deliveries.findIndex((item) => item.url === url);
      assert.notEqual(index, -1, url);
      return deliveries.splice(index, 1)[0];
    };
    const adapter = new BilibiliIntlAdapter();
    try {
      const tracks = await adapter.listCaptionTracks();
      const english = tracks.find((track) => track.language === 'en');
      const arabicTrack = tracks.find((track) => track.language === 'ar');
      assert.ok(english && arabicTrack);

      const cancelledSuccess = adapter.activateCaptionTrack(english.id);
      await Promise.resolve();
      assert.equal(deliveries.length, 1);
      const latestFailure = adapter.activateCaptionTrack(arabicTrack.id);
      await Promise.resolve();
      assert.equal(deliveries.length, 2);
      take(SUBTITLE_URL).send(ASS);
      const staleSuccess = await cancelledSuccess;
      assert.equal(staleSuccess.status, 'failed');
      assert.deepEqual(staleSuccess.cues, []);
      assert.equal(attrs.has(hidden), false);
      take(JSON_URL).send('<html>login</html>');
      const failedLatest = await latestFailure;
      assert.equal(failedLatest.status, 'failed');
      assert.deepEqual(failedLatest.cues, []);
      assert.equal(attrs.has(hidden), false);
      // Controller cleanup after the failed latest selection keeps the host layer up.
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'off');
      assert.equal(attrs.has(hidden), false);

      const older = adapter.activateCaptionTrack(english.id);
      await Promise.resolve();
      assert.equal(deliveries.length, 1);
      const newer = adapter.activateCaptionTrack(arabicTrack.id);
      await Promise.resolve();
      assert.equal(deliveries.length, 2);
      take(JSON_URL).send(arabic);
      const newerResult = await newer;
      assert.equal(newerResult.status, 'active');
      assert.deepEqual(newerResult.cues, [{ start: 1, end: 2, text: 'سطر جديد' }]);
      assert.equal(attrs.has(hidden), true);
      take(SUBTITLE_URL).send('<html>login</html>');
      const olderResult = await older;
      assert.equal(olderResult.status, 'failed');
      assert.deepEqual(olderResult.cues, []);
      assert.equal(attrs.has(hidden), true);
      // A stale failure must not arm host fallback, or this cleanup would uncover it.
      assert.equal((await adapter.activateCaptionTrack(null)).status, 'off');
      assert.equal(attrs.has(hidden), true);
    } finally {
      for (const delivery of deliveries) delivery.send('');
      adapter.dispose();
      globalThis.window = oldWindow;
      globalThis.document = oldDocument;
    }
  });
});
