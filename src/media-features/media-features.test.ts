import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { captionPreferenceHost, findPreferredCaptionTrack, languagesCompatible, resolveCaptionPreferenceMap } from './caption-preference';
import { computeCaptionDockBottom, CAPTION_DOCK_REST_BOTTOM } from './caption-dock';
import { classifyCaptionWord, findActiveCues, visibleCaptionLines } from './cue-index';
import { isAllowedMediaFetchUrl } from './fetch-allowlist';
import { createTimedtextCacheRecord, findCachedTimedtextBody, mergeYoutubeCaptionAuth, timedtextHasPot, timedtextVideoId, youtubePageVideoId, youtubeSnapshotMatchesPage } from './youtube-caption-url';
import { parseCaptionPayload, parseSrt, parseWebVtt } from './parsers/captions';
import { parseYoutubeDescriptionChapters } from './parsers/youtube-chapters';
import { getStoryboardFrame, parseStoryboardSpec } from './parsers/youtube-storyboard';
import { sanitizeCaptionText } from './sanitize';

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
    assert.equal(cues[0].text, 'Hello world');
    assert.equal(cues[0].start, 1);
    assert.equal(cues[1].end, 6.5);
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
