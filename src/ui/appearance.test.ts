import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { raisedCaptionRestBottom } from '../media-features/caption-dock';
import { effectivePictureAlign, horizontalLetterboxPx, objectPositionForPicture, pictureEdgeInsets, pictureHasLetterbox, raisedCaptionsUseBand, resolvePictureAlign, resolveRaiseOnlyWithSubtitles, type PictureFrame } from './appearance';

const widescreen: PictureFrame = { videoWidth: 1920, videoHeight: 1080, viewportWidth: 1920, viewportHeight: 1200 };
const matched: PictureFrame = { videoWidth: 1920, videoHeight: 1080, viewportWidth: 1920, viewportHeight: 1080 };
const ultrawide: PictureFrame = { videoWidth: 1920, videoHeight: 1080, viewportWidth: 2560, viewportHeight: 1080 };

describe('picture edge insets', () => {
  it('splits a letterbox evenly when centered and puts all of it below a raised picture', () => {
    assert.deepEqual(pictureEdgeInsets(widescreen, 'contain', 'center center'), { end: 0, bottom: 60 });
    assert.deepEqual(pictureEdgeInsets(widescreen, 'contain', 'center top'), { end: 0, bottom: 120 });
  });

  it('measures pillarbox bars at the end edge and leaves a matched frame flush', () => {
    assert.deepEqual(pictureEdgeInsets(ultrawide, 'contain', 'center center'), { end: 320, bottom: 0 });
    assert.deepEqual(pictureEdgeInsets(ultrawide, 'contain', 'center top'), { end: 320, bottom: 0 });
    assert.deepEqual(pictureEdgeInsets(matched, 'contain', 'center top'), { end: 0, bottom: 0 });
  });

  it('treats Fill, Stretch and unmeasured media as the whole box', () => {
    assert.deepEqual(pictureEdgeInsets(widescreen, 'cover', 'center center'), { end: 0, bottom: 0 });
    assert.deepEqual(pictureEdgeInsets(widescreen, 'fill', 'center top'), { end: 0, bottom: 0 });
    assert.deepEqual(pictureEdgeInsets({ ...widescreen, videoWidth: 0 }, 'contain', 'center top'), { end: 0, bottom: 0 });
  });
});

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

  it('raises as soon as one default caption line, padding and edge gap fit', () => {
    // 800px of 16:9 video is 450px tall; the remaining height becomes the bottom band.
    const frame = { ...widescreen, viewportWidth: 800 };
    for (const [band, expected] of [[57.7, false], [57.8, true], [57.9, true]] as const) {
      const measured = { ...frame, viewportHeight: 450 + band };
      const position = objectPositionForPicture('contain', 'top', measured);
      assert.equal(pictureHasLetterbox(measured), expected, `${band}px band`);
      assert.equal(position, expected ? 'center top' : 'center center');
      assert.equal(raisedCaptionsUseBand(position, horizontalLetterboxPx(measured)), expected);
      assert.equal(raisedCaptionsUseBand('center top', band), expected);
      assert.equal(raisedCaptionsUseBand('center center', band), false);
      assert.equal(objectPositionForPicture('contain', 'center', measured), 'center center');
      assert.equal(objectPositionForPicture('cover', 'top', measured), 'center center');
      assert.equal(objectPositionForPicture('fill', 'top', measured), 'center center');
      assert.equal(objectPositionForPicture('contain', 'top', measured, {
        raiseOnlyWithSubtitles: true, subtitlesOn: false
      }), 'center center');
      assert.equal(objectPositionForPicture('contain', 'top', measured, {
        raiseOnlyWithSubtitles: true, subtitlesOn: true
      }), position);
    }
  });

  it('keeps unknown frames raised without treating them as a measured caption band', () => {
    for (const dimension of ['videoWidth', 'videoHeight', 'viewportWidth', 'viewportHeight'] as const) {
      const frame = { ...widescreen, [dimension]: 0 };
      assert.equal(pictureHasLetterbox(frame), true);
      assert.equal(objectPositionForPicture('contain', 'top', frame), 'center top');
      assert.equal(raisedCaptionsUseBand('center top', horizontalLetterboxPx(frame)), false);
    }
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
