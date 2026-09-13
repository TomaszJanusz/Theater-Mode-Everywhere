import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { captionPreferenceHost, findPreferredCaptionTrack, languagesCompatible, resolveCaptionPreferenceMap } from './caption-preference';
import { computeCaptionDockBottom, CAPTION_DOCK_REST_BOTTOM } from './caption-dock';
import { classifyCaptionWord, findActiveCues, visibleCaptionLines } from './cue-index';
import { isAllowedMediaFetchUrl } from './fetch-allowlist';
import { defaultMediaProviderFlags, resolveMediaProviderFlags } from './provider-flags';
import { shouldAttachPatreonAdapter, shouldAttachTwitchAdapter, shouldAttachVimeoAdapter, shouldAttachYouTubeAdapter } from './resolve-adapter';
import { createTimedtextCacheRecord, findCachedTimedtextBody, mergeYoutubeCaptionAuth, timedtextHasPot, timedtextVideoId, youtubePageVideoId, youtubeSnapshotMatchesPage } from './youtube-caption-url';
import { NativeTextTrackAdapter, cuesFromTrack, parseNativeTrackPayload } from './native-adapter';
import { parseCaptionPayload, parseSrt, parseWebVtt } from './parsers/captions';
import { parseYoutubeDescriptionChapters } from './parsers/youtube-chapters';
import { getStoryboardFrame, parseStoryboardSpec } from './parsers/youtube-storyboard';
import { getVimeoPreviewFrame, parseVimeoThumbPreview } from './parsers/vimeo-thumbs';
import { getMuxPreviewFrame, parseMuxStoryboard } from './parsers/mux-storyboard';
import { parsePatreonPageAssets, pickPatreonPageAssets, applyPatreonCaptionMeta, mergePatreonCaptionTracks } from './parsers/patreon-page';
import { getTwitchPreviewFrame, parseTwitchSeekPreviews } from './parsers/twitch-storyboard';
import { collectTwitchStoryboardUrls, extractTwitchPayloadFromJson, parseTwitchPageAssets, twitchPageVideoId } from './parsers/twitch-page';
import { preferProviderCaptionTracks } from './composite-adapter';
import { sanitizeCaptionCueText, sanitizeCaptionText } from './sanitize';

describe('caption parsers', () => {
  it('parses WebVTT including multiline cues', () => {
    const cues = parseWebVtt(`WEBVTT

00:00:01.000 --> 00:00:03.000
Hello
world

NOTE ignored

00:00:04.000 --> 00:00:06.500
Second`);
    assert.equal(cues.length, 2);
    assert.equal(cues[0].text, 'Hello\nworld');
    assert.equal(cues[0].start, 1);
    assert.equal(cues[1].end, 6.5);
  });

  it('parses Mux transcript WebVTT with cue identifiers', () => {
    const cues = parseWebVtt(`WEBVTT

1
00:00:00.000 --> 00:00:03.360
Hello friends

2
00:00:03.360 --> 00:00:05.000
Welcome back`);
    assert.equal(cues.length, 2);
    assert.equal(cues[0].text, 'Hello friends');
    assert.equal(cues[1].start, 3.36);
  });

  it('parses SRT and overlapping cues', () => {
    const cues = parseSrt(`1
00:00:00,000 --> 00:00:02,000
One

2
00:00:01,000 --> 00:00:03,000
Two`);
    assert.equal(cues.length, 2);
    assert.deepEqual(findActiveCues(cues, 1.5).map((cue) => cue.text), ['One', 'Two']);
  });

  it('parses TTML and YouTube timedtext', () => {
    const ttml = parseCaptionPayload(`<tt><body><p begin="00:00:01.000" end="00:00:02.000">Hi <span>there</span></p></body></tt>`);
    assert.equal(ttml[0].text, 'Hi there');
    const timed = parseCaptionPayload(`<transcript><text start="1.5" dur="2">A &amp; B</text></transcript>`);
    assert.equal(timed[0].start, 1.5);
    assert.equal(timed[0].end, 3.5);
    assert.equal(timed[0].text, 'A & B');
  });

  it('parses YouTube VTT, json3, and srv3 payloads', () => {
    const vtt = parseWebVtt(`WEBVTT
Kind: captions
Language: en

00:00:00.080 --> 00:00:02.000 align:start position:0%
Hello <c>world</c>`);
    assert.equal(vtt[0].text, 'Hello world');
    assert.equal(vtt[0].start, 0.08);

    const json3 = parseCaptionPayload(JSON.stringify({
      events: [
        { tStartMs: 1500, dDurationMs: 2000, segs: [{ utf8: 'Hi' }, { utf8: ' there' }] },
        { tStartMs: 4000, dDurationMs: 0, segs: [{ utf8: 'Later' }] }
      ]
    }));
    assert.equal(json3[0].text, 'Hi there');
    assert.equal(json3[0].end, 3.5);
    assert.equal(json3[1].end, 6);

    const rollup = parseCaptionPayload(JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 5000, segs: [{ utf8: 'One' }] },
        { tStartMs: 1000, dDurationMs: 5000, segs: [{ utf8: 'Two' }] },
        { tStartMs: 2000, dDurationMs: 5000, segs: [{ utf8: 'Three' }] },
        { tStartMs: 2500, aAppend: 1, dDurationMs: 1000, segs: [{ utf8: ' more' }] }
      ]
    }));
    assert.equal(rollup.length, 3);
    assert.equal(rollup[0].end, 2);
    assert.equal(rollup[2].text, 'Three more');
    assert.deepEqual(visibleCaptionLines(rollup, 2.1).map((cue) => cue.text), ['Two', 'Three more']);

    const srv3 = parseCaptionPayload('<timedtext format="3"><body><p t="160" d="2270">A &amp; B</p></body></timedtext>');
    assert.equal(srv3[0].start, 0.16);
    assert.equal(srv3[0].end, 2.43);
    assert.equal(srv3[0].text, 'A & B');
  });

  it('keeps YouTube json3 word timestamps', () => {
    const cues = parseCaptionPayload(JSON.stringify({
      events: [{
        tStartMs: 1000,
        dDurationMs: 2000,
        segs: [
          { utf8: 'Three', tOffsetMs: 0 },
          { utf8: ' mobsters', tOffsetMs: 320 },
          { utf8: ' are', tOffsetMs: 740 }
        ]
      }]
    }));
    assert.equal(cues[0].text, 'Three mobsters are');
    assert.equal(cues[0].words?.length, 3);
    assert.equal(cues[0].words?.[1].start, 1.32);
    assert.equal(classifyCaptionWord(cues[0].words || [], 1, 1.4), 'current');
    assert.equal(classifyCaptionWord(cues[0].words || [], 2, 1.4), 'upcoming');
  });

  it('strips caption HTML and malformed input', () => {
    assert.equal(sanitizeCaptionText('<b onclick="alert(1)">Hi</b>'), 'Hi');
    assert.equal(parseWebVtt('not a caption file').length, 0);
    assert.equal(parseSrt('').length, 0);
  });

  it('keeps cue line breaks while stripping VTT tags', () => {
    assert.equal(sanitizeCaptionCueText('Hello<br>world'), 'Hello\nworld');
    assert.equal(sanitizeCaptionCueText('Hello <c>world</c>\nnext line'), 'Hello world\nnext line');
    assert.equal(parseNativeTrackPayload(`WEBVTT

00:00:01.000 --> 00:00:03.000
Usted nunca los ve
a través de su sitio web.`)[0].text, 'Usted nunca los ve\na través de su sitio web.');
  });
});

