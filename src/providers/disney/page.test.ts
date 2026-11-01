import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bifTimestampSeconds, parseRokuBif } from '../../media-features/parsers/bif';

import { captionSegmentsForWindow, dedupeCaptionCues } from './adapter';
import { isDisneyHost } from './hosts';
import {
  alignDisneyVttCues,
  disneyBifFrameCount,
  disneyMediaSeekLooksStuck,
  disneyPlayId,
  isDisneyTimelineBif,
  isSafeDisneyBifUrl,
  isSafeDisneyCaptionUrl,
  isSafeDisneyMasterUrl,
  parseDisneyChromeDurationFromHtml,
  parseDisneyClock,
  parseDisneyHlsSubtitles,
  parseDisneyHlsVttPlaylist,
  parseDisneyHlsVttSegments,
  parseDisneyPlaybackPayload,
  parseDisneyThumbnailIndex,
  readDisneyContentTime,
  writeDisneyContentTime
} from './page';

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
    const titled = parseDisneyPlaybackPayload({
      text: { title: { full: 'Loki' } },
      stream: { runtimeMillis: 7_080_000 }
    });
    assert.equal(titled.title, 'Loki');
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

    const longPlaylist = ['#EXTM3U'];
    for (let index = 0; index < 320; index++) {
      longPlaylist.push('#EXTINF:6,', `pts_${index * 6000}.vtt`);
    }
    const longSegments = parseDisneyHlsVttPlaylist(longPlaylist.join('\n'), base);
    assert.equal(longSegments.length, 320);
    assert.equal(longSegments[319].start, 1914);
    const lateWindow = captionSegmentsForWindow(longSegments, 1800);
    assert.ok(lateWindow.length > 0 && lateWindow.length <= 48);
    assert.ok(lateWindow.some((segment) => segment.start <= 1800 && segment.start + segment.duration >= 1800));
    assert.ok(lateWindow.every((segment) => segment.start > 1700));
    assert.deepEqual(dedupeCaptionCues([
      { start: 10, end: 12, text: 'Boundary' },
      { start: 10, end: 12, text: 'Boundary' },
      { start: 13, end: 14, text: 'Next' }
    ]).map((cue) => cue.text), ['Boundary', 'Next']);

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
    const receivingVideo = { dataset: {} } as unknown as HTMLVideoElement;
    assert.equal(writeDisneyContentTime(receivingVideo, 1840.25), 1840.25);
    assert.equal(readDisneyContentTime(receivingVideo), 1840.25);
    assert.equal(writeDisneyContentTime(receivingVideo, Number.NaN), null);
  });

  it('treats a stuck MSE prefix as a failed seek', () => {
    assert.equal(disneyMediaSeekLooksStuck(52, 748), true);
    assert.equal(disneyMediaSeekLooksStuck(52, 40), false);
    assert.equal(disneyMediaSeekLooksStuck(null, 748), false);
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
    assert.equal(bifTimestampSeconds(10_000, 1), 10);
    assert.equal(bifTimestampSeconds(10, 1000), 10);
    assert.equal(bifTimestampSeconds(10_000, 1000), 10);
  });
});
