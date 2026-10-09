import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reloadForVolumeBoost } from './volume-boost-reload';
import { resolveVolumeBoostEnabled } from '../ui/volume-boost-settings';

class Video extends EventTarget {
  attrs = new Map<string, string>([['src', 'https://example.com/clip.mp4']]);
  currentSrc = 'https://example.com/clip.mp4';
  srcObject = null;
  currentTime = 17;
  paused = false;
  loads = 0;
  plays = 0;
  sources: Array<{ getAttribute(name: string): string | null }> = [];
  get src() { return this.attrs.get('src') || ''; }
  get crossOrigin() { return this.attrs.get('crossorigin') || null; }
  set crossOrigin(value: string | null) { if (value === null) this.attrs.delete('crossorigin'); else this.attrs.set('crossorigin', value); }
  getAttribute(name: string) { return this.attrs.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  removeAttribute(name: string) { this.attrs.delete(name); }
  querySelectorAll() { return this.sources; }
  load() { this.loads += 1; this.currentTime = 0; }
  play() { this.plays += 1; return Promise.resolve(); }
}

function start(video: Video, overrides: Partial<{ isCurrent(): boolean; canResume(): boolean }> = {}) {
  const abort = new AbortController();
  const cancel = reloadForVolumeBoost(video as unknown as HTMLVideoElement, {
    signal: abort.signal, isCurrent: () => true, canResume: () => true, ...overrides
  });
  return { abort, cancel };
}

describe('Volume Boost CORS reload ownership', () => {
  it('removes both terminal listeners after success and preserves source selection', () => {
    const video = new Video();
    start(video);
    video.dispatchEvent(new Event('canplay'));
    assert.equal(video.currentTime, 17);
    assert.equal(video.plays, 1);
    assert.equal(video.crossOrigin, 'anonymous');
    video.currentTime = 32;
    video.dispatchEvent(new Event('error'));
    video.dispatchEvent(new Event('canplay'));
    assert.equal(video.loads, 1);
    assert.equal(video.currentTime, 32);
    assert.equal(video.src, video.currentSrc);
  });

  it('restores playback once after a CORS failure and ignores later errors', () => {
    const video = new Video();
    start(video);
    video.dispatchEvent(new Event('error'));
    assert.equal(video.crossOrigin, null);
    assert.equal(video.loads, 2);
    assert.equal(video.plays, 0);
    video.dispatchEvent(new Event('canplay'));
    assert.equal(video.currentTime, 17);
    assert.equal(video.plays, 1);
    video.dispatchEvent(new Event('error'));
    assert.equal(video.loads, 2);
  });

  it('cancels on exit or rebind without reviving old playback', () => {
    for (const action of ['exit', 'rebind'] as const) {
      const video = new Video();
      const operation = start(video);
      if (action === 'exit') operation.cancel();
      else operation.abort.abort();
      video.dispatchEvent(new Event('canplay'));
      video.dispatchEvent(new Event('error'));
      assert.equal(video.crossOrigin, null);
      assert.equal(video.currentTime, 0);
      assert.equal(video.plays, 0);
      assert.equal(video.loads, 2);
    }
  });

  it('rejects source/player changes and newer pause decisions', () => {
    const replaced = new Video();
    start(replaced);
    replaced.setAttribute('src', 'https://example.com/next.mp4');
    replaced.currentTime = 42;
    replaced.dispatchEvent(new Event('error'));
    assert.equal(replaced.src, 'https://example.com/next.mp4');
    assert.equal(replaced.currentTime, 42);
    assert.equal(replaced.loads, 1);
    assert.equal(replaced.plays, 0);

    const stale = new Video();
    start(stale, { isCurrent: () => false });
    stale.dispatchEvent(new Event('canplay'));
    assert.equal(stale.currentTime, 0);
    assert.equal(stale.plays, 0);

    const paused = new Video();
    start(paused, { canResume: () => false });
    paused.dispatchEvent(new Event('canplay'));
    assert.equal(paused.currentTime, 17);
    assert.equal(paused.plays, 0);
  });

  it('keeps source children instead of replacing them with a src attribute', () => {
    const video = new Video();
    video.removeAttribute('src');
    video.sources = [{ getAttribute: name => name === 'src' ? 'https://example.com/clip.mp4' : null }];
    start(video);
    assert.equal(video.getAttribute('src'), null);
    video.dispatchEvent(new Event('error'));
    video.dispatchEvent(new Event('canplay'));
    assert.equal(video.getAttribute('src'), null);
    assert.equal(video.currentTime, 17);
    assert.equal(video.plays, 1);
  });

  it('rejects host CORS takeover during fallback', () => {
    const video = new Video();
    start(video);
    video.dispatchEvent(new Event('error'));
    video.crossOrigin = 'use-credentials';
    video.currentTime = 31;
    video.dispatchEvent(new Event('canplay'));
    assert.equal(video.crossOrigin, 'use-credentials');
    assert.equal(video.currentTime, 31);
    assert.equal(video.plays, 0);
  });

  it('preserves newer host CORS attributes during cancellation', () => {
    const video = new Video();
    const { cancel } = start(video);
    video.crossOrigin = 'use-credentials';
    cancel();
    assert.equal(video.crossOrigin, 'use-credentials');
  });
});

it('interprets Volume Boost consistently for absent and malformed saved values', () => {
  for (const value of [undefined, null, false, 0, 1, 'true', {}, []]) assert.equal(resolveVolumeBoostEnabled(value), false);
  assert.equal(resolveVolumeBoostEnabled(true), true);
});
