import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  chooseNetflixRawTrack,
  netflixHarvestKey,
  netflixSnapshotMatchesVideo,
  parseNetflixCaptionRequest,
  parseNetflixTextTracks,
  parsePublishedNetflixTracks,
  readPublishedNetflixSnapshot,
  resolveNetflixTitle,
  selectableNetflixTextTracks,
  selectNetflixCaptionTarget,
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
    assert.deepEqual(selectableNetflixTextTracks(tracks).map((track) => track.language), ['pl', 'en']);
    assert.equal(selectableNetflixTextTracks(tracks)[1].kind, 'captions');
    assert.equal(selectNetflixCaptionTarget(tracks, 'T:2:1;1;pl;0;0;0;0;')?.label, 'polski');
    assert.equal(selectNetflixCaptionTarget(tracks, null)?.none, true);
    assert.equal(selectNetflixCaptionTarget(tracks, 'https://example.invalid/secret'), null);
  });

  it('drops a snapshot when the open video id changes', () => {
    assert.equal(netflixSnapshotMatchesVideo('82779520', '82779520'), true);
    assert.equal(netflixSnapshotMatchesVideo('82779520', '80057281'), false);
    assert.equal(netflixSnapshotMatchesVideo(undefined, '80057281'), true);
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
    const snapshot = readPublishedNetflixSnapshot(root);
    assert.equal(snapshot?.videoId, '82779520');
    assert.equal(snapshot?.title, 'Stranger Things');
    assert.equal(snapshot?.tracks.length, 3);
    assert.equal(snapshot?.tracks.find((track) => track.language === 'en')?.kind, 'captions');
    assert.equal(snapshot?.tracks.find((track) => track.none)?.forced, true);
    assert.equal(snapshot?.selectedTrackId, 'T:2:1;1;pl;0;0;0;0;');
    assert.equal(selectableNetflixTextTracks(snapshot?.tracks || []).some((track) => track.none), false);
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
    const tracks = parsePublishedNetflixTracks(published);
    assert.equal(tracks[0].none, true);
    assert.equal(tracks[0].forced, true);
    assert.equal(tracks[1].kind, 'captions');
    assert.deepEqual(selectableNetflixTextTracks(tracks).map((track) => track.language), ['en']);
    assert.equal(parseNetflixTextTracks(published).find((track) => track.language === 'en')?.kind, 'subtitles');
  });

  it('treats a missing player id as the same harvest as an unset one', () => {
    const empty = { tracks: [] as Array<{ id: string; kind: 'subtitles'; forced: boolean; none: boolean }> };
    assert.equal(netflixHarvestKey({ ...empty, videoId: null, title: null }), netflixHarvestKey(empty));
    assert.equal(selectNetflixCaptionTarget(parseNetflixTextTracks(publicTracks), 'T:2:0;1;pl;1;1;0;0;'), null);
    const off = chooseNetflixRawTrack(publicTracks, null) as { displayName?: string; isForcedNarrative?: boolean };
    assert.equal(off.displayName, 'wył.');
    assert.equal(off.isForcedNarrative, true);
    assert.equal(parseNetflixCaptionRequest({ requestId: 'te-nf-abc', trackId: null }), null);
  });
});
