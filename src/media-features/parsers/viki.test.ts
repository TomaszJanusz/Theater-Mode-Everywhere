import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isVikiCaptionUrl,
  isVikiPreviewImageUrl,
  isVikiPreviewUrl,
  parseVikiPlayback,
  vikiChapters,
  vikiAudioTracks,
  vikiLoadedVideoId,
  vikiNextDataUrl,
  vikiVideoId
} from './viki';

const CAPTION = 'https://api.viki.io/v4/videos/1263131v/subtitles/en.vtt?app=100000a&stream_id=1&t=1&sig=s';
const PREVIEW = 'https://manifest-viki.viki.io/v1/streams/1263131v/preview.vtt?region=ww';

/** The measured shape of `pageProps` for an episode, reduced to what the parser reads. */
function pageProps(overrides: Record<string, unknown> = {}) {
  return {
    videoPlaybackStreamJson: {
      previewUrl: PREVIEW,
      queue: [{ type: 'bumper' }, { type: 'main', closingMarker: 1953, skipMarkers: [{ label: 'skip_intro', labelText: 'Skip Intro', startTime: 127, endTime: 220 }] }],
      streamSubtitles: { dash: [
        { srclang: 'cs', label: "Čeština <span dir='ltr'>(100%)</span>", src: CAPTION.replace('/en.vtt', '/cs.vtt') },
        { srclang: 'en', label: 'English', src: CAPTION },
        { srclang: 'en', label: 'Duplicate', src: CAPTION },
        { srclang: 'de', label: 'Foreign episode', src: CAPTION.replace('1263131v', '1263999v').replace('/en.vtt', '/de.vtt') },
        { srclang: 'fr', label: 'Wrong host', src: 'https://evil.test/v4/videos/1263131v/subtitles/fr.vtt' }
      ] },
      video: { id: '1263131v', duration: 2102, credits_marker: 1953, audio_languages: ['ko', 'en', 'es-419', 'pt-BR', 'bad tag', 'en'], origin: { language: 'ko' } },
      ...overrides
    }
  };
}

describe('Viki playback document', () => {
  it('reads tracks, markers, credits and the preview list of the requested episode', () => {
    const playback = parseVikiPlayback(pageProps(), '1263131v')!;
    assert.deepEqual(playback.captionTracks.map(track => [track.id, track.label]), [['viki:cs', 'Čeština (100%)'], ['viki:en', 'English']]);
    assert.deepEqual(playback.skipMarkers, [{ label: 'skip_intro', start: 127, end: 220 }]);
    assert.equal(playback.creditsStart, 1953);
    assert.equal(playback.duration, 2102);
    assert.equal(playback.previewUrl, PREVIEW);
    assert.deepEqual(playback.audioLanguages, ['ko', 'en', 'es-419', 'pt-BR'], 'invalid and repeated tags are dropped');
    assert.equal(playback.originalLanguage, 'ko');
    assert.deepEqual(vikiChapters(playback), [{ start: 127, end: 220, title: 'Intro' }, { start: 1953, end: 2102, title: 'Credits' }]);
  });

  it('rejects a document for another episode and malformed data', () => {
    assert.equal(parseVikiPlayback(pageProps(), '1263132v'), null);
    assert.equal(parseVikiPlayback(pageProps(), 'not-an-id'), null);
    assert.equal(parseVikiPlayback(null, '1263131v'), null);
    assert.equal(parseVikiPlayback({ videoPlaybackStreamJson: { video: 'x' } }, '1263131v'), null);
    const bad = parseVikiPlayback(pageProps({
      previewUrl: 'https://evil.test/v1/streams/1263131v/preview.vtt',
      queue: [{ closingMarker: -4, skipMarkers: [{ label: 'skip_intro', startTime: 90, endTime: 30 }, { label: 'Bad Label', startTime: 1, endTime: 2 }, { label: 'x', startTime: 'a', endTime: 2 }] }],
      video: { id: '1263131v', duration: 'long' }
    }), '1263131v')!;
    assert.equal(bad.previewUrl, null);
    assert.deepEqual(bad.skipMarkers, []);
    assert.equal(bad.creditsStart, null);
    assert.deepEqual(vikiChapters(bad), []);
  });

  it('falls back to the plain subtitle list when the dash list is missing', () => {
    const playback = parseVikiPlayback(pageProps({ streamSubtitles: undefined, subtitles: [{ srclang: 'en', label: 'English (100%)', src: CAPTION }] }), '1263131v')!;
    assert.deepEqual(playback.captionTracks.map(track => track.id), ['viki:en']);
  });
});