describe('youtube chapter parser', () => {
  const description = `Intro
00:00 Intro
01:00 Architecture
00:12:30 Deep dive`;

  it('accepts official timestamp rules', () => {
    const chapters = parseYoutubeDescriptionChapters(description, 20 * 60);
    assert.equal(chapters.length, 3);
    assert.equal(chapters[0].start, 0);
    assert.equal(chapters[1].title, 'Architecture');
    assert.equal(chapters[1].end, 12 * 60 + 30);
    assert.equal(chapters[2].end, 20 * 60);
  });

  it('rejects fewer than three, missing 00:00, or short segments', () => {
    assert.equal(parseYoutubeDescriptionChapters('00:00 A\n00:20 B').length, 0);
    assert.equal(parseYoutubeDescriptionChapters('00:10 A\n00:20 B\n00:40 C').length, 0);
    assert.equal(parseYoutubeDescriptionChapters('00:00 A\n00:05 B\n00:40 C').length, 0);
  });

  it('drops timestamps past duration', () => {
    assert.equal(parseYoutubeDescriptionChapters(description, 30).length, 0);
  });
});

describe('youtube storyboard parser', () => {
  const spec = 'https://i9.ytimg.com/sb/abc/storyboard3_L$L/$N.jpg|48#27#100#10#10#0#default#sig0|80#45#108#10#10#2000#M$M#sig1|160#90#108#5#5#2000#M$M#sig2';

  it('maps hover time onto a sprite tile without a new URL per frame', () => {
    const set = parseStoryboardSpec(spec, 216);
    assert.ok(set);
    const first = getStoryboardFrame(set!, 0, 160);
    const nearby = getStoryboardFrame(set!, 3, 160);
    assert.ok(first && nearby);
    assert.equal(first!.image.url, nearby!.image.url);
    assert.equal(first!.image.tileWidth, 160);
    assert.match(first!.image.url, /^https:\/\/i9\.ytimg\.com\/sb\/abc\/storyboard3_L2\/M0\.jpg/);
  });

  it('rejects non-ytimg hosts', () => {
    assert.equal(parseStoryboardSpec('https://evil.example/L$L/$N.jpg|160#90#10#5#5#1000#M$M#sig', 10), null);
  });
});

