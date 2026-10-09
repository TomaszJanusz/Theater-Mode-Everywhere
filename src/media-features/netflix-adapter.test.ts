import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NetflixAdapter, requestNetflixHostCaption } from './netflix-adapter';
import {
  NETFLIX_CAPTION_ACK_EVENT,
  NETFLIX_CAPTION_EVENT,
  NETFLIX_SNAPSHOT_ID,
  netflixCaptionAckDetail,
  parseNetflixCaptionRequest,
  parseNetflixTextTracks
} from './parsers/netflix-page';
import { publishedNetflixPayload } from '../providers/netflix/main';

const rawTracks = [
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
  }
];

class TestWindow extends EventTarget {
  setTimeout(handler: TimerHandler, timeout?: number): number {
    return globalThis.setTimeout(handler, timeout) as unknown as number;
  }

  clearTimeout(id?: number): void {
    globalThis.clearTimeout(id);
  }
}

function installSnapshot(): void {
  const payload = publishedNetflixPayload({
    videoId: '82779520',
    title: 'Stranger Things',
    tracks: parseNetflixTextTracks(rawTracks)
  });
  const node = { textContent: JSON.stringify(payload) };
  Object.assign(globalThis, {
    document: {
      querySelector: (selector: string) => (selector === `#${NETFLIX_SNAPSHOT_ID}` ? node : null)
    }
  });
}

describe('Netflix caption request bridge', () => {
  it('rounds the published snapshot through Off with a string ack', async () => {
    installSnapshot();
    const target = new TestWindow();
    const seen: string[] = [];
    target.addEventListener(NETFLIX_CAPTION_EVENT, ((event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      assert.equal(typeof detail, 'string');
      const request = parseNetflixCaptionRequest(detail);
      assert.ok(request);
      assert.equal(request?.trackId, null);
      seen.push(request?.requestId || '');
      target.dispatchEvent(new CustomEvent(NETFLIX_CAPTION_ACK_EVENT, {
        detail: netflixCaptionAckDetail({ requestId: request!.requestId, ok: true })
      }));
    }) as EventListener);
    const previous = globalThis.window;
    Object.assign(globalThis, { window: target });
    try {
      const adapter = new NetflixAdapter();
      const tracks = await adapter.listCaptionTracks();
      assert.equal(tracks.find((track) => track.language === 'en')?.kind, 'captions');
      assert.equal(tracks.some((track) => track.label === 'wył.'), false);
      assert.deepEqual(await adapter.activateCaptionTrack(null), { status: 'off', delivery: 'none', cues: [] });
      assert.equal(seen.length, 1);
    } finally {
      Object.assign(globalThis, { window: previous });
    }
  });

  it('fails when MAIN acks that the track was not applied', async () => {
    const target = new TestWindow();
    target.addEventListener(NETFLIX_CAPTION_EVENT, ((event: Event) => {
      const request = parseNetflixCaptionRequest((event as CustomEvent<unknown>).detail);
      target.dispatchEvent(new CustomEvent(NETFLIX_CAPTION_ACK_EVENT, {
        detail: netflixCaptionAckDetail({ requestId: request!.requestId, ok: false })
      }));
    }) as EventListener);
    assert.equal(await requestNetflixHostCaption('T:2:1;1;pl;0;0;0;0;', target as unknown as Window, 30), false);
  });

  it('times out, ignores a late ack, and rejects an object detail', async () => {
    const target = new TestWindow();
    let requestId = '';
    target.addEventListener(NETFLIX_CAPTION_EVENT, ((event: Event) => {
      requestId = parseNetflixCaptionRequest((event as CustomEvent<unknown>).detail)?.requestId || '';
    }) as EventListener);
    assert.equal(await requestNetflixHostCaption(null, target as unknown as Window, 15), false);
    target.dispatchEvent(new CustomEvent(NETFLIX_CAPTION_ACK_EVENT, {
      detail: netflixCaptionAckDetail({ requestId, ok: true })
    }));
  });

  it('sends Off after captions are withdrawn and does not activate a language', async () => {
    const payload = publishedNetflixPayload({
      videoId: '82779520',
      title: 'Stranger Things',
      captions: false,
      tracks: parseNetflixTextTracks(rawTracks)
    });
    const node = { textContent: JSON.stringify(payload) };
    Object.assign(globalThis, {
      document: {
        querySelector: (selector: string) => (selector === `#${NETFLIX_SNAPSHOT_ID}` ? node : null)
      }
    });
    const target = new TestWindow();
    const requested: Array<string | null> = [];
    target.addEventListener(NETFLIX_CAPTION_EVENT, ((event: Event) => {
      const request = parseNetflixCaptionRequest((event as CustomEvent<unknown>).detail);
      assert.ok(request);
      requested.push(request?.trackId ?? null);
      target.dispatchEvent(new CustomEvent(NETFLIX_CAPTION_ACK_EVENT, {
        detail: netflixCaptionAckDetail({ requestId: request!.requestId, ok: true })
      }));
    }) as EventListener);
    const previous = globalThis.window;
    Object.assign(globalThis, { window: target });
    try {
      const adapter = new NetflixAdapter();
      assert.deepEqual(await adapter.listCaptionTracks(), []);
      assert.deepEqual(await adapter.activateCaptionTrack(null), { status: 'off', delivery: 'none', cues: [] });
      assert.deepEqual(
        await adapter.activateCaptionTrack('netflix:T:2:1;1;pl;0;0;0;0;'),
        { status: 'failed', delivery: 'none', cues: [] }
      );
      assert.deepEqual(requested, [null]);
    } finally {
      Object.assign(globalThis, { window: previous });
    }
  });
});
