import assert from 'node:assert/strict';
import { it } from 'node:test';
import { chooseActivatorSpot, samplePoints, spotBox, type ActivatorSpot, type Box } from './video-activator-placement';

const video: Box = { left: 100, top: 80, width: 640, height: 360 };
const viewport = { width: 1000, height: 700 };
const order: ActivatorSpot[] = ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'top-center', 'bottom-center'];
const inside = (box: Box, x: number, y: number) => x >= box.left && x <= box.left + box.width
  && y >= box.top && y <= box.top + box.height;
const freeExcept = (spots: ActivatorSpot[], geometry = video) => (x: number, y: number) =>
  !spots.some(spot => inside(spotBox(geometry, spot), x, y));

it('tries all corners before the upper and lower centre, then gives up', () => {
  for (let occupied = 0; occupied <= order.length; occupied++) {
    assert.equal(chooseActivatorSpot(video, viewport, freeExcept(order.slice(0, occupied)))?.spot ?? null,
      order[occupied] ?? null);
  }
});

it('keeps any previous slot first and returns to normal order if it becomes occupied', () => {
  for (const preferred of order) {
    assert.equal(chooseActivatorSpot(video, viewport, () => true, { preferred })?.spot, preferred);
    assert.equal(chooseActivatorSpot(video, viewport, freeExcept([preferred]), { preferred })?.spot,
      order.find(spot => spot !== preferred));
  }
});

it('centres the button at one-third and two-thirds of video height, including a small eligible video', () => {
  for (const geometry of [video, { left: 0, top: 0, width: 240, height: 135 }]) {
    for (const [spot, fraction] of [['top-center', 1 / 3], ['bottom-center', 2 / 3]] as const) {
      const box = spotBox(geometry, spot);
      assert.equal(box.left + box.width / 2, geometry.left + geometry.width / 2);
      assert.equal(box.top + box.height / 2, geometry.top + geometry.height * fraction);
      assert.ok(box.top >= geometry.top && box.top + box.height <= geometry.top + geometry.height);
      assert.equal(chooseActivatorSpot(geometry, viewport, freeExcept(order.filter(s => s !== spot), geometry))?.spot, spot);
    }
  }
});

it('rejects either centre slot if even one grid sample is occupied', () => {
  for (const spot of ['top-center', 'bottom-center'] as const) {
    for (const [blockedX, blockedY] of samplePoints(spotBox(video, spot))) {
      const otherSlotsBlocked = freeExcept(order.filter(s => s !== spot));
      assert.equal(chooseActivatorSpot(video, viewport,
        (x, y) => otherSlotsBlocked(x, y) && !(x === blockedX && y === blockedY)), null);
    }
  }
});

it('native controls allow the upper centre but skip the lower centre even when preferred', () => {
  const corners = order.slice(0, 4);
  assert.equal(chooseActivatorSpot(video, viewport, freeExcept(corners), { bottomBlocked: true })?.spot, 'top-center');
  assert.equal(chooseActivatorSpot(video, viewport, freeExcept([...corners, 'top-center']),
    { bottomBlocked: true, preferred: 'bottom-center' }), null);
});

it('does not probe centre slots outside the viewport', () => {
  const seen: Array<[number, number]> = [];
  assert.equal(chooseActivatorSpot({ ...video, left: -500 }, viewport, (x, y) => { seen.push([x, y]); return false; }), null);
  assert.ok(seen.every(([x, y]) => x >= 0 && y >= 0 && x <= viewport.width && y <= viewport.height));
});