describe('Viki URL policy', () => {
  it('qualifies episode pages only on viki.com over https', () => {
    assert.equal(vikiVideoId(new URL('https://www.viki.com/videos/1263131v-slug')), '1263131v');
    for (const href of ['http://www.viki.com/videos/1263131v', 'https://www.viki.com.evil.test/videos/1263131v', 'https://www.viki.com:444/videos/1263131v', 'https://www.viki.com/tv/41125c']) {
      assert.equal(vikiVideoId(new URL(href)), null, href);
    }
  });

  it('allows only the page\'s own subtitle, preview and sprite files', () => {
    assert.equal(isVikiCaptionUrl(CAPTION), true);
    assert.equal(isVikiCaptionUrl(CAPTION, '1263131v'), true);
    assert.equal(isVikiCaptionUrl(CAPTION, '1263132v'), false);
    assert.equal(isVikiCaptionUrl(CAPTION.replace('/subtitles/', '/auth_subtitles/')), true, 'the page loads both forms');
    for (const url of ['http://api.viki.io/v4/videos/1263131v/auth_subtitles/en.vtt', 'https://api.viki.io:8443/v4/videos/1263131v/subtitles/en.vtt',
      'https://user@api.viki.io/v4/videos/1263131v/subtitles/en.vtt', 'https://api.viki.io/v4/videos/1263131v/subtitles/../en.vtt',
      'https://api.viki.io/v4/videos/1263131v/timed_comments/all.json', 'https://api.viki.io.evil.test/v4/videos/1263131v/subtitles/en.vtt', 'https://www.viki.com/v4/videos/1263131v/subtitles/en.vtt']) {
      assert.equal(isVikiCaptionUrl(url), false, url);
    }
    assert.equal(isVikiPreviewUrl(PREVIEW, '1263131v'), true);
    assert.equal(isVikiPreviewUrl(PREVIEW, '1263132v'), false);
    assert.equal(isVikiPreviewUrl('https://manifest-viki.viki.io/v1/license?video_id=1263131v'), false);
    assert.equal(isVikiPreviewImageUrl('https://vikiplatform.akamaized.net/1263131v/dash/preview/a_1.jpg'), true);
    assert.equal(isVikiPreviewImageUrl('https://vikiplatform-0.akamaized.net/1263131v/dash/preview/a_1.jpg'), true);
    assert.equal(isVikiPreviewImageUrl('https://vikiplatform.akamaized.net.evil.test/a.jpg'), false);
    assert.equal(isVikiPreviewImageUrl('https://vikiplatform.akamaized.net/a.mp4'), false);
  });
});

