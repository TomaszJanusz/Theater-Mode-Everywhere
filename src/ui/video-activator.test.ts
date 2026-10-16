import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  activatorZoneMargin,
  isInActivatorZone,
  nearestActivatorVideo,
  ACTIVATOR_MARGIN,
  ACTIVATOR_SIZE,
  chooseActivatorSpot,
  isActivatorVideoEligible,
  samplePoints,
  spotBox,
  type ActivatorVideoFacts,
  type Box
} from './video-activator-placement';
import { DEFAULT_VIDEO_ACTIVATOR, resolveVideoActivator } from './video-activator-settings';

const video: Box = { left: 100, top: 100, width: 640, height: 360 };
const viewport = { width: 1280, height: 720 };
const inside = (box: Box, x: number, y: number) => x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height;

describe('video activator settings', () => {
  it('defaults on and only an explicit boolean changes it', () => {
    assert.equal(DEFAULT_VIDEO_ACTIVATOR, true);
    for (const value of [undefined, null, 'false', 0, 1, {}, []]) assert.equal(resolveVideoActivator(value), true);
    assert.equal(resolveVideoActivator(false), false);
    assert.equal(resolveVideoActivator(true), true);
  });
});

describe('video activator eligibility', () => {
  const ok: ActivatorVideoFacts = {
    width: 640, height: 360, visible: true, playable: true, muted: false, loop: false,
    inExtensionUi: false, pictureInPicture: false
  };
  it('accepts a normal player and muted or looping video separately', () => {
    assert.equal(isActivatorVideoEligible(ok), true);
    assert.equal(isActivatorVideoEligible({ ...ok, muted: true }), true);
    assert.equal(isActivatorVideoEligible({ ...ok, loop: true }), true);
  });
  it('rejects previews, tiny, hidden, unplayable, extension and picture-in-picture videos', () => {
    for (const patch of [
      { muted: true, loop: true }, { width: 239 }, { height: 134 }, { visible: false },
      { playable: false }, { inExtensionUi: true }, { pictureInPicture: true }
    ]) assert.equal(isActivatorVideoEligible({ ...ok, ...patch }), false, JSON.stringify(patch));
  });
});

describe('video activator placement', () => {
  it('insets each corner by the margin inside the video box', () => {
    assert.deepEqual(spotBox(video, 'top-left'), { left: 112, top: 112, width: ACTIVATOR_SIZE, height: ACTIVATOR_SIZE });
    assert.deepEqual(spotBox(video, 'bottom-right'),
      { left: 100 + 640 - ACTIVATOR_MARGIN - ACTIVATOR_SIZE, top: 100 + 360 - ACTIVATOR_MARGIN - ACTIVATOR_SIZE, width: ACTIVATOR_SIZE, height: ACTIVATOR_SIZE });
  });
  it('samples a 3x3 grid inside the box', () => {
    const points = samplePoints(spotBox(video, 'top-left'));
    assert.equal(points.length, 9);
    for (const [x, y] of points) assert.ok(inside(spotBox(video, 'top-left'), x, y));
  });
  it('takes the default corner when everything is free', () => {
    assert.equal(chooseActivatorSpot(video, viewport, () => true)?.spot, 'top-right');
  });
  it('moves past an occupied corner and keeps the previous spot first', () => {
    const topRight = spotBox(video, 'top-right');
    const busy = (x: number, y: number) => !inside(topRight, x, y);
    assert.equal(chooseActivatorSpot(video, viewport, busy)?.spot, 'top-left');
    assert.equal(chooseActivatorSpot(video, viewport, () => true, { preferred: 'bottom-left' })?.spot, 'bottom-left');
    // The preferred spot loses to a free one only when it is covered.
    const bottomLeft = spotBox(video, 'bottom-left');
    assert.equal(chooseActivatorSpot(video, viewport, (x, y) => !inside(bottomLeft, x, y), { preferred: 'bottom-left' })?.spot, 'top-right');
  });
  it('rejects a corner when a single sample point is covered', () => {
    const [x, y] = samplePoints(spotBox(video, 'top-right'))[8];
    assert.equal(chooseActivatorSpot(video, viewport, (px, py) => !(px === x && py === y))?.spot, 'top-left');
  });
  it('returns nothing when no corner is free, rather than covering page UI', () => {
    assert.equal(chooseActivatorSpot(video, viewport, () => false), null);
  });
  it('skips the bottom row above a native control bar', () => {
    const top = [spotBox(video, 'top-right'), spotBox(video, 'top-left')];
    const freeBottomOnly = (x: number, y: number) => !top.some(box => inside(box, x, y));
    assert.equal(chooseActivatorSpot(video, viewport, freeBottomOnly)?.spot, 'bottom-right');
    assert.equal(chooseActivatorSpot(video, viewport, freeBottomOnly, { bottomBlocked: true }), null);
  });
  it('never offers a corner outside the viewport', () => {
    const scrolled: Box = { left: 100, top: -250, width: 640, height: 360 };
    assert.equal(chooseActivatorSpot(scrolled, viewport, () => true)?.spot, 'bottom-right');
    assert.equal(chooseActivatorSpot({ left: -700, top: 0, width: 640, height: 360 }, viewport, () => true), null);
  });
});

describe('video activator proximity', () => {
  it('uses the shorter edge with a 24–80px bound', () => {
    assert.equal(activatorZoneMargin({ ...video, width: 240, height: 135 }), 24);
    assert.equal(activatorZoneMargin(video), 36);
    assert.equal(activatorZoneMargin({ ...video, width: 3840, height: 2160 }), 80);
  });
  it('includes the video, each expanded edge and corner, but nothing beyond the zone', () => {
    for (const [x, y] of [[100, 100], [400, 280], [64, 64], [776, 496]]) {
      assert.equal(isInActivatorZone(video, x, y), true);
    }
    for (const [x, y] of [[63, 100], [100, 63], [777, 100], [100, 497]]) {
      assert.equal(isInActivatorZone(video, x, y), false);
    }
  });
  it('chooses the nearest rectangle, breaks ties by input order, and ignores distant candidates', () => {
    const a = { id: 'a', box: video };
    const b = { id: 'b', box: { ...video, left: 780 } };
    assert.equal(nearestActivatorVideo([a, b], 750, 200), a);
    assert.equal(nearestActivatorVideo([a, b], 770, 200), b);
    assert.equal(nearestActivatorVideo([a, b], 760, 200), a);
    assert.equal(nearestActivatorVideo([b, a], 760, 200), b);
    assert.equal(nearestActivatorVideo([a, b], 500, 200), a);
    assert.equal(nearestActivatorVideo([a, b], 0, 0), null);
    assert.equal(nearestActivatorVideo([], 500, 200), null);
  });
});
