import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyPlayerCaption,
  chooseNetflixRawTrack,
  hostCaptionsAvailable,
  netflixHarvestKey,
  snapshotMatchesVideo,
  parseCaptionRequest,
  parseNetflixTextTracks,
  parsePublishedTracks,
  readPublishedSnapshot,
  readHeaderSubtitle,
  resolveNetflixSubtitle,
  resolveNetflixTitle,
  selectableTextTracks,
  selectCaptionTarget,
  stripNetflixSiteTitle
} from './parsers/netflix-page';
import { publishedNetflixPayload } from '../providers/netflix/main';

const publicTracks = [
  {
    trackId: 'T:2:0;1;pl;1;1;0;0;',
    bcp47: 'pl',
    displayName: 'wył.',
    rawTrackType: 'SUBTITLES',
    isForcedNarrative: true,
    isNoneTrack: false
  },
  {
    trackId: 'T:2:1;1;pl;0;0;0;0;',
    bcp47: 'pl',
    displayName: 'polski',
    rawTrackType: 'SUBTITLES',
    isForcedNarrative: false,
    isNoneTrack: false
  },
  {
    trackId: 'T:2:1;1;en;0;0;0;0;',
    bcp47: 'en',
    displayName: 'angielski',
    rawTrackType: 'CLOSEDCAPTIONS',
    isForcedNarrative: false,
    isNoneTrack: false
  },
  {
    trackId: 'https://example.invalid/subtitle.vtt?token=secret',
    bcp47: 'en',
    displayName: 'leaked'
  }
];

