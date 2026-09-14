import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { captionPreferenceHost, findPreferredCaptionTrack, languagesCompatible, pickCaptionTrack, resolveCaptionPreferenceMap } from './caption-preference';
import { computeCaptionDockBottom, CAPTION_DOCK_REST_BOTTOM } from './caption-dock';
import { classifyCaptionWord, findActiveCues, visibleCaptionLines } from './cue-index';
import { isAllowedMediaFetchUrl } from './fetch-allowlist';
import { defaultMediaProviderFlags, resolveMediaProviderFlags } from './provider-flags';
import { shouldAttachDisneyAdapter, shouldAttachPatreonAdapter, shouldAttachTwitchAdapter, shouldAttachVimeoAdapter, shouldAttachYouTubeAdapter } from './resolve-adapter';
import { createTimedtextCacheRecord, findCachedTimedtextBody, mergeYoutubeCaptionAuth, signYoutubeCaptionUrl, timedtextHasPot, timedtextVideoId, youtubePageVideoId, youtubeSnapshotMatchesPage } from './youtube-caption-url';
import { firstMatchingYoutubeSnapshot, readPublishedYoutubeCaptionAuthUrls, readPublishedYoutubeSnapshot } from './youtube-snapshot';
import { NativeTextTrackAdapter, cuesFromTrack, parseNativeTrackPayload } from './native-adapter';
import { parseCaptionPayload, parseSrt, parseWebVtt } from './parsers/captions';
import { parseYoutubeDescriptionChapters } from './parsers/youtube-chapters';
import { getStoryboardFrame, parseStoryboardSpec } from './parsers/youtube-storyboard';
import { getVimeoPreviewFrame, parseVimeoThumbPreview } from './parsers/vimeo-thumbs';
import { getMuxPreviewFrame, parseMuxStoryboard } from './parsers/mux-storyboard';
import { parsePatreonPageAssets, pickPatreonPageAssets, applyPatreonCaptionMeta, mergePatreonCaptionTracks } from './parsers/patreon-page';
import { getTwitchPreviewFrame, parseTwitchSeekPreviews } from './parsers/twitch-storyboard';
import { collectTwitchStoryboardUrls, extractTwitchPayloadFromJson, parseTwitchPageAssets, twitchPageVideoId } from './parsers/twitch-page';
import {
  disneyPlayId,
  isDisneyHost,
  isSafeDisneyBifUrl,
  isSafeDisneyCaptionUrl,
  isSafeDisneyMasterUrl,
  parseDisneyChromeDurationFromHtml,
  parseDisneyClock,
  parseDisneyHlsSubtitles,
  parseDisneyHlsVttPlaylist,
  parseDisneyHlsVttSegments,
  alignDisneyVttCues,
  readDisneyContentTime,
  parseDisneyPlaybackPayload,
  parseDisneyThumbnailIndex,
  parseRokuBif,
  disneyBifFrameCount,
  disneyBifTimestampSeconds,
  isDisneyTimelineBif
} from './parsers/disney-page';
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

  it('parses Disney HLS WebVTT with STYLE blocks, cue settings, and italic tags', () => {
    const cues = parseWebVtt(`WEBVTT

STYLE
::cue() {
  font-family: Arial;
}

00:09:10.467 --> 00:09:14.471 line:83%,end
<i>Wziął się do pracy, bo chciał kołaczy.</i>
<i>Nie opuszczał treningów nóg.</i>

00:09:16.264 --> 00:09:18.933 line:83%,end
<i>Rzeźbił rzeźbę i komasował masę.</i>
`);
    assert.equal(cues.length, 2);
    assert.equal(cues[0].start, 9 * 60 + 10.467);
    assert.equal(cues[0].end, 9 * 60 + 14.471);
    assert.equal(cues[0].text, 'Wziął się do pracy, bo chciał kołaczy.\nNie opuszczał treningów nóg.');
    assert.equal(findActiveCues(cues, 9 * 60 + 12)[0]?.text.startsWith('Wziął'), true);
    assert.equal(findActiveCues(cues, 60).length, 0);
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

  it('prefers a published current-video snapshot over a stale playlist boot response', () => {
    const stale = { videoId: 'uNKERzNED28', captionTracks: [] };
    const current = {
      videoId: 'sigA04sdSMQ',
      captionTracks: [{
        id: 'youtube:a.en',
        language: 'en',
        label: 'English (auto-generated)',
        kind: 'captions' as const,
        autoGenerated: true,
        baseUrl: 'https://www.youtube.com/api/timedtext?v=sigA04sdSMQ&kind=asr&lang=en'
      }]
    };
    assert.equal(firstMatchingYoutubeSnapshot('sigA04sdSMQ', [stale, current])?.videoId, 'sigA04sdSMQ');
    assert.equal(firstMatchingYoutubeSnapshot('sigA04sdSMQ', [stale, null])?.videoId, undefined);
    const published = readPublishedYoutubeSnapshot({
      querySelector: () => ({ textContent: JSON.stringify(current) })
    } as Pick<ParentNode, 'querySelector'>);
    assert.equal(published?.videoId, 'sigA04sdSMQ');
    assert.equal(published?.captionTracks?.[0]?.autoGenerated, true);
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

  it('signs an unsigned baseUrl from a same-video sibling and ignores a previous playlist item', () => {
    const unsigned = 'https://www.youtube.com/api/timedtext?v=sigA04sdSMQ&kind=asr&lang=en&fmt=json3';
    const previous = 'https://www.youtube.com/api/timedtext?v=uNKERzNED28&kind=asr&lang=en&pot=OLD&potc=1';
    const signed = 'https://www.youtube.com/api/timedtext?v=sigA04sdSMQ&lang=en&pot=TOKEN%3D&potc=1&c=WEB';
    const merged = new URL(signYoutubeCaptionUrl(unsigned, [previous, signed]));
    assert.equal(merged.searchParams.get('pot'), 'TOKEN=');
    assert.equal(merged.searchParams.get('v'), 'sigA04sdSMQ');
    assert.equal(merged.searchParams.get('kind'), 'asr');
    assert.equal(merged.searchParams.get('fmt'), 'json3');
    assert.equal(merged.searchParams.get('lang'), 'en');
    assert.equal(signYoutubeCaptionUrl(unsigned, [previous]), unsigned);
    assert.deepEqual(
      readPublishedYoutubeCaptionAuthUrls({
        querySelector: () => ({ textContent: JSON.stringify([previous, signed]) })
      } as Pick<ParentNode, 'querySelector'>),
      [previous, signed]
    );
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

  it('allows Disney+ HLS subtitle playlists, VTT segments, and Roku BIF on dssott, not BAM GraphQL', () => {
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'disney',
      kind: 'caption-track',
      url: 'https://vod-akc-euwest1.media.dssott.com/ps01/text/pl.vtt'
    }), true);
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'disney',
      kind: 'caption-track',
      url: 'https://vod-akc-euwest1.media.dssott.com/ps01/una-ctr-all-abc.m3u8'
    }), true);
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'disney',
      kind: 'caption-track',
      url: 'https://vod-akc-euwest1.media.dssott.com/ps01/r/composite_pl_NORMAL_abc.m3u8'
    }), true);
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'disney',
      kind: 'caption-track',
      url: 'https://vod-akc-euwest1.media.dssott.com/ps01/SUBTITLE_1_WEBVTT/dvt3=abc/pts_0'
    }), true);
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'disney',
      kind: 'storyboard-json',
      url: 'https://vod-akc-euwest1.media.dssott.com/ps01/thumbnails/roku.bif'
    }), true);
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'disney',
      kind: 'storyboard-json',
      url: 'https://vod-akc-euwest1.media.dssott.com/ps01/thumbnails/6492-DUB_CARD/roku.bif'
    }), false);
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'disney',
      kind: 'storyboard-vtt',
      url: 'https://vod-akc-euwest1.media.dssott.com/ps01/trickplay/storyboard.vtt'
    }), false);
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'disney',
      kind: 'caption-track',
      url: 'https://disney.api.edge.bamgrid.com/explore/v1.0/page'
    }), false);
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'disney',
      kind: 'caption-track',
      url: 'https://disney.api.edge.bamgrid.com/captions.vtt'
    }), false);
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'disney',
      kind: 'storyboard-json',
      url: 'https://disney.playback.edge.bamgrid.com/v7/playback/ctr-regular'
    }), false);
    assert.equal(isAllowedMediaFetchUrl({
      provider: 'disney',
      kind: 'storyboard-json',
      url: 'https://vod-akc-euwest1.media.dssott.com/ps01/playlist.m3u8'
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
    assert.equal(pickCaptionTrack(tracks, { language: 'de', autoGenerated: false })?.id, 'youtube:a.en');
  });

  it('restores a label-only native track when no language code exists', () => {
    const tracks = [
      { id: 'native:0', language: '', label: 'English', kind: 'subtitles' as const, source: 'native-text-track' as const }
    ];
    assert.equal(findPreferredCaptionTrack(tracks, { language: 'en', autoGenerated: false }), null);
    assert.equal(findPreferredCaptionTrack(tracks, { language: '', autoGenerated: false, label: 'english' })?.id, 'native:0');
  });

  it('reads a stored host map', () => {
    const map = resolveCaptionPreferenceMap({
      'www.youtube.com': { enabled: true, language: 'EN', autoGenerated: true },
      'example.com': { enabled: true, language: '', autoGenerated: false, label: 'English' }
    });
    assert.equal(map['youtube.com']?.language, 'en');
    assert.equal(map['youtube.com']?.autoGenerated, true);
    assert.equal(map['example.com']?.label, 'english');
    assert.equal(map['example.com']?.language, '');
  });
});

