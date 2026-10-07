import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readStylesheet } from '../../test-utils/styles';
import { DISNEY_CAPTION_SHADOW_CSS } from './stage';

describe('Disney theater captions', () => {
  it('lifts the timed-text layer above the pinned video and docks it with the control bar', () => {
    const css = readStylesheet(new URL('./presentation.css', import.meta.url));
    assert.match(css, /disney-web-player\.theater-everywhere-parent-active\s*\{[^}]*z-index:\s*2147483646/);
    assert.match(css, /disney-web-player-ui\s*\{[^}]*z-index:\s*2147483647/);
    assert.match(css, /timed-text-override-region\s*\{[^}]*--timed-text-override-region--inset-block-end:\s*var\(--theater-caption-bottom,\s*48px\)/);
    assert.match(css, /:has\(video\.controls-visible\) timed-text-override-region\s*\{[^}]*max\(132px, var\(--theater-caption-bottom/);
    assert.match(DISNEY_CAPTION_SHADOW_CSS, /font-size:\s*calc\(28px \* var\(--theater-caption-scale, 1\)\)/);
    assert.match(DISNEY_CAPTION_SHADOW_CSS, /bottom:\s*0 !important/);
  });
});