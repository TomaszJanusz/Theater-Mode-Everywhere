import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { raisedCaptionRestBottom } from '../media-features/caption-dock';
import { effectivePictureAlign, horizontalLetterboxPx, objectPositionForPicture, pictureHasLetterbox, raisedCaptionsUseBand, resolvePictureAlign, resolveRaiseOnlyWithSubtitles, type PictureFrame } from './appearance';

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
    const sliver: PictureFrame = { videoWidth: 1920, videoHeight: 1080, viewportWidth: 1920, viewportHeight: 1082 };
    assert.equal(horizontalLetterboxPx(sliver), 2);
    assert.equal(pictureHasLetterbox(sliver), false);
    assert.equal(objectPositionForPicture('contain', 'top', sliver), 'center center');
    assert.equal(raisedCaptionsUseBand('center top', horizontalLetterboxPx(sliver)), false);
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
    assert.equal(raisedCaptionRestBottom(horizontalLetterboxPx(widescreen), 88, widescreen.viewportHeight), 16);
  });

  it('keeps a raised picture centered until subtitles are on', () => {
    const held = { raiseOnlyWithSubtitles: true, subtitlesOn: false };
    const shown = { raiseOnlyWithSubtitles: true, subtitlesOn: true };
    assert.equal(effectivePictureAlign('top', true, false), 'center');
    assert.equal(effectivePictureAlign('top', true, true), 'top');
    assert.equal(effectivePictureAlign('top', false, false), 'top');
    assert.equal(effectivePictureAlign('center', true, true), 'center');
    assert.equal(objectPositionForPicture('contain', 'top', widescreen, held), 'center center');
    assert.equal(objectPositionForPicture('contain', 'top', widescreen, shown), 'center top');
    assert.equal(objectPositionForPicture('contain', 'top', widescreen, { raiseOnlyWithSubtitles: false, subtitlesOn: false }), 'center top');
    assert.equal(objectPositionForPicture('contain', 'center', widescreen, shown), 'center center');
    assert.equal(objectPositionForPicture('cover', 'top', widescreen, shown), 'center center');
    assert.equal(objectPositionForPicture('contain', 'top', undefined, held), 'center center');
    assert.equal(objectPositionForPicture('contain', 'top', undefined, shown), 'center top');
    const sliver: PictureFrame = { videoWidth: 1920, videoHeight: 1080, viewportWidth: 1920, viewportHeight: 1082 };
    assert.equal(objectPositionForPicture('contain', 'top', sliver, shown), 'center center');
    assert.equal(resolveRaiseOnlyWithSubtitles(true), true);
    assert.equal(resolveRaiseOnlyWithSubtitles(false), false);
    assert.equal(resolveRaiseOnlyWithSubtitles(undefined), false);
    assert.equal(resolveRaiseOnlyWithSubtitles('true'), false);
  });

  it('falls back to centered alignment', () => {
    assert.equal(resolvePictureAlign('top'), 'top');
    assert.equal(resolvePictureAlign('center'), 'center');
    assert.equal(resolvePictureAlign('nope'), 'center');
    assert.equal(resolvePictureAlign(undefined), 'center');
  });
});
