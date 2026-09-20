import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyCaptionStyle,
  CAPTION_FONT_SCALES,
  DEFAULT_CAPTION_STYLE,
  resolveCaptionStyle,
  stepCaptionFontScale
} from './caption-style';

describe('caption font scale', () => {
  it('uses the supported discrete scales and a 100% default', () => {
    assert.deepEqual(CAPTION_FONT_SCALES, [0.5, 1, 1.5, 2, 3, 4]);
    assert.equal(resolveCaptionStyle(null).fontScale, 1);
  });

  it('uses the system font, yellow text, and drop shadow by default', () => {
    assert.deepEqual(resolveCaptionStyle(null), DEFAULT_CAPTION_STYLE);
    assert.equal(DEFAULT_CAPTION_STYLE.fontPreset, 'system');
    assert.equal(DEFAULT_CAPTION_STYLE.textColor, '#fad900');
    assert.equal(DEFAULT_CAPTION_STYLE.textOpacity, 1);
    assert.equal(DEFAULT_CAPTION_STYLE.dropShadow, true);
    assert.equal(DEFAULT_CAPTION_STYLE.shadowOpacity, 0.92);
    assert.equal(DEFAULT_CAPTION_STYLE.backgroundColor, '#141414');
    assert.equal(DEFAULT_CAPTION_STYLE.backgroundOpacity, 0.8);
  });

  it('preserves existing values without requiring stored-data migration', () => {
    assert.deepEqual(resolveCaptionStyle({
      textColor: '#123456',
      fontScale: 2,
      dropShadow: false,
      backgroundColor: '#654321',
      backgroundOpacity: 0.35
    }), {
      textColor: '#123456',
      textOpacity: 1,
      fontPreset: 'system',
      fontScale: 2,
      dropShadow: false,
      shadowOpacity: 0.92,
      backgroundColor: '#654321',
      backgroundOpacity: 0.35
    });
  });

  it('renders a crisp bottom-right shadow with configurable opacity', () => {
    const properties = new Map<string, string>();
    const target = {
      style: {
        setProperty: (name: string, value: string) => properties.set(name, value)
      }
    } as unknown as HTMLElement;
    applyCaptionStyle(target, { ...DEFAULT_CAPTION_STYLE, shadowOpacity: 0.5 });
    assert.equal(properties.get('--theater-caption-shadow'), '3px 3px 1px rgba(0, 0, 0, 0.5)');
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
