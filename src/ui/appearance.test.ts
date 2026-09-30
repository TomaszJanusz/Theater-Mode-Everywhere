import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { raisedCaptionRestBottom } from '../media-features/caption-dock';
import { horizontalLetterboxPx, objectPositionForPicture, pictureHasLetterbox, raisedCaptionsUseBand, resolvePictureAlign, type PictureFrame } from './appearance';

const widescreen: PictureFrame = { videoWidth: 1920, videoHeight: 1080, viewportWidth: 1920, viewportHeight: 1200 };
const matched: PictureFrame = { videoWidth: 1920, videoHeight: 1080, viewportWidth: 1920, viewportHeight: 1080 };
const ultrawide: PictureFrame = { videoWidth: 1920, videoHeight: 1080, viewportWidth: 2560, viewportHeight: 1080 };

describe('picture align', () => {
  it('raises a fitted picture and keeps every other fit centered', () => {
    assert.equal(objectPositionForPicture('contain', 'top'), 'center top');
    assert.equal(objectPositionForPicture('contain', 'center'), 'center center');
    assert.equal(objectPositionForPicture('cover', 'top'), 'center center');
    assert.equal(objectPositionForPicture('fill', 'top'), 'center center');
  });

  it('falls back to centered when a raised picture has no bottom bar', () => {
    assert.equal(horizontalLetterboxPx(widescreen), 120);
    assert.equal(horizontalLetterboxPx(matched), 0);
    assert.equal(horizontalLetterboxPx(ultrawide), 0);
    assert.equal(pictureHasLetterbox(widescreen), true);
    assert.equal(pictureHasLetterbox(matched), false);
    assert.equal(pictureHasLetterbox(ultrawide), false);
    assert.equal(objectPositionForPicture('contain', 'top', widescreen), 'center top');
    assert.equal(objectPositionForPicture('contain', 'top', matched), 'center center');
    assert.equal(objectPositionForPicture('contain', 'top', ultrawide), 'center center');
    assert.equal(objectPositionForPicture('contain', 'center', widescreen), 'center center');
    assert.equal(objectPositionForPicture('cover', 'top', widescreen), 'center center');
    const unknown: PictureFrame = {
      videoWidth: 0,
      videoHeight: 0,
      viewportWidth: 1920,
      viewportHeight: 1080
    };
    assert.equal(objectPositionForPicture('contain', 'top', unknown), 'center top');
    assert.equal(horizontalLetterboxPx(unknown), 0);
    assert.equal(raisedCaptionsUseBand('center top', horizontalLetterboxPx(unknown)), false);
    assert.equal(raisedCaptionsUseBand('center top', horizontalLetterboxPx(widescreen)), true);
    assert.equal(raisedCaptionsUseBand('center center', horizontalLetterboxPx(widescreen)), false);
  });

  it('measures the band beside a 150px vertical tab column', () => {
    const sidebar = 150;
    const content: PictureFrame = {
      videoWidth: 1920,
      videoHeight: 1080,
      viewportWidth: 1512 - sidebar,
      viewportHeight: 900
    };
    const besideTabs = horizontalLetterboxPx(content);
    const fullWindow = horizontalLetterboxPx({ ...content, viewportWidth: 1512 });
    assert.ok(besideTabs > fullWindow);
    assert.equal(Math.round(besideTabs), 134);
    assert.equal(raisedCaptionRestBottom(besideTabs, 88, content.viewportHeight), 23);
    assert.equal(raisedCaptionRestBottom(horizontalLetterboxPx(widescreen), 88, widescreen.viewportHeight), 32);
  });

  it('falls back to centered alignment', () => {
    assert.equal(resolvePictureAlign('top'), 'top');
    assert.equal(resolvePictureAlign('center'), 'center');
    assert.equal(resolvePictureAlign('nope'), 'center');
    assert.equal(resolvePictureAlign(undefined), 'center');
  });
});