describe('vimeo thumb preview parser', () => {
  const spec = {
    url: 'https://videoapi-sprites.vimeocdn.com/video-sprites/image/abc.0.webp?Expires=1&Signature=sig',
    width: 4686,
    height: 2640,
    frameWidth: 426,
    frameHeight: 240,
    columns: 11,
    frames: 120
  };

  it('maps hover time onto a sprite tile without a new URL per nearby frame', () => {
    const sprite = parseVimeoThumbPreview(spec, 635);
    assert.ok(sprite);
    const first = getVimeoPreviewFrame(sprite!, 0, 635);
    const nearby = getVimeoPreviewFrame(sprite!, 4, 635);
    assert.ok(first && nearby);
    assert.equal(first!.image.url, nearby!.image.url);
    assert.equal(first!.image.x, 0);
    assert.equal(first!.image.y, 0);
    assert.equal(first!.image.tileWidth, 426);
    assert.equal(first!.image.sheetWidth, 4686);
    const later = getVimeoPreviewFrame(sprite!, 60, 635);
    assert.ok(later);
    assert.equal(later!.image.url, first!.image.url);
    assert.notEqual(later!.image.x + later!.image.y, 0);
  });

  it('rejects non-vimeocdn hosts', () => {
    assert.equal(parseVimeoThumbPreview({ ...spec, url: 'https://evil.example/abc.0.webp' }, 10), null);
  });
});

describe('mux storyboard parser', () => {
  const vtt = `WEBVTT

00:00:00.000 --> 00:01:06.067
https://image.mux.com/Dk8pvMnvTeqDk9dy5nqmXz02MM4YtdElW/storyboard.jpg#xywh=0,0,256,160

00:01:06.067 --> 00:02:14.067
https://image.mux.com/Dk8pvMnvTeqDk9dy5nqmXz02MM4YtdElW/storyboard.jpg#xywh=256,0,256,160
`;

  it('maps hover time onto a sprite tile and infers sheet size from xywh', () => {
    const set = parseMuxStoryboard(vtt);
    assert.ok(set);
    assert.equal(set!.cues.length, 2);
    const first = getMuxPreviewFrame(set!, 0);
    const nearby = getMuxPreviewFrame(set!, 30);
    const later = getMuxPreviewFrame(set!, 80);
    assert.ok(first && nearby && later);
    assert.equal(first!.image.url, nearby!.image.url);
    assert.equal(first!.image.x, 0);
    assert.equal(first!.image.sheetWidth, 512);
    assert.equal(first!.image.sheetHeight, 160);
    assert.equal(later!.image.x, 256);
    assert.equal(later!.image.tileWidth, 256);
  });

  it('parses Mux JSON storyboards', () => {
    const set = parseMuxStoryboard(JSON.stringify({
      url: 'https://image.mux.com/Dk8pvMnvTeqDk9dy5nqmXz02MM4YtdElW/storyboard.webp',
      tile_width: 256,
      tile_height: 160,
      duration: 134.067,
      tiles: [
        { start: 0, x: 0, y: 0 },
        { start: 66.067, x: 256, y: 0 }
      ]
    }));
    assert.ok(set);
    const later = getMuxPreviewFrame(set!, 90);
    assert.ok(later);
    assert.equal(later!.image.x, 256);
    assert.equal(later!.image.sheetWidth, 512);
    assert.match(later!.image.url, /^https:\/\/image\.mux\.com\//);
  });

  it('rejects non-mux image hosts', () => {
    assert.equal(parseMuxStoryboard(`WEBVTT

00:00:00.000 --> 00:00:05.000
https://evil.example/storyboard.jpg#xywh=0,0,256,160
`), null);
  });
});

describe('youtube page video identity', () => {
  it('reads watch, shorts, embed, live, and youtu.be URLs', () => {
    assert.equal(youtubePageVideoId('https://www.youtube.com/watch?v=abc123&list=PLtest'), 'abc123');
    assert.equal(youtubePageVideoId('https://www.youtube.com/shorts/shortid01'), 'shortid01');
    assert.equal(youtubePageVideoId('https://www.youtube.com/embed/embedid01'), 'embedid01');
    assert.equal(youtubePageVideoId('https://www.youtube.com/live/liveid01'), 'liveid01');
    assert.equal(youtubePageVideoId('https://youtu.be/shortlink1'), 'shortlink1');
  });

  it('hides stale snapshots when the page video id changes', () => {
    assert.equal(youtubeSnapshotMatchesPage('oldVideo', 'newVideo'), false);
    assert.equal(youtubeSnapshotMatchesPage('sameVideo', 'sameVideo'), true);
    assert.equal(youtubeSnapshotMatchesPage(undefined, 'newVideo'), true);
    assert.equal(youtubeSnapshotMatchesPage('oldVideo', null), true);
  });
});

describe('youtube caption URL auth', () => {
  it('copies pot from a player timedtext URL onto a caption baseUrl', () => {
    const base = 'https://www.youtube.com/api/timedtext?v=abc&exp=xpe&lang=en&fmt=json3';
    const signed = 'https://www.youtube.com/api/timedtext?v=abc&exp=xpe&lang=en&pot=TOKEN%3D&potc=1&c=WEB&cver=2.20250613.00.00';
    const merged = new URL(mergeYoutubeCaptionAuth(base, signed));
    assert.equal(merged.searchParams.get('pot'), 'TOKEN=');
    assert.equal(merged.searchParams.get('potc'), '1');
    assert.equal(merged.searchParams.get('c'), 'WEB');
    assert.equal(merged.searchParams.get('fmt'), 'json3');
    assert.equal(merged.searchParams.get('lang'), 'en');
    assert.equal(timedtextVideoId(base), 'abc');
    assert.equal(timedtextHasPot(base), false);
    assert.equal(timedtextHasPot(signed), true);
  });

  it('reuses a same-video timedtext body when lang/kind/fmt differ', () => {
    const cached = createTimedtextCacheRecord(
      'https://www.youtube.com/api/timedtext?v=abc&caps=asr&hl=en-GB&fmt=json3',
      '{"events":[]}'
    );
    const ad = createTimedtextCacheRecord(
      'https://www.youtube.com/api/timedtext?v=adid&lang=en&fmt=json3',
      '{"events":[{"tStartMs":0}]}'
    );
    const records = [cached, ad].filter((item): item is NonNullable<typeof item> => Boolean(item));
    const body = findCachedTimedtextBody(
      records,
      'https://www.youtube.com/api/timedtext?v=abc&lang=en&kind=asr&fmt=json3'
    );
    assert.equal(body, '{"events":[]}');
  });
});

describe('fetch allowlist', () => {
  it('allows only youtube timedtext https URLs', () => {
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'youtube',
      kind: 'caption-track',
      url: 'https://www.youtube.com/api/timedtext?v=abc'
    }), true);
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'youtube',
      kind: 'caption-track',
      url: 'https://example.com/api/timedtext'
    }), false);
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'youtube',
      kind: 'caption-track',
      url: 'http://www.youtube.com/api/timedtext'
    }), false);
  });

  it('allows only Mux storyboard metadata on image.mux.com', () => {
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'patreon',
      kind: 'storyboard-vtt',
      url: 'https://image.mux.com/abc123/storyboard.vtt?token=x&format=webp'
    }), true);
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'patreon',
      kind: 'storyboard-json',
      url: 'https://image.mux.com/abc123/storyboard.json'
    }), true);
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'patreon',
      kind: 'storyboard-vtt',
      url: 'https://image.mux.com/abc123/storyboard.jpg'
    }), false);
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'patreon',
      kind: 'storyboard-vtt',
      url: 'https://evil.example/abc123/storyboard.vtt'
    }), false);
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'patreon',
      kind: 'caption-track',
      url: 'https://stream.mux.com/abc123/text/trackid.vtt?token=x'
    }), true);
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'patreon',
      kind: 'caption-track',
      url: 'https://stream.mux.com/abc123.m3u8?token=x'
    }), false);
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'patreon',
      kind: 'caption-track',
      url: 'https://evil.example/abc123/text/trackid.vtt'
    }), false);
  });

  it('allows only Twitch storyboard JSON and caption VTT on known CDNs', () => {
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'twitch',
      kind: 'storyboard-json',
      url: 'https://static-cdn.jtvnw.net/cf_vods/abc/storyboards/635475444-info.json'
    }), true);
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'twitch',
      kind: 'storyboard-json',
      url: 'https://vod-secure.twitch.tv/abc/storyboards/635475444-info.json'
    }), true);
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'twitch',
      kind: 'storyboard-json',
      url: 'https://d2nvs31859zcd8.cloudfront.net/abc/storyboards/2870679210-info.json'
    }), true);
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'twitch',
      kind: 'storyboard-json',
      url: 'https://static-cdn.jtvnw.net/cf_vods/abc/storyboards/635475444-0.jpg'
    }), false);
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'twitch',
      kind: 'storyboard-json',
      url: 'https://static-cdn.jtvnw.net/cf_vods/abc/playlist.m3u8'
    }), false);
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'twitch',
      kind: 'caption-track',
      url: 'https://captions.twitch.tv/en/abc.vtt'
    }), true);
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'twitch',
      kind: 'caption-track',
      url: 'https://gql.twitch.tv/gql'
    }), false);
  });
});

