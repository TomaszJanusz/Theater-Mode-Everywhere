import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CAPTION_FONT_SCALES,
  resolveCaptionStyle,
  stepCaptionFontScale
} from './caption-style';

describe('caption font scale', () => {
  it('uses the supported discrete scales and a 100% default', () => {
    assert.deepEqual(CAPTION_FONT_SCALES, [0.5, 1, 1.5, 2, 3, 4]);
    assert.equal(resolveCaptionStyle(null).fontScale, 1);
  });

  it('normalizes legacy intermediate scales to the nearest supported scale', () => {
    assert.equal(resolveCaptionStyle({ fontScale: 0.75 }).fontScale, 0.5);
    assert.equal(resolveCaptionStyle({ fontScale: 1.35 }).fontScale, 1.5);
    assert.equal(resolveCaptionStyle({ fontScale: 10 }).fontScale, 4);
  });

  it('steps between scales without moving past the bounds', () => {
    assert.equal(stepCaptionFontScale(1, 1), 1.5);
    assert.equal(stepCaptionFontScale(1, -1), 0.5);
    assert.equal(stepCaptionFontScale(4, 1), 4);
    assert.equal(stepCaptionFontScale(0.5, -1), 0.5);
  });
});
