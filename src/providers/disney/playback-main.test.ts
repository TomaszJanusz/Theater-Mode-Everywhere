import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDisneyHostPlayback } from './playback-main';

const PLAY = 'd1f7a6c2-3b4e-4f5a-9c8d-7e6f5a4b3c2d';
const OTHER = '86e14fdb-3841-4282-ad38-07c8c4aab4b6';

function setup(options: { isPaused?: boolean | null; pause?: () => unknown; play?: () => unknown; omit?: 'pause' | 'play' | 'mediaPlayer' } = {}) {
  const calls: string[] = [];
  const video = {
    paused: false, ended: false, isConnected: true,
    pause() { calls.push('element pause'); this.paused = true; },
    play() { calls.push('element play'); this.paused = false; return Promise.resolve(); }
  };
  const state = { href: `https://www.disneyplus.com/pl-pl/play/${PLAY}`, enabled: true, content: video as unknown as HTMLVideoElement | null };
  const mediaPlayer: Record<string, unknown> = {
    pause: options.pause ?? (() => { calls.push('hive pause'); }),
    play: options.play ?? (() => { calls.push('hive play'); })
  };
  if (options.omit && options.omit !== 'mediaPlayer') delete mediaPlayer[options.omit];
  const web: Record<string, unknown> = { stateStore: { getState: () => (options.isPaused === null ? {} : { player: { extensions: { playback: { isPaused: options.isPaused ?? false } } } }) } };
  if (options.omit !== 'mediaPlayer') web.mediaPlayer = mediaPlayer;
  const host = createDisneyHostPlayback({ enabled: () => state.enabled, href: () => state.href, web: () => web, contentVideo: () => state.content });
  return { calls, video, state, web, mediaPlayer, host: (action: 'play' | 'pause') => host(action, video as unknown as HTMLVideoElement) };
}

describe('Disney+ host playback', () => {
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
    assert.equal(setup({ isPaused: true }).host('pause'), false, 'Hive already shows paused');
  });

  it('acts through Hive alone when it does not report its state', () => {
    const unknown = setup({ isPaused: null });
    assert.equal(unknown.host('pause'), true);
    assert.deepEqual(unknown.calls, ['hive pause'], 'the element is left to Hive');
  });

  it('falls back to the element when Hive refuses later', async () => {
    const refused = setup({ pause: () => Promise.reject(new Error('refused')) });
    assert.equal(refused.host('pause'), true);
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(refused.calls, ['element pause']);
  });

  it('drops a late refusal once a newer request, another title or a replaced player took over', async () => {
    const reject: Array<() => void> = [];
    const pending = () => new Promise<void>((_resolve, fail) => { reject.push(() => fail(new Error('refused'))); });
    const settle = async () => { for (const fail of reject.splice(0)) fail(); await Promise.resolve(); await Promise.resolve(); };

    const newer = setup({ pause: pending });
    newer.host('pause');
    newer.host('pause');
    await settle();
    assert.deepEqual(newer.calls, ['element pause'], 'only the newest request falls back');

    const moved = setup({ pause: pending });
    moved.host('pause');
    moved.state.href = `https://www.disneyplus.com/pl-pl/play/${OTHER}`;
    await settle();
    assert.deepEqual(moved.calls, []);

    const replaced = setup({ pause: pending });
    replaced.host('pause');
    replaced.web.mediaPlayer = { pause() {}, play() {} };
    await settle();
    assert.deepEqual(replaced.calls, []);
  });
});