describe('patreon page asset parser', () => {
  const html = String.raw`{"playback_id":"PlayId01","storyboard":{"vtt_url":"https:\/\/image.mux.com\/PlayId01\/storyboard.vtt?token=abc","json_url":"https:\/\/image.mux.com\/PlayId01\/storyboard.json?token=abc"},"transcript_url":"https:\/\/stream.mux.com\/PlayId01\/text\/TrackId01.vtt?token=abc"}
{"playback_id":"OtherId02","storyboard":{"vtt_url":"https://image.mux.com/OtherId02/storyboard.vtt?token=def"}}`;

  it('extracts signed Mux storyboard and caption URLs, including escaped JSON', () => {
    const assets = parsePatreonPageAssets(html);
    const play = pickPatreonPageAssets(assets, 'PlayId01');
    assert.ok(play);
    assert.equal(play!.storyboardVttUrl, 'https://image.mux.com/PlayId01/storyboard.vtt?token=abc');
    assert.equal(play!.storyboardJsonUrl, 'https://image.mux.com/PlayId01/storyboard.json?token=abc');
    assert.equal(play!.captions.length, 1);
    assert.equal(play!.captions[0].url, 'https://stream.mux.com/PlayId01/text/TrackId01.vtt?token=abc');
    const other = pickPatreonPageAssets(assets, 'OtherId02');
    assert.equal(other?.captions.length, 0);
    assert.equal(other?.storyboardVttUrl, 'https://image.mux.com/OtherId02/storyboard.vtt?token=def');
    const unicode = parsePatreonPageAssets(
      'https:\\u002F\\u002Fimage.mux.com\\u002FUniId03\\u002Fstoryboard.vtt?token=ghi'
    );
    assert.equal(pickPatreonPageAssets(unicode, 'UniId03')?.storyboardVttUrl, 'https://image.mux.com/UniId03/storyboard.vtt?token=ghi');
  });

  it('ignores stream manifests and non-mux hosts', () => {
    const assets = parsePatreonPageAssets(`
      https://stream.mux.com/PlayId01.m3u8?token=abc
      https://evil.example/PlayId01/storyboard.vtt?token=abc
      https://evil.example/PlayId01/text/TrackId01.vtt?token=abc
    `);
    assert.equal(assets.length, 0);
  });

  it('merges duplicate Mux caption URLs and copies host track labels', () => {
    const merged = mergePatreonCaptionTracks(
      [{
        id: 'patreon:PlayId01:TrackId01',
        url: 'https://stream.mux.com/PlayId01/text/TrackId01.vtt?token=abc',
        language: '',
        label: 'Captions'
      }],
      [{
        id: 'patreon-hls:0',
        url: 'https://stream.mux.com/PlayId01/text/TrackId01.vtt?token=xyz',
        language: 'en',
        label: 'English (auto-generated)',
        autoGenerated: true
      }]
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0].language, 'en');
    assert.equal(merged[0].label, 'English (auto-generated)');
    assert.equal(merged[0].autoGenerated, true);

    const labeled = applyPatreonCaptionMeta(
      [{
        id: 'patreon:PlayId01:TrackId01',
        url: 'https://stream.mux.com/PlayId01/text/TrackId01.vtt?token=abc',
        language: '',
        label: 'Captions'
      }],
      [{ language: 'en', label: 'English (auto-generated)', autoGenerated: true }]
    );
    assert.equal(labeled[0].label, 'English (auto-generated)');
    assert.equal(labeled[0].language, 'en');
    assert.equal(labeled[0].autoGenerated, true);
  });
});

