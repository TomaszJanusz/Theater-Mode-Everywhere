import assert from 'node:assert/strict';
import { it } from 'node:test';
import { sponsorBlockMarker, SPONSORBLOCK_COLORS } from './sponsorblock-model';
import { resolveSponsorBlockMarkers } from '../../ui/sponsorblock-settings';

const input = { left: '10%', right: '70%', category: 'sponsor', color: '', opacity: '.4' };
it('translates normalized intervals, points and custom colors without executing styles', () => {
  assert.deepEqual(sponsorBlockMarker(input), { start: .1, end: .30000000000000004,
    color: '#00d400', opacity: .4, labelKey: 'sponsorBlockCategory_sponsor' });
  assert.equal(sponsorBlockMarker({ ...input, right: '' })?.end, .1);
  assert.equal(sponsorBlockMarker({ ...input, category: 'preview-sponsor' })?.color, '#007800');
  assert.equal(sponsorBlockMarker({ ...input, color: 'rgb(1, 2, 3)' })?.color, 'rgb(1, 2, 3)');
  assert.equal(sponsorBlockMarker({ ...input, category: 'future' })?.labelKey, 'sponsorBlockCategory_unknown');
  for (const category of ['future', '__proto__', 'constructor', 'toString']) {
    assert.equal(sponsorBlockMarker({ ...input, category })?.color, '#ffffff');
  }
  for (const category of Object.keys(SPONSORBLOCK_COLORS)) assert.ok(sponsorBlockMarker({ ...input, category }));
  for (const left of ['calc(2% + 1px)', '1px', '-2%', '101%', 'Infinity%', '10%;color:red', 'url(x)', '']) {
    assert.equal(sponsorBlockMarker({ ...input, left }), null, left);
  }
  assert.equal(sponsorBlockMarker({ ...input, right: '95%' }), null);
  assert.equal(sponsorBlockMarker({ ...input, right: 'auto' }), null);
  assert.equal(sponsorBlockMarker({ ...input, opacity: 'Infinity' })?.opacity, .7);
  assert.equal(sponsorBlockMarker({ ...input, opacity: '-1' })?.opacity, 0);
  assert.equal(sponsorBlockMarker({ ...input, opacity: '3' })?.opacity, 1);
});
it('defaults on and preserves explicit disablement', () => {
  for (const value of [undefined, null, 'false', 0, {}]) assert.equal(resolveSponsorBlockMarkers(value), true);
  assert.equal(resolveSponsorBlockMarkers(false), false);
  assert.equal(resolveSponsorBlockMarkers(true), true);
});
