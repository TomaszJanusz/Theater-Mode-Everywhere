import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DisposableScope } from '../core/disposable-scope';
import type { PlaybackSurface } from '../playback-surface';
import { createFullscreenRecovery } from './fullscreen-recovery';
import { togglePictureInPicture } from './picture-in-picture';
import { waitForSeekCompletion } from './seek-completion';

function fixture() {
  const events = new EventTarget();
  let plays = 0;
  let listeners = 0;
  const video = {
    nativeMedia: null,
    paused: false,
    capabilities: { pictureInPicture: true },
    play: async () => { plays++; },
    addEventListener: (type: string, listener: EventListener) => {
      listeners++;
      events.addEventListener(type, listener);
    },
    removeEventListener: (type: string, listener: EventListener) => {
      listeners--;
      events.removeEventListener(type, listener);
    }
  } as unknown as PlaybackSurface;
  return { video, events, plays: () => plays, listeners: () => listeners };
}

describe('fullscreen playback recovery', () => {
  it('resumes once after the request and matching fullscreen event', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture();
    const recovery = createFullscreenRecovery(new DisposableScope(), f.video, () => true, () => 0);
    const operation = recovery.begin();
    f.video.paused = true;
    recovery.onFullscreenChange();
    operation.schedule();
    t.mock.timers.tick(150);
    assert.equal(f.plays(), 1);
    assert.equal(operation.isCurrent(), false);
    recovery.onFullscreenChange();
    t.mock.timers.tick(150);
    assert.equal(f.plays(), 1);
  });

  it('rejects a promise settling after exit and cancels an already queued resume', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture();
    const owner = new DisposableScope();
    const recovery = createFullscreenRecovery(owner, f.video, () => true, () => 0);
    const operation = recovery.begin();
    f.video.paused = true;
    operation.schedule();
    owner.dispose();
    operation.schedule();
    t.mock.timers.tick(150);
    assert.equal(f.plays(), 0);
    assert.equal(operation.isCurrent(), false);
  });

  it('rejects an old media binding and later playback decisions', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    for (const reason of ['media', 'decision']) {
      const f = fixture();
      let currentMedia = true;
      let revision = 0;
      const recovery = createFullscreenRecovery(new DisposableScope(), f.video, () => currentMedia, () => revision);
      recovery.begin().schedule();
      f.video.paused = true;
      if (reason === 'media') currentMedia = false;
      else revision++;
      t.mock.timers.tick(150);
      assert.equal(f.plays(), 0, reason);
    }
  });

  it('takes playing state per operation and supersedes earlier requests', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture();
    const recovery = createFullscreenRecovery(new DisposableScope(), f.video, () => true, () => 0);
    const first = recovery.begin();
    first.schedule();
    f.video.paused = true;
    recovery.begin().schedule();
    first.schedule();
    t.mock.timers.tick(150);
    assert.equal(f.plays(), 0);
    assert.equal(first.isCurrent(), false);
  });

  it('rejects source replacement on the same native element', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture();
    const native = { currentSrc: 'first.mp4', getAttribute: () => 'first.mp4', srcObject: null };
    Object.defineProperty(f.video, 'nativeMedia', { value: native });
    const recovery = createFullscreenRecovery(new DisposableScope(), f.video, () => true, () => 0);
    recovery.begin().schedule();
    f.video.paused = true;
    native.currentSrc = 'next.mp4';
    t.mock.timers.tick(150);
    assert.equal(f.plays(), 0);
  });
});

describe('drag seek completion lifetime', () => {
  it('removes the temporary listener and timeout when seeked wins', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture();
    let completions = 0;
    waitForSeekCompletion(new DisposableScope(), f.video, () => completions++);
    assert.equal(f.listeners(), 1);
    f.events.dispatchEvent(new Event('seeked'));
    assert.equal(f.listeners(), 0);
    t.mock.timers.tick(150);
    assert.equal(completions, 1);
  });

  it('removes the listener on fallback or teardown without stale completion', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    for (const teardown of [false, true]) {
      const f = fixture();
      const scope = new DisposableScope();
      let completions = 0;
      waitForSeekCompletion(scope, f.video, () => completions++);
      if (teardown) scope.dispose();
      t.mock.timers.tick(150);
      f.events.dispatchEvent(new Event('seeked'));
      assert.equal(f.listeners(), 0);
      assert.equal(completions, teardown ? 0 : 1);
    }
  });
});

describe('shared Picture-in-Picture command', () => {
  it('enforces the same native capability and document guards for both entry points', () => {
    const f = fixture();
    let requests = 0;
    f.video.requestPictureInPicture = async () => { requests++; };
    const doc = { pictureInPictureEnabled: false, pictureInPictureElement: null } as unknown as Document;
    togglePictureInPicture(f.video, doc);
    f.video.capabilities.pictureInPicture = false;
    Object.defineProperty(doc, 'pictureInPictureEnabled', { value: true });
    togglePictureInPicture(f.video, doc);
    assert.equal(requests, 0);
    f.video.capabilities.pictureInPicture = true;
    togglePictureInPicture(f.video, doc);
    assert.equal(requests, 1);
  });

  it('handles synchronous failures and rejected enter/exit requests', async t => {
    const f = fixture();
    const log = t.mock.method(console, 'error', () => {});
    const doc = { pictureInPictureEnabled: true, pictureInPictureElement: null } as unknown as Document;
    f.video.requestPictureInPicture = () => { throw new Error('enter sync'); };
    assert.doesNotThrow(() => togglePictureInPicture(f.video, doc));
    f.video.requestPictureInPicture = async () => { throw new Error('enter async'); };
    togglePictureInPicture(f.video, doc);
    Object.defineProperty(doc, 'pictureInPictureElement', { value: {} });
    doc.exitPictureInPicture = () => { throw new Error('exit sync'); };
    assert.doesNotThrow(() => togglePictureInPicture(f.video, doc));
    doc.exitPictureInPicture = async () => { throw new Error('exit async'); };
    togglePictureInPicture(f.video, doc);
    await Promise.resolve();
    assert.equal(log.mock.callCount(), 4);
  });
});