describe('netflix public player metadata', () => {
  it('keeps host subtitle languages and drops the off track and any url-shaped id', () => {
    const tracks = parseNetflixTextTracks(publicTracks);
    assert.equal(tracks.length, 3);
    assert.equal(tracks[0].none, true);
    assert.deepEqual(selectableTextTracks(tracks).map((track) => track.language), ['pl', 'en']);
    assert.equal(selectableTextTracks(tracks)[1].kind, 'captions');
    assert.equal(selectCaptionTarget(tracks, 'T:2:1;1;pl;0;0;0;0;')?.label, 'polski');
    assert.equal(selectCaptionTarget(tracks, null)?.none, true);
    assert.equal(selectCaptionTarget(tracks, 'https://example.invalid/secret'), null);
  });

  it('drops a snapshot when the open video id changes', () => {
    assert.equal(snapshotMatchesVideo('82779520', '82779520'), true);
    assert.equal(snapshotMatchesVideo('82779520', '80057281'), false);
    assert.equal(snapshotMatchesVideo(undefined, '80057281'), true);
  });

  it('names the open clip and does not keep a stale trailer title', () => {
    assert.equal(stripNetflixSiteTitle('Oglądaj: Stranger Things | Oficjalna witryna Netflix'), 'Stranger Things');
    assert.equal(resolveNetflixTitle({
      videoId: '82779520',
      previousVideoId: '80057281',
      previousTitle: 'Old trailer',
      playerTitle: null,
      controlTitle: null,
      documentTitle: 'Oglądaj: Stranger Things | Oficjalna witryna Netflix'
    }), 'Stranger Things');
    assert.equal(resolveNetflixTitle({
      videoId: '82779520',
      previousVideoId: '82779520',
      previousTitle: 'Zwiastun serii: Stranger Things',
      playerTitle: null,
      controlTitle: null,
      documentTitle: 'Netflix'
    }), 'Zwiastun serii: Stranger Things');
  });

  it('reads the season marker and episode title from the player header', () => {
    const header = (spans: string[]) => ({
      querySelector: (selector: string) => selector === '[data-uia="video-title"]'
        ? { querySelectorAll: () => spans.map((textContent) => ({ textContent })) }
        : null
    });
    // <h4>Cyberpunk: Edgerunners</h4><span>O5</span><span>Jawa czy sen?</span>
    assert.equal(readHeaderSubtitle(header(['O5', 'Jawa czy sen?'])), 'O5 · Jawa czy sen?');
    assert.equal(readHeaderSubtitle(header(['O5', '  ', ''])), 'O5');
    assert.equal(readHeaderSubtitle(header([])), null);
    assert.equal(readHeaderSubtitle({ querySelector: () => null }), null);
  });

  it('keeps the subtitle with its clip and never leaves an empty one', () => {
    const base = { videoId: '1', previousVideoId: '1', previousSubtitle: 'O5 · Old', headerSubtitle: null, episodeTitle: null };
    assert.equal(resolveNetflixSubtitle({ ...base, headerSubtitle: 'O5 · Jawa czy sen?' }), 'O5 · Jawa czy sen?');
    assert.equal(resolveNetflixSubtitle({ ...base, episodeTitle: 'Jawa czy sen?' }), 'Jawa czy sen?');
    assert.equal(resolveNetflixSubtitle(base), 'O5 · Old');
    assert.equal(resolveNetflixSubtitle({ ...base, previousVideoId: '2' }), null);
    assert.equal(resolveNetflixSubtitle({ ...base, headerSubtitle: '   ', previousSubtitle: null }), null);
  });

  it('publishes the subtitle only beside a title', () => {
    assert.equal(publishedNetflixPayload({ videoId: '1', title: 'Show', subtitle: 'O5 · Ep', tracks: [] })?.subtitle, 'O5 · Ep');
    assert.equal(publishedNetflixPayload({ videoId: '1', subtitle: 'O5 · Ep', tracks: [] })?.subtitle, undefined);
  });

  it('reads a published snapshot without keeping unsafe track ids', () => {
    const published = publishedNetflixPayload({
      videoId: '82779520',
      title: 'Stranger Things',
      tracks: parseNetflixTextTracks(publicTracks),
      selectedTrackId: 'T:2:1;1;pl;0;0;0;0;'
    });
    const root = {
      querySelector: () => ({
        textContent: JSON.stringify({
          ...published,
          title: 'Oglądaj: Stranger Things | Netflix',
          videoId: 82779520
        })
      })
    };
    const snapshot = readPublishedSnapshot(root);
    assert.equal(snapshot?.videoId, '82779520');
    assert.equal(snapshot?.title, 'Stranger Things');
    assert.equal(snapshot?.tracks.length, 3);
    assert.equal(snapshot?.tracks.find((track) => track.language === 'en')?.kind, 'captions');
    assert.equal(snapshot?.tracks.find((track) => track.none)?.forced, true);
    assert.equal(snapshot?.selectedTrackId, 'T:2:1;1;pl;0;0;0;0;');
    assert.equal(selectableTextTracks(snapshot?.tracks || []).some((track) => track.none), false);
  });

  it('keeps a translated off track out of the selectable list after a snapshot round-trip', () => {
    const published = [{
      id: 'T:2:0;1;pl;1;1;0;0;',
      language: 'pl',
      label: 'Podtytuły wyłączone',
      kind: 'subtitles',
      forced: true,
      none: true
    }, {
      id: 'T:2:1;1;en;0;0;0;0;',
      language: 'en',
      label: 'English',
      kind: 'captions',
      forced: false,
      none: false
    }];
    const tracks = parsePublishedTracks(published);
    assert.equal(tracks[0].none, true);
    assert.equal(tracks[0].forced, true);
    assert.equal(tracks[1].kind, 'captions');
    assert.deepEqual(selectableTextTracks(tracks).map((track) => track.language), ['en']);
    assert.equal(parseNetflixTextTracks(published).find((track) => track.language === 'en')?.kind, 'subtitles');
  });

  it('treats a missing player id as the same harvest as an unset one', () => {
    const empty = { tracks: [] as Array<{ id: string; kind: 'subtitles'; forced: boolean; none: boolean }> };
    assert.equal(netflixHarvestKey({ ...empty, videoId: null, title: null }), netflixHarvestKey(empty));
    assert.equal(selectCaptionTarget(parseNetflixTextTracks(publicTracks), 'T:2:0;1;pl;1;1;0;0;'), null);
    const off = chooseNetflixRawTrack(publicTracks, null) as { displayName?: string; isForcedNarrative?: boolean };
    assert.equal(off.displayName, 'wył.');
    assert.equal(off.isForcedNarrative, true);
    assert.equal(parseCaptionRequest({ requestId: 'te-nf-abc', trackId: null }), null);
  });

  it('does not treat a setter return as an applied subtitle', () => {
    let selected = publicTracks[0];
    const calls: unknown[] = [];
    const stale = {
      textTracks: publicTracks,
      selectedTextTrack: publicTracks[0],
      setTimedTextTrack(track: unknown) {
        calls.push(track);
      },
      getTimedTextTrack: () => selected
    };
    assert.equal(applyPlayerCaption(stale, 'T:2:1;1;pl;0;0;0;0;', true), false);
    assert.equal((calls[0] as { displayName?: string }).displayName, 'polski');
    assert.notEqual(typeof calls[0], 'string');

    const noRenderer = {
      textTracks: publicTracks,
      getTimedTextTrack: () => selected,
      setTimedTextTrack(track: unknown) {
        selected = track as typeof selected;
        calls.push(track);
      }
    };
    const before = calls.length;
    assert.equal(applyPlayerCaption(noRenderer, 'T:2:1;1;pl;0;0;0;0;', false), false);
    assert.equal(calls.length, before);

    selected = publicTracks[1];
    assert.equal(applyPlayerCaption(noRenderer, 'T:2:1;1;pl;0;0;0;0;', true), true);
    assert.equal(applyPlayerCaption(noRenderer, null, false), true);
    assert.equal((calls.at(-1) as { displayName?: string }).displayName, 'wył.');

    const getterMiss = {
      textTracks: publicTracks,
      selectedTextTrack: publicTracks[1],
      getTimedTextTrack: () => null as unknown as typeof selected,
      setTimedTextTrack(track: unknown) {
        calls.push(track);
      }
    };
    const missed = calls.length;
    assert.equal(applyPlayerCaption(getterMiss, 'T:2:1;1;pl;0;0;0;0;', true), false);
    assert.equal(calls.length, missed + 1);

    const getterThrows = {
      textTracks: publicTracks,
      selectedTextTrack: publicTracks[1],
      getTimedTextTrack() {
        throw new Error('unavailable');
      },
      setTimedTextTrack(track: unknown) {
        calls.push(track);
      }
    };
    assert.equal(applyPlayerCaption(getterThrows, 'T:2:1;1;pl;0;0;0;0;', true), false);

    const propsOnly = {
      textTracks: publicTracks,
      selectedTextTrack: publicTracks[1],
      setTimedTextTrack() {}
    };
    assert.equal(applyPlayerCaption(propsOnly, 'T:2:1;1;pl;0;0;0;0;', true), true);

    let idLive: { id?: string } | null = null;
    let appliedId = '';
    const idOnly = [{
      id: 'T:2:1;1;pl;0;0;0;0;',
      bcp47: 'pl',
      displayName: 'polski',
      rawTrackType: 'SUBTITLES',
      isForcedNarrative: false,
      isNoneTrack: false
    }];
    const idApi = {
      textTracks: idOnly,
      getTimedTextTrack: () => idLive,
      setTimedTextTrack(track: unknown) {
        idLive = track as { id?: string };
        appliedId = idLive.id || '';
      }
    };
    assert.equal(applyPlayerCaption(idApi, 'T:2:1;1;pl;0;0;0;0;', true), true);
    assert.equal(appliedId, 'T:2:1;1;pl;0;0;0;0;');
  });

  it('does not treat a loading or fallback renderer as caption support', () => {
    assert.equal(hostCaptionsAvailable({ rendererMounted: true, fallbackMode: true, playerLoading: false }), false);
    assert.equal(hostCaptionsAvailable({ rendererMounted: true, fallbackMode: null, playerLoading: true }), false);
    assert.equal(hostCaptionsAvailable({ rendererMounted: true, fallbackMode: null, playerLoading: null }), false);
    assert.equal(hostCaptionsAvailable({ rendererMounted: false, fallbackMode: false, playerLoading: false }), false);
    assert.equal(hostCaptionsAvailable({ rendererMounted: true, fallbackMode: null, playerLoading: false }), true);
    const blocked = publishedNetflixPayload({
      videoId: '82779520',
      title: 'Stranger Things',
      captions: false,
      tracks: parseNetflixTextTracks(publicTracks)
    });
    assert.equal(blocked?.captions, false);
    assert.deepEqual(blocked?.tracks, []);
    const snapshot = readPublishedSnapshot({
      querySelector: () => ({ textContent: JSON.stringify(blocked) })
    });
    assert.equal(snapshot?.captions, false);
    assert.equal(snapshot?.tracks.length, 0);
  });
});