describe('caption track merge', () => {
  it('hides native HTML5 tracks when Patreon already exposes the same sidecar', () => {
    const tracks = preferProviderCaptionTracks([
      {
        id: 'native:0',
        language: 'en',
        label: 'English (auto-generated)',
        kind: 'captions',
        source: 'native-text-track',
        autoGenerated: true
      },
      {
        id: 'patreon:PlayId01:TrackId01',
        language: 'en',
        label: 'English (auto-generated)',
        kind: 'captions',
        source: 'patreon',
        autoGenerated: true
      }
    ]);
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].source, 'patreon');
  });

  it('hides native HTML5 tracks when Twitch already exposes a sidecar', () => {
    const tracks = preferProviderCaptionTracks([
      {
        id: 'native:0',
        language: 'en',
        label: 'English',
        kind: 'captions',
        source: 'native-text-track'
      },
      {
        id: 'twitch:en:abc',
        language: 'en',
        label: 'English',
        kind: 'captions',
        source: 'twitch'
      }
    ]);
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].source, 'twitch');
  });
});

describe('twitch page and storyboard parsers', () => {
  const storyboardJson = JSON.stringify([
    {
      width: 160,
      height: 90,
      count: 8,
      rows: 2,
      cols: 2,
      images: [
        'https://static-cdn.jtvnw.net/cf_vods/abc/storyboards/635475444-0.jpg',
        'https://static-cdn.jtvnw.net/cf_vods/abc/storyboards/635475444-1.jpg'
      ]
    }
  ]);

  it('reads VOD ids from /videos/{id} and embed ?video=', () => {
    assert.equal(twitchPageVideoId('https://www.twitch.tv/videos/635475444'), '635475444');
    assert.equal(twitchPageVideoId('https://player.twitch.tv/?video=v635475444'), '635475444');
    assert.equal(twitchPageVideoId('https://www.twitch.tv/shroud'), null);
  });

  it('does not guess a homepage VOD when the URL has no video id', () => {
    const assets = parseTwitchPageAssets(
      '{"seekPreviewsURL":"https://static-cdn.jtvnw.net/cf_vods/abc/storyboards/635475444-info.json","positionMilliseconds":0,"durationMilliseconds":1000,"description":"Just Chatting"}',
      'https://www.twitch.tv/shroud'
    );
    assert.equal(assets.videoId, null);
    assert.equal(assets.seekPreviewsURL, undefined);
    assert.equal(assets.moments.length, 0);
  });

  it('extracts seekPreviewsURL, moments, and caption VTT from page JSON', () => {
    const html = String.raw`{"id":"635475444","lengthSeconds":120,"seekPreviewsURL":"https:\/\/static-cdn.jtvnw.net\/cf_vods\/abc\/storyboards\/635475444-info.json","moments":{"edges":[{"node":{"positionMilliseconds":0,"durationMilliseconds":60000,"description":"Just Chatting"}},{"node":{"positionMilliseconds":60000,"durationMilliseconds":60000,"description":"VALORANT"}}]}}
https://captions.twitch.tv/en/635475444.vtt`;
    const assets = parseTwitchPageAssets(html, 'https://www.twitch.tv/videos/635475444');
    assert.equal(assets.videoId, '635475444');
    assert.equal(assets.duration, 120);
    assert.equal(assets.seekPreviewsURL, 'https://static-cdn.jtvnw.net/cf_vods/abc/storyboards/635475444-info.json');
    assert.equal(assets.moments.length, 2);
    assert.equal(assets.moments[1].title, 'VALORANT');
    assert.equal(assets.moments[1].start, 60);
    assert.equal(assets.captions.length, 1);
    assert.equal(assets.captions[0].url, 'https://captions.twitch.tv/en/635475444.vtt');
  });

  it('maps sprite tiles from seekPreviews JSON', () => {
    const set = parseTwitchSeekPreviews(
      storyboardJson,
      80,
      'https://static-cdn.jtvnw.net/cf_vods/abc/storyboards/635475444-info.json'
    );
    assert.ok(set);
    const frame = getTwitchPreviewFrame(set!, 50, 80);
    assert.ok(frame);
    assert.equal(frame!.image.url, 'https://static-cdn.jtvnw.net/cf_vods/abc/storyboards/635475444-1.jpg');
    assert.equal(frame!.image.x, 160);
    assert.equal(frame!.image.y, 0);
  });

  it('rejects HLS and off-host sprite URLs', () => {
    assert.equal(parseTwitchSeekPreviews(JSON.stringify([{
      width: 160,
      height: 90,
      count: 4,
      rows: 2,
      cols: 2,
      images: ['https://evil.example/storyboards/x-0.jpg']
    }]), 40, 'https://static-cdn.jtvnw.net/cf_vods/abc/storyboards/635475444-info.json'), null);
  });

  it('builds storyboard URLs from cf_vods thumbs and relative sprite names', () => {
    const urls = collectTwitchStoryboardUrls(
      'https://static-cdn.jtvnw.net/cf_vods/d2nvs31859zcd8/cba4ade3acdcd9e03eff_fuslie_317424009975_1789073127/thumb/custom.png',
      '2870679210'
    );
    assert.equal(
      urls[0],
      'https://d2nvs31859zcd8.cloudfront.net/cba4ade3acdcd9e03eff_fuslie_317424009975_1789073127/storyboards/2870679210-info.json'
    );
    assert.ok(urls.includes(
      'https://vod-secure.twitch.tv/cba4ade3acdcd9e03eff_fuslie_317424009975_1789073127/storyboards/2870679210-info.json'
    ));
    const set = parseTwitchSeekPreviews(JSON.stringify([{
      count: 200,
      width: 220,
      height: 124,
      rows: 10,
      cols: 5,
      interval: 150,
      images: ['2870679210-high-0.jpg', '2870679210-high-1.jpg']
    }]), 0, urls[0]);
    assert.ok(set);
    assert.equal(set!.duration, 30000);
    assert.equal(
      set!.images[0],
      'https://d2nvs31859zcd8.cloudfront.net/cba4ade3acdcd9e03eff_fuslie_317424009975_1789073127/storyboards/2870679210-high-0.jpg'
    );
    const frame = getTwitchPreviewFrame(set!, 15000, 30000);
    assert.ok(frame);
    assert.equal(frame!.image.url, set!.images[1]);
  });

  it('reads chapters and seekPreviewsURL from Twitch GQL video payloads', () => {
    const payload = extractTwitchPayloadFromJson([
      { data: { video: { id: '2830719929', lengthSeconds: 3600, seekPreviewsURL: 'https://d2nvs31859zcd8.cloudfront.net/assetid/storyboards/2830719929-info.json' } } },
      { data: { video: { id: '2830719929', moments: { edges: [
        { node: { positionMilliseconds: 0, durationMilliseconds: 120000, description: 'Intro' } },
        { node: { positionMilliseconds: 120000, durationMilliseconds: 600000, description: 'Boss fight' } }
      ] } } } }
    ], '2830719929');
    assert.equal(payload.duration, 3600);
    assert.equal(payload.seekPreviewsURL, 'https://d2nvs31859zcd8.cloudfront.net/assetid/storyboards/2830719929-info.json');
    assert.equal(payload.moments?.length, 2);
    assert.equal(payload.moments?.[1].title, 'Boss fight');
    assert.equal(payload.moments?.[1].start, 120);
  });

  it('keeps CloudFront seekPreviewsURL and derives it from cf_vods thumbs', () => {
    const html = 'https://static-cdn.jtvnw.net/cf_vods/d3vd9lfkzbru3h/6426ad31284a42844348_jaice_315847840872_1785197564//thumb/thumb2-640x360.jpg';
    const urls = collectTwitchStoryboardUrls(html, '2830719929');
    assert.equal(
      urls[0],
      'https://d3vd9lfkzbru3h.cloudfront.net/6426ad31284a42844348_jaice_315847840872_1785197564/storyboards/2830719929-info.json'
    );
    const payload = extractTwitchPayloadFromJson({
      data: {
        video: {
          id: '2830719929',
          moments: {
            edges: [{
              node: {
                id: '1154bb86d20c7af9a8bbf27b6672d9c2',
                moments: { edges: [] },
                durationMilliseconds: 5005000,
                positionMilliseconds: 0,
                description: 'Just Chatting',
                video: { id: '2830719929', lengthSeconds: 18430 }
              }
            }, {
              node: {
                id: '636e5766ce63ba5bcf32ce8d7ef6dd4e',
                moments: { edges: [] },
                durationMilliseconds: 13249000,
                positionMilliseconds: 5005000,
                description: 'Cyberpunk 2077',
                video: { id: '2830719929', lengthSeconds: 18430 }
              }
            }]
          }
        }
      }
    }, '2830719929');
    assert.equal(payload.moments?.length, 2);
    assert.equal(payload.moments?.[1].title, 'Cyberpunk 2077');
    assert.equal(payload.moments?.[1].start, 5005);
  });
});