describe('provider integration flags', () => {
  const allOn = defaultMediaProviderFlags();

  it('defaults YouTube, Vimeo, Patreon, Twitch, and Disney+ extras on', () => {
    assert.deepEqual(resolveMediaProviderFlags(undefined), {
      youtube: true,
      vimeo: true,
      patreon: true,
      twitch: true,
      disney: true
    });
    assert.deepEqual(resolveMediaProviderFlags({}), allOn);
  });

  it('treats only explicit false as off', () => {
    const flags = resolveMediaProviderFlags({
      youtubeIntegrationEnabled: false,
      vimeoIntegrationEnabled: true,
      patreonIntegrationEnabled: false,
      twitchIntegrationEnabled: false,
      disneyIntegrationEnabled: false
    });
    assert.equal(flags.youtube, false);
    assert.equal(flags.vimeo, true);
    assert.equal(flags.patreon, false);
    assert.equal(flags.twitch, false);
    assert.equal(flags.disney, false);
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
    assert.equal(shouldAttachDisneyAdapter(allOn, 'www.disneyplus.com'), true);
    assert.equal(shouldAttachDisneyAdapter({ ...allOn, disney: false }, 'www.disneyplus.com'), false);
    assert.equal(shouldAttachDisneyAdapter(allOn, 'example.com'), false);
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

describe('disney page parser', () => {
  it('reads play UUIDs and clock labels', () => {
    assert.equal(
      disneyPlayId('https://www.disneyplus.com/pl-pl/play/0007d7a0-2515-411e-9294-2de6a7b8d00e'),
      '0007d7a0-2515-411e-9294-2de6a7b8d00e'
    );
    assert.equal(isDisneyHost('www.disneyplus.com'), true);
    assert.equal(isDisneyHost('example.com'), false);
    assert.equal(parseDisneyClock('1:58:00'), 7080);
    assert.equal(parseDisneyChromeDurationFromHtml('<div class="DxcOverlay" aria-valuemax="7080">1:58:00</div>'), 7080);
    assert.equal(parseDisneyChromeDurationFromHtml('<div aria-valuemax="7080000"></div>'), 7080);
  });

  it('extracts master HLS and duration from playback JSON without treating BAM GraphQL as a caption URL', () => {
    const parsed = parseDisneyPlaybackPayload({
      stream: {
        runtimeMillis: 7_080_000,
        sources: [
          {
            complete: {
              url: 'https://vod-akc-euwest1.media.dssott.com/ps01/una-ctr-all-abc.m3u8'
            }
          }
        ]
      }
    });
    assert.equal(parsed.duration, 7080);
    assert.equal(parsed.captions.length, 0);
    assert.equal(parsed.masterUrl, 'https://vod-akc-euwest1.media.dssott.com/ps01/una-ctr-all-abc.m3u8');
    assert.equal(isSafeDisneyMasterUrl(parsed.masterUrl!), true);
    assert.equal(isSafeDisneyCaptionUrl('https://disney.api.edge.bamgrid.com/explore/v1.0'), false);
    assert.equal(isSafeDisneyCaptionUrl('https://vod-akc-euwest1.media.dssott.com/ps01/text/pl.vtt'), true);
    assert.equal(isSafeDisneyCaptionUrl('https://vod-akc-euwest1.media.dssott.com/ps01/r/composite_pl_NORMAL_abc.m3u8'), true);
    assert.equal(isSafeDisneyCaptionUrl('https://vod-akc-euwest1.media.dssott.com/ps01/r/composite_pl_FORCED_abc.m3u8'), true);
    assert.equal(isSafeDisneyBifUrl('https://vod-akc-euwest1.media.dssott.com/ps01/thumbnails/roku.bif'), true);
    assert.equal(isSafeDisneyBifUrl('https://vod-akc-euwest1.media.dssott.com/ps01/thumbnails/6492-DUB_CARD/roku.bif'), false);
    assert.equal(isSafeDisneyBifUrl('https://disney.playback.edge.bamgrid.com/v2/media/abc/thumbnails?format=bif'), false);
  });

  it('lists non-forced HLS subtitle playlists and VTT segments', () => {
    const master = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",URI="r/audio.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Polish",LANGUAGE="pl",FORCED=NO,URI="r/composite_pl_NORMAL_abc.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="pl--forced--",LANGUAGE="pl",FORCED=YES,URI="r/composite_pl_FORCED_abc.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English SDH",LANGUAGE="en",CHARACTERISTICS="public.accessibility.describes-music-and-sound",URI="r/composite_en_SDH_abc.m3u8"
`;
    const base = 'https://vod-akc-euwest1.media.dssott.com/ps01/una-ctr-all-abc.m3u8';
    const tracks = parseDisneyHlsSubtitles(master, base);
    assert.equal(tracks.length, 2);
    assert.equal(tracks[0].language, 'pl');
    assert.equal(tracks[0].url, 'https://vod-akc-euwest1.media.dssott.com/ps01/r/composite_pl_NORMAL_abc.m3u8');
    assert.equal(tracks[1].language, 'en');
    assert.equal(tracks.some((track) => /FORCED/i.test(track.url)), false);

    const playlist = `#EXTM3U
#EXT-X-TARGETDURATION:300
#EXTINF:275.734,
https://vod-akc-euwest1.media.dssott.com/ps01/SUBTITLE_1_WEBVTT/pts_0.vtt
#EXTINF:275.734,
pts_275734.vtt
#EXTINF:10.0,
https://vod-akc-euwest1.media.dssott.com/ps01/video/segment.m4s
`;
    const segments = parseDisneyHlsVttSegments(
      playlist,
      'https://vod-akc-euwest1.media.dssott.com/ps01/r/composite_pl_NORMAL_abc.m3u8'
    );
    assert.deepEqual(segments, [
      'https://vod-akc-euwest1.media.dssott.com/ps01/SUBTITLE_1_WEBVTT/pts_0.vtt',
      'https://vod-akc-euwest1.media.dssott.com/ps01/r/pts_275734.vtt'
    ]);
    const timed = parseDisneyHlsVttPlaylist(
      playlist,
      'https://vod-akc-euwest1.media.dssott.com/ps01/r/composite_pl_NORMAL_abc.m3u8'
    );
    assert.equal(timed[0].start, 0);
    assert.equal(timed[1].start, 275.734);
    assert.equal(timed[1].duration, 275.734);

    const relative = alignDisneyVttCues(
      [{ start: 1, end: 3, text: 'Hi' }],
      275.734,
      275.734
    );
    assert.equal(relative[0].start, 276.734);
    const absolute = alignDisneyVttCues(
      [{ start: 550.467, end: 554.471, text: 'Thor' }],
      0,
      275.734
    );
    assert.equal(absolute[0].start, 550.467);
    const alreadyOnTimeline = alignDisneyVttCues(
      [{ start: 275.8, end: 278, text: 'Later' }],
      275.734,
      275.734
    );
    assert.equal(alreadyOnTimeline[0].start, 275.8);
    const playheadVideo = { dataset: { teDisneyPlayhead: '3621.5' } } as unknown as HTMLVideoElement;
    assert.equal(readDisneyContentTime(playheadVideo), 3621.5);
    assert.equal(readDisneyContentTime({} as HTMLVideoElement), null);
  });

  it('picks the MAIN Roku BIF from thumbnail JSON and parses BIF frames', () => {
    const thumbnail = parseDisneyThumbnailIndex({
      bifs: [
        {
          thumbnailWidth: 480,
          thumbnailHeight: 270,
          intervalMilliseconds: 10_000,
          presentations: [
            {
              presentationType: 'DUB_CARD',
              thumbnailCount: 2,
              paths: ['https://vod-akc-euwest1.media.dssott.com/ps01/thumbnails/dub.bif']
            },
            {
              presentationType: 'MAIN',
              thumbnailCount: 713,
              paths: ['https://vod-akc-euwest1.media.dssott.com/ps01/thumbnails/roku.bif']
            }
          ]
        }
      ],
      spritesheets: []
    });
    assert.equal(thumbnail?.bifUrl, 'https://vod-akc-euwest1.media.dssott.com/ps01/thumbnails/roku.bif');
    assert.equal(thumbnail?.width, 480);
    assert.equal(thumbnail?.intervalMs, 10_000);
    assert.equal(parseDisneyThumbnailIndex({
      bifs: [{
        thumbnailWidth: 480,
        thumbnailHeight: 270,
        intervalMilliseconds: 10_000,
        presentations: [{
          presentationType: 'DUB_CARD',
          thumbnailCount: 2,
          paths: ['https://vod-akc-euwest1.media.dssott.com/ps01/thumbnails/dub.bif']
        }]
      }]
    }), null);

    const jpegA = new Uint8Array([0xff, 0xd8, 0x41, 0xff, 0xd9]);
    const jpegB = new Uint8Array([0xff, 0xd8, 0x42, 0xff, 0xd9]);
    const count = 2;
    const dataStart = 64 + (count + 1) * 8;
    const total = dataStart + jpegA.length + jpegB.length;
    const buffer = new ArrayBuffer(total);
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    bytes.set([0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    view.setUint32(12, count, true);
    view.setUint32(16, 1000, true);
    view.setUint32(64, 0, true);
    view.setUint32(68, dataStart, true);
    view.setUint32(72, 10_000, true);
    view.setUint32(76, dataStart + jpegA.length, true);
    view.setUint32(80, 0xffffffff, true);
    view.setUint32(84, total, true);
    bytes.set(jpegA, dataStart);
    bytes.set(jpegB, dataStart + jpegA.length);
    const bif = parseRokuBif(buffer, thumbnail || undefined);
    assert.ok(bif);
    assert.equal(bif!.frames.length, 2);
    assert.equal(disneyBifFrameCount(buffer), 2);
    assert.equal(isDisneyTimelineBif(buffer), false);
    assert.equal(bif!.frames[0].time, 0);
    assert.equal(bif!.frames[1].time, 10);
    assert.deepEqual(
      [...new Uint8Array(bif!.buffer.slice(bif!.frames[1].start, bif!.frames[1].end))],
      [...jpegB]
    );
    const dubCard = new ArrayBuffer(80);
    const dubBytes = new Uint8Array(dubCard);
    const dubView = new DataView(dubCard);
    dubBytes.set([0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    dubView.setUint32(12, 1, true);
    dubView.setUint32(16, 1, true);
    assert.equal(disneyBifFrameCount(dubCard), 1);
    assert.equal(isDisneyTimelineBif(dubCard), false);
    assert.equal(disneyBifTimestampSeconds(10_000, 1), 10);
    assert.equal(disneyBifTimestampSeconds(10, 1000), 10);
    assert.equal(disneyBifTimestampSeconds(10_000, 1000), 10);
  });
});
