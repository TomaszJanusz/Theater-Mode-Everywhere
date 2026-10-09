import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isSwitchableTheaterVideo,
  selectSwitchableVideos
} from './switchable-videos';

function fakeVideo(init: {
  currentSrc?: string;
  src?: string;
  srcObject?: unknown;
  sourceEl?: unknown;
  visibility?: string;
  hosts?: string[];
  videoWidth?: number;
  videoHeight?: number;
  readyState?: number;
  duration?: number;
  clientWidth?: number;
  clientHeight?: number;
  box?: { width: number; height: number };
}): HTMLVideoElement {
  const hosts = init.hosts || [];
  const box = init.box || { width: init.clientWidth ?? 880, height: init.clientHeight ?? 495 };
  return {
    currentSrc: init.currentSrc ?? '',
    ownerDocument: { defaultView: { getComputedStyle: () => ({ visibility: init.visibility ?? 'visible', display: 'block' }) } },
    src: init.src ?? '',
    srcObject: init.srcObject ?? null,
    querySelector: () => init.sourceEl ?? null,
    closest: (selector: string) => {
      const tokens = selector.split(',').map((token) => token.trim());
      return tokens.some((token) => hosts.includes(token)) ? { id: 'host' } : null;
    },
    videoWidth: init.videoWidth ?? 0,
    videoHeight: init.videoHeight ?? 0,
    readyState: init.readyState ?? 0,
    duration: init.duration ?? Number.NaN,
    clientWidth: init.clientWidth ?? box.width,
    clientHeight: init.clientHeight ?? box.height,
    getBoundingClientRect: () => ({
      width: box.width,
      height: box.height,
      top: 0,
      left: 0,
      right: box.width,
      bottom: box.height,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })
  } as unknown as HTMLVideoElement;
}

function mainYouTubeVideo(): HTMLVideoElement {
  return fakeVideo({
    currentSrc: 'blob:https://www.youtube.com/main',
    videoWidth: 1920,
    videoHeight: 1080,
    readyState: 4,
    duration: 2371,
    box: { width: 880, height: 495 }
  });
}

describe('switchable theater videos', () => {
  it('ignores empty leftover videos with no source or metadata', () => {
    assert.equal(isSwitchableTheaterVideo(fakeVideo({
      box: { width: 880, height: 495 }
    })), false);
  });

  it('ignores a hidden ThumbPlayer standby even when it retains a source and decoded dimensions', () => {
    const current = fakeVideo({ currentSrc: 'blob:https://v.qq.com/current', readyState: 4, duration: 2812,
      videoWidth: 1920, videoHeight: 1080, hosts: ['.txp_videos_container'] });
    const spare = fakeVideo({ currentSrc: 'blob:https://v.qq.com/spare', readyState: 0,
      videoWidth: 1920, videoHeight: 1080, visibility: 'hidden', hosts: ['.txp_videos_container'] });
    assert.equal(isSwitchableTheaterVideo(spare), false);
    assert.deepEqual(selectSwitchableVideos([spare, current]), [current]);
  });

  it('offers only the main video when other sourced players are Shorts, previews or miniplayers', () => {
    const preview = fakeVideo({
      currentSrc: 'blob:https://www.youtube.com/preview',
      videoWidth: 640,
      videoHeight: 360,
      readyState: 4,
      duration: 12,
      hosts: ['ytd-video-preview'],
      box: { width: 228, height: 124 }
    });
    const inline = fakeVideo({
      currentSrc: 'blob:https://www.youtube.com/inline',
      videoWidth: 640,
      videoHeight: 360,
      readyState: 4,
      duration: 12,
      hosts: ['#inline-player'],
      box: { width: 228, height: 124 }
    });
    const mini = fakeVideo({
      currentSrc: 'blob:https://www.youtube.com/mini',
      videoWidth: 640,
      videoHeight: 360,
      readyState: 4,
      duration: 40,
      hosts: ['ytd-miniplayer'],
      box: { width: 400, height: 225 }
    });
    const shorts = fakeVideo({
      currentSrc: 'blob:https://www.youtube.com/shorts-leftover',
      videoWidth: 1920,
      videoHeight: 1080,
      readyState: 4,
      duration: 12,
      hosts: ['#shorts-player', 'ytd-shorts']
    });

    assert.equal(isSwitchableTheaterVideo(preview), false);
    assert.equal(isSwitchableTheaterVideo(inline), false);
    assert.equal(isSwitchableTheaterVideo(mini), false);
    assert.equal(isSwitchableTheaterVideo(shorts), false);
    const main = mainYouTubeVideo();
    assert.deepEqual(selectSwitchableVideos([main, preview, inline, mini, shorts]), [main]);
  });

  it('ignores zero-size players even when they still have a blob src', () => {
    assert.equal(isSwitchableTheaterVideo(fakeVideo({
      currentSrc: 'blob:https://www.youtube.com/dead',
      readyState: 1,
      duration: 6,
      box: { width: 0, height: 0 },
      clientWidth: 0,
      clientHeight: 0
    })), false);
  });

  it('still offers switch between two real players', () => {
    const a = mainYouTubeVideo();
    const b = fakeVideo({
      currentSrc: 'https://cdn.example.com/clip.mp4',
      videoWidth: 1280,
      videoHeight: 720,
      readyState: 4,
      duration: 30,
      box: { width: 640, height: 360 }
    });
    assert.deepEqual(selectSwitchableVideos([a, b]), [a, b]);
  });

  it('keeps the current theater video in the cycle list even if it is auxiliary', () => {
    const preview = fakeVideo({
      currentSrc: 'blob:https://www.youtube.com/preview',
      videoWidth: 640,
      videoHeight: 360,
      readyState: 4,
      hosts: ['#inline-player'],
      box: { width: 228, height: 124 }
    });
    const main = mainYouTubeVideo();
    assert.deepEqual(selectSwitchableVideos([main, preview], preview), [preview, main]);
  });
});