describe('caption dock', () => {
  const viewport = { viewportWidth: 1280, viewportHeight: 800 };
  const captionSize = { width: 240, height: 44 };

  it('stays at rest when nothing overlaps the caption box', () => {
    const bottom = computeCaptionDockBottom({
      captionSize,
      obstacles: [{ left: 40, right: 88, top: 420, bottom: 640 }],
      ...viewport
    });
    assert.equal(bottom, CAPTION_DOCK_REST_BOTTOM);
  });

  it('lifts above the chrome when the bar covers centered captions', () => {
    const bottom = computeCaptionDockBottom({
      captionSize,
      obstacles: [{ left: 24, right: 1256, top: 724, bottom: 776 }],
      ...viewport
    });
    assert.equal(bottom, 800 - 724 + 12);
  });

  it('ignores a side popover after clearing the chrome', () => {
    const bottom = computeCaptionDockBottom({
      captionSize,
      obstacles: [
        { left: 24, right: 1256, top: 724, bottom: 776 },
        { left: 40, right: 88, top: 540, bottom: 726 }
      ],
      ...viewport
    });
    assert.equal(bottom, 800 - 724 + 12);
  });

  it('lifts further only when a preview actually covers the captions', () => {
    const bottom = computeCaptionDockBottom({
      captionSize,
      obstacles: [
        { left: 24, right: 1256, top: 724, bottom: 776 },
        { left: 540, right: 700, top: 610, bottom: 726 }
      ],
      ...viewport
    });
    assert.equal(bottom, 800 - 610 + 12);
  });

  it('does not lift when captions are missing', () => {
    const bottom = computeCaptionDockBottom({
      captionSize: null,
      obstacles: [{ left: 24, right: 1256, top: 500, bottom: 776 }],
      ...viewport
    });
    assert.equal(bottom, CAPTION_DOCK_REST_BOTTOM);
  });
});