describe('Viki resource timeline', () => {
  const names = [
    'https://www.viki.com/_next/data/FDtdnCs_YnUFzVqlsFI-m/videos/1263132v.json?vid=1263132v',
    'https://manifest-viki.viki.io/v1/1263132v/akamai/main/mpd/vtt/viki/high/sd/ww/dt2_dt3/manifest.mpd?x=1',
    'https://www.viki.com/_next/data/FDtdnCs_YnUFzVqlsFI-m/videos/1263133v.json?vid=1263133v'
  ];

  it('finds the page\'s own data request for an episode, on this origin only', () => {
    assert.equal(vikiNextDataUrl(names, '1263132v', 'https://www.viki.com'), names[0]);
    assert.equal(vikiNextDataUrl(names, '1263132v', 'https://viki.com'), null);
    assert.equal(vikiNextDataUrl(names, '1263134v', 'https://www.viki.com'), null);
    assert.equal(vikiNextDataUrl(['https://www.viki.com/_next/data/b/videos/1263132v/../x.json'], '1263132v', 'https://www.viki.com'), null);
    // The page clears its resource timeline: the same request is rebuilt from the page's own build id.
    assert.equal(vikiNextDataUrl([], '1263132v', 'https://www.viki.com', 'FDtdnCs_YnUFzVqlsFI-m'), 'https://www.viki.com/_next/data/FDtdnCs_YnUFzVqlsFI-m/videos/1263132v.json?vid=1263132v');
    for (const bad of [undefined, '', '../x', 'a b', 'a'.repeat(65), 42]) assert.equal(vikiNextDataUrl([], '1263132v', 'https://www.viki.com', bad), null, String(bad));
    assert.equal(vikiNextDataUrl([], '1263132v', 'http://www.viki.com', 'abc'), null);
  });

  it('takes the loading episode from the last manifest request', () => {
    assert.equal(vikiLoadedVideoId(names), '1263132v');
    assert.equal(vikiLoadedVideoId([...names, 'https://manifest-viki.viki.io/v1/1263133v/akamai/manifest.mpd']), '1263133v');
    assert.equal(vikiLoadedVideoId(['https://evil.test/v1/1263133v/manifest.mpd']), null);
    assert.equal(vikiLoadedVideoId([]), null);
  });
});

describe('Viki audio menu', () => {
  /** The measured menu of a dubbed Korean drama: Viki lists the viewer's own choice first. */
  const MENU = [
    { label: 'English', selected: true },
    { label: 'Original - 한국어', selected: false },
    { label: 'Español (Latinoamérica)', selected: false },
    { label: 'Português (Brasil)', selected: false }
  ];
  const LANGUAGES = ['ko', 'en', 'es-419', 'pt-BR'];

  it('tags each row from the episode\'s own languages and marks the recorded language original', () => {
    assert.deepEqual(vikiAudioTracks(MENU, LANGUAGES, 'ko').map(track => [track.languageTag, track.kind, track.selected]), [
      ['en', 'dub', true], ['ko', 'original', false], ['es-419', 'dub', false], ['pt-BR', 'dub', false]
    ]);
  });

  it('does not rely on the localized "Original" marker, and leaves ambiguous or unknown rows untagged', () => {
    const polish = vikiAudioTracks([{ label: 'Oryginał - 한국어', selected: true }, { label: 'English', selected: false }], LANGUAGES, 'ko');
    assert.deepEqual(polish.map(track => track.kind), ['original', 'dub']);
    // The marker alone proves nothing: a recorded language of "en" makes English the original.
    assert.equal(vikiAudioTracks(MENU, LANGUAGES, 'en')[0].kind, 'original');
    // Two tags of one language cannot be told apart from a label.
    assert.deepEqual(vikiAudioTracks([{ label: '한국어', selected: true }], ['ko-KR', 'ko'], 'ko').map(track => [track.languageTag, track.kind]), [['', 'unknown']]);
    assert.deepEqual(vikiAudioTracks([{ label: 'Klingon', selected: false }], LANGUAGES, 'ko').map(track => [track.languageTag, track.kind]), [['', 'unknown']]);
    assert.deepEqual(vikiAudioTracks(MENU, [], null).map(track => track.kind), ['unknown', 'unknown', 'unknown', 'unknown']);
  });

  it('names a row by its label, so the order Viki keeps changing does not rename it, and bounds the label', () => {
    const [first, second] = vikiAudioTracks(MENU, LANGUAGES, 'ko');
    assert.equal(first.id, 'english');
    assert.notEqual(first.id, second.id);
    const reordered = vikiAudioTracks([MENU[2], MENU[0], MENU[1], MENU[3]], LANGUAGES, 'ko');
    assert.deepEqual(reordered.map(track => track.id).sort(), vikiAudioTracks(MENU, LANGUAGES, 'ko').map(track => track.id).sort());
    assert.deepEqual(vikiAudioTracks([MENU[0], MENU[0]], LANGUAGES, 'ko').map(track => track.id), ['english', 'english#1']);
    assert.equal(vikiAudioTracks([{ label: 'x'.repeat(500), selected: false }], [], null)[0].label.length, 200);
  });
});
