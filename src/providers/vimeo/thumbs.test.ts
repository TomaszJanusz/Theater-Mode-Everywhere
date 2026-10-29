import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getVimeoPreviewFrame, parseVimeoThumbPreview } from './thumbs';

describe('vimeo thumb preview parser', () => {
  const spec = {
    url: 'https://videoapi-sprites.vimeocdn.com/video-sprites/image/abc.0.webp?Expires=1&Signature=sig',
    width: 4686,
    height: 2640,
    frameWidth: 426,
    frameHeight: 240,
    columns: 11,
    frames: 120
  };

  it('maps hover time onto a sprite tile without a new URL per nearby frame', () => {
    const sprite = parseVimeoThumbPreview(spec, 635);
    assert.ok(sprite);
    const first = getVimeoPreviewFrame(sprite!, 0, 635);
    const nearby = getVimeoPreviewFrame(sprite!, 4, 635);
    assert.ok(first && nearby);
    assert.equal(first!.image.url, nearby!.image.url);
    assert.equal(first!.image.x, 0);
    assert.equal(first!.image.y, 0);
    assert.equal(first!.image.tileWidth, 426);
    assert.equal(first!.image.sheetWidth, 4686);
    const later = getVimeoPreviewFrame(sprite!, 60, 635);
    assert.ok(later);
    assert.equal(later!.image.url, first!.image.url);
    assert.notEqual(later!.image.x + later!.image.y, 0);
  });

  it('rejects non-vimeocdn hosts', () => {
    assert.equal(parseVimeoThumbPreview({ ...spec, url: 'https://evil.example/abc.0.webp' }, 10), null);
  });
});