describe('caption language preference', () => {
  it('groups YouTube hosts and matches language codes, not labels', () => {
    assert.equal(captionPreferenceHost('www.youtube.com'), 'youtube.com');
    assert.equal(captionPreferenceHost('m.youtube.com'), 'youtube.com');
    assert.equal(captionPreferenceHost('youtu.be'), 'youtube.com');
    assert.equal(captionPreferenceHost('player.twitch.tv'), 'twitch.tv');
    assert.equal(captionPreferenceHost('www.twitch.tv'), 'twitch.tv');
    assert.equal(languagesCompatible('en', 'en-US'), true);
    assert.equal(languagesCompatible('pl', 'de'), false);
    const tracks = [
      { id: 'youtube:a.en', language: 'en', label: 'English', kind: 'captions' as const, source: 'youtube' as const, autoGenerated: true },
      { id: 'youtube:.pl', language: 'pl', label: 'Polish', kind: 'subtitles' as const, source: 'youtube' as const, autoGenerated: false },
      { id: 'native:0', language: '', label: 'English', kind: 'subtitles' as const, source: 'native-text-track' as const }
    ];
    assert.equal(findPreferredCaptionTrack(tracks, { language: 'en-GB', autoGenerated: true })?.id, 'youtube:a.en');
    assert.equal(findPreferredCaptionTrack(tracks, { language: 'pl', autoGenerated: true })?.id, 'youtube:.pl');
    assert.equal(findPreferredCaptionTrack(tracks, { language: 'en', autoGenerated: false })?.id, 'youtube:a.en');
  });

  it('does not restore from a label-only track with no language code', () => {
    const tracks = [
      { id: 'native:0', language: '', label: 'English', kind: 'subtitles' as const, source: 'native-text-track' as const }
    ];
    assert.equal(findPreferredCaptionTrack(tracks, { language: 'en', autoGenerated: false }), null);
  });

  it('reads a stored host map', () => {
    const map = resolveCaptionPreferenceMap({
      'www.youtube.com': { enabled: true, language: 'EN', autoGenerated: true }
    });
    assert.equal(map['youtube.com']?.language, 'en');
    assert.equal(map['youtube.com']?.autoGenerated, true);
  });
});

