import assert from 'node:assert/strict';
import { it } from 'node:test';

import { holdPlaybackRate, stepPlaybackRate } from './speed-control';

it('steps along the speed menu and stops at either end', () => {
  assert.equal(stepPlaybackRate(1, 1), 1.25);
  assert.equal(stepPlaybackRate(1, -1), 0.75);
  assert.equal(stepPlaybackRate(2, 1), 2);
  assert.equal(stepPlaybackRate(0.25, -1), 0.25);
});

it('moves a host rate off the menu to the nearest level in the pressed direction', () => {
  assert.equal(stepPlaybackRate(1.1, 1), 1.25);
  assert.equal(stepPlaybackRate(1.1, -1), 1);
  assert.equal(stepPlaybackRate(3, -1), 2);
  assert.equal(stepPlaybackRate(3, 1), 3, 'a faster host rate is never lowered by speeding up');
});

const target = (playbackRate: number) => ({ element: {} as HTMLElement, playbackRate });

it('holds a rate and gives the previous one back on release, once', () => {
  const video = target(1.5);
  const release = holdPlaybackRate(video, 2);
  assert.equal(video.playbackRate, 2);
  release();
  assert.equal(video.playbackRate, 1.5);
  video.playbackRate = 2;
  release();
  assert.equal(video.playbackRate, 2, 'a second release changes nothing');
});

it('keeps a rate chosen during the hold', () => {
  const video = target(1);
  const release = holdPlaybackRate(video, 2);
  video.playbackRate = 1.75;
  release();
  assert.equal(video.playbackRate, 1.75);
});
