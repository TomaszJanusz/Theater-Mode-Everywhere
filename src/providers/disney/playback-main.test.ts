import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDisneyHostPlayback } from './playback-main';

const PLAY = 'd1f7a6c2-3b4e-4f5a-9c8d-7e6f5a4b3c2d';
const OTHER = '86e14fdb-3841-4282-ad38-07c8c4aab4b6';

/** Hive drives the element unless `ignores` says it leaves the call without effect, as a model already in that state does. */
function setup(options: { pause?: () => unknown; play?: () => unknown; omit?: 'pause' | 'play' | 'mediaPlayer'; ignores?: boolean } = {}) {
  const calls: string[] = [];
  const video = {
    paused: false, ended: false, isConnected: true,
    pause() { calls.push('element pause'); this.paused = true; },
    play() { calls.push('element play'); this.paused = false; return Promise.resolve(); }
  };
  const state = { href: `https://www.disneyplus.com/pl-pl/play/${PLAY}`, enabled: true, content: video as unknown as HTMLVideoElement | null };
  const mediaPlayer: Record<string, unknown> = {
    pause: options.pause ?? (() => { calls.push('hive pause'); if (!options.ignores) video.paused = true; }),
    play: options.play ?? (() => { calls.push('hive play'); if (!options.ignores) video.paused = false; })
  };
  if (options.omit && options.omit !== 'mediaPlayer') delete mediaPlayer[options.omit];
  const web: Record<string, unknown> = {};
  if (options.omit !== 'mediaPlayer') web.mediaPlayer = mediaPlayer;
  let next = 0;
  const timers = new Map<number, () => void>();
  const host = createDisneyHostPlayback({
    enabled: () => state.enabled, href: () => state.href, web: () => web, contentVideo: () => state.content,
    setTimeout: callback => { timers.set(++next, callback); return next; }, clearTimeout: id => { timers.delete(id); }
  });
  /** Lets the settle window pass: every check still pending runs. */
  const settle = () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } };
  return { calls, video, state, web, timers, settle, host: (action: 'play' | 'pause') => host(action, video as unknown as HTMLVideoElement) };
}

describe('Disney+ host playback', () => {
  it('asks Hive first and leaves the element to it', () => {
    const paused = setup();
    assert.equal(paused.host('pause'), true);
    paused.settle();
    assert.deepEqual(paused.calls, ['hive pause'], 'the element is not touched once Hive moved it');
    const resumed = setup();
    resumed.video.paused = true;
    assert.equal(resumed.host('play'), true);
    resumed.settle();
    assert.deepEqual(resumed.calls, ['hive play']);
  });

  it('moves the element when Hive left it behind, as a model already in that state does', () => {
    const pause = setup({ ignores: true });
    pause.host('pause');
    assert.deepEqual(pause.calls, ['hive pause'], 'nothing before the window ends');
    pause.settle();
    assert.deepEqual(pause.calls, ['hive pause', 'element pause']);
    const play = setup({ ignores: true });
    play.video.paused = true;
    play.host('play');
    play.settle();
    assert.deepEqual(play.calls, ['hive play', 'element play']);
  });

  it('uses the element when it cannot act through Hive', () => {
    for (const omit of ['pause', 'mediaPlayer'] as const) assert.equal(setup({ omit }).host('pause'), false, `no ${omit}`);
    assert.equal(setup({ omit: 'play' }).host('play'), false);
    assert.equal(setup({ pause: () => { throw new Error('reattaching'); } }).host('pause'), false, 'a throwing call');
    const off = setup();
    off.state.enabled = false;
    assert.equal(off.host('pause'), false, 'Rich Theater Experience off');
    const ended = setup();
    ended.video.ended = true;
    assert.equal(ended.host('play'), false, 'Replay is the element\'s');
    const elsewhere = setup();
    elsewhere.state.href = 'https://www.disneyplus.com/pl-pl/browse/entity-1';
    assert.equal(elsewhere.host('pause'), false, 'no title');
    const other = setup();
    other.state.content = {} as HTMLVideoElement;
    assert.equal(other.host('pause'), false, 'not the content video');
  });

  it('falls back to the element at once when Hive refuses', async () => {
    const refused = setup({ pause: () => Promise.reject(new Error('refused')) });
    assert.equal(refused.host('pause'), true);
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(refused.calls, ['element pause']);
  });

  it('drops a check once a newer request, another title, a replaced player, RTE off or an end took over', async () => {
    const newer = setup({ ignores: true });
    newer.host('pause');
    newer.host('pause');
    assert.equal(newer.timers.size, 1, 'the first request\'s check is cancelled');
    newer.settle();
    assert.deepEqual(newer.calls, ['hive pause', 'hive pause', 'element pause']);

    const reject: Array<() => void> = [];
    const pending = () => new Promise<void>((_resolve, fail) => { reject.push(() => fail(new Error('refused'))); });
    const late = async (change: (host: ReturnType<typeof setup>) => void) => {
      const test = setup({ pause: pending });
      test.host('pause');
      change(test);
      test.settle();
      for (const fail of reject.splice(0)) fail();
      await Promise.resolve();
      await Promise.resolve();
      return test.calls;
    };
    assert.deepEqual(await late(test => { test.state.href = `https://www.disneyplus.com/pl-pl/play/${OTHER}`; }), []);
    assert.deepEqual(await late(test => { test.web.mediaPlayer = { pause() {}, play() {} }; }), []);
    assert.deepEqual(await late(test => { test.state.enabled = false; }), []);
    assert.deepEqual(await late(test => { test.video.ended = true; }), []);
  });
});