describe('provider integration flags', () => {
  const allOn = defaultMediaProviderFlags();

  it('defaults YouTube, Vimeo, Patreon, and Twitch extras on', () => {
    assert.deepEqual(resolveMediaProviderFlags(undefined), {
      youtube: true,
      vimeo: true,
      patreon: true,
      twitch: true
    });
    assert.deepEqual(resolveMediaProviderFlags({}), allOn);
  });

  it('treats only explicit false as off', () => {
    const flags = resolveMediaProviderFlags({
      youtubeIntegrationEnabled: false,
      vimeoIntegrationEnabled: true,
      patreonIntegrationEnabled: false,
      twitchIntegrationEnabled: false
    });
    assert.equal(flags.youtube, false);
    assert.equal(flags.vimeo, true);
    assert.equal(flags.patreon, false);
    assert.equal(flags.twitch, false);
    assert.equal(shouldAttachYouTubeAdapter({ ...allOn, youtube: false }, 'www.youtube.com'), false);
    assert.equal(shouldAttachYouTubeAdapter(allOn, 'www.youtube.com'), true);
    assert.equal(shouldAttachVimeoAdapter({ ...allOn, vimeo: false }, 'vimeo.com'), false);
    assert.equal(shouldAttachVimeoAdapter(allOn, 'player.vimeo.com'), true);
    assert.equal(shouldAttachYouTubeAdapter(allOn, 'example.com'), false);
    assert.equal(shouldAttachPatreonAdapter(allOn, 'www.patreon.com'), true);
    assert.equal(shouldAttachPatreonAdapter({ ...allOn, patreon: false }, 'www.patreon.com'), false);
    assert.equal(shouldAttachPatreonAdapter(allOn, 'example.com'), false);
    assert.equal(shouldAttachTwitchAdapter(allOn, 'www.twitch.tv'), true);
    assert.equal(shouldAttachTwitchAdapter(allOn, 'player.twitch.tv'), true);
    assert.equal(shouldAttachTwitchAdapter({ ...allOn, twitch: false }, 'www.twitch.tv'), false);
    assert.equal(shouldAttachTwitchAdapter(allOn, 'example.com'), false);
  });
});

describe('native text track overlay', () => {
  class FakeCue {
    constructor(
      public startTime: number,
      public endTime: number,
      public text: string
    ) {}
  }

  class FakeTrack {
    kind = 'subtitles';
    language = 'es';
    label = 'Spanish';
    mode: 'disabled' | 'hidden' | 'showing' = 'disabled';
    cues: FakeCue[] = [];
    addEventListener(): void {}
    removeEventListener(): void {}
  }

  type TrackList = FakeTrack[] & {
    addEventListener: (type: string, fn: () => void) => void;
    removeEventListener: (type: string, fn: () => void) => void;
    dispatchChange: () => void;
  };

  function createAdapter(track: FakeTrack, trackEl?: { kind: string; srclang: string; src: string; readyState: number }) {
    const changeListeners = new Set<() => void>();
    const tracks = [track] as TrackList;
    tracks.addEventListener = (_type, fn) => {
      changeListeners.add(fn);
    };
    tracks.removeEventListener = (_type, fn) => {
      changeListeners.delete(fn);
    };
    tracks.dispatchChange = () => {
      for (const fn of changeListeners) fn();
    };
    const video = {
      textTracks: tracks,
      querySelectorAll: (selector: string) => selector === 'track' && trackEl ? [trackEl] : []
    };
    return {
      adapter: new NativeTextTrackAdapter(video as unknown as HTMLVideoElement),
      tracks
    };
  }

  it('maps in-memory cues and keeps line breaks', () => {
    const track = new FakeTrack();
    track.cues = [new FakeCue(1, 3, 'Hello <c>world</c>\nnext line')];
    const cues = cuesFromTrack(track as unknown as TextTrack);
    assert.equal(cues.length, 1);
    assert.equal(cues[0].text, 'Hello world\nnext line');
    assert.equal(cues[0].start, 1);
    assert.equal(cues[0].end, 3);
  });

  it('activates overlay cues with hidden mode instead of showing', async () => {
    const track = new FakeTrack();
    track.cues = [new FakeCue(1, 3, 'Hola')];
    const { adapter, tracks } = createAdapter(track);
    const cues = await adapter.activateCaptionTrack('native:0');
    assert.equal(track.mode, 'hidden');
    assert.equal(cues?.[0].text, 'Hola');
    track.mode = 'showing';
    tracks.dispatchChange();
    assert.equal(track.mode, 'hidden');
  });

  it('disables tracks when captions turn off', async () => {
    const track = new FakeTrack();
    track.cues = [new FakeCue(1, 3, 'Hola')];
    const { adapter, tracks } = createAdapter(track);
    await adapter.activateCaptionTrack('native:0');
    const cues = await adapter.activateCaptionTrack(null);
    assert.equal(cues, null);
    assert.equal(track.mode, 'disabled');
    track.mode = 'showing';
    tracks.dispatchChange();
    assert.equal(track.mode, 'showing');
  });

  it('fetches a same-origin track file when in-memory cues are empty', async () => {
    const track = new FakeTrack();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(`WEBVTT

00:00:00.000 --> 00:00:02.000
Fetched line`, { status: 200 })) as typeof fetch;
    try {
      const { adapter } = createAdapter(track, {
        kind: 'subtitles',
        srclang: 'es',
        src: 'https://example.com/captions.vtt',
        readyState: 2
      });
      const cues = await adapter.activateCaptionTrack('native:0');
      assert.equal(track.mode, 'hidden');
      assert.equal(cues?.[0].text, 'Fetched line');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
