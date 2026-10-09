import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CAPTION_DOCK_GAP,
  CAPTION_DOCK_RAISED_CENTER_GAP,
  CAPTION_DOCK_RAISED_EDGE,
  CAPTION_DOCK_REST_BOTTOM,
  computeCaptionDockBottom,
  raisedCaptionRestBottom,
  raisedCaptionRowCount
} from '../media-features/caption-dock';
import { netflixPlaybackRank, shouldFollowNetflixVideo, type NetflixVideoFacts } from '../providers/netflix/playback';
import {
  NETFLIX_CONTAINMENT_VALUES,
  computedStyleCreatesFixedContainingBlock
} from '../providers/netflix/stage';
import {
  netflixPaintedCaptionBox,
  nextNetflixCaptionBox,
  type NetflixSpanBox
} from '../providers/netflix/host-captions';

const sharpHero: NetflixVideoFacts = {
  inPlayer: false,
  playing: true,
  visibleArea: 1184 * 541,
  opacity: 1,
  blurred: false,
  usable: true
};

const blurredHero: NetflixVideoFacts = {
  ...sharpHero,
  opacity: 0.25,
  blurred: true,
  visibleArea: 1536 * 864
};

const modal: NetflixVideoFacts = {
  inPlayer: true,
  playing: true,
  visibleArea: 1030 * 578,
  opacity: 1,
  blurred: false,
  usable: true
};

const collapsedModal: NetflixVideoFacts = {
  ...modal,
  playing: false,
  visibleArea: 36,
  usable: false
};

describe('netflix playback selection', () => {
  it('follows the visible modal instead of a blurred hero', () => {
    assert.ok(netflixPlaybackRank(modal) > netflixPlaybackRank(sharpHero));
    assert.ok(netflixPlaybackRank(sharpHero) > netflixPlaybackRank(blurredHero));
    assert.equal(shouldFollowNetflixVideo(sharpHero, modal), true);
    assert.equal(shouldFollowNetflixVideo(modal, sharpHero), false);
    assert.equal(shouldFollowNetflixVideo(blurredHero, sharpHero), true);
  });

  it('returns to the hero when the modal player collapses', () => {
    assert.equal(netflixPlaybackRank(collapsedModal), -1);
    assert.equal(shouldFollowNetflixVideo(collapsedModal, sharpHero), true);
    assert.equal(shouldFollowNetflixVideo(sharpHero, collapsedModal), false);
  });
});

describe('netflix fixed containing block', () => {
  const clear = {
    transform: 'none',
    scale: 'none',
    filter: 'none',
    backdropFilter: 'none',
    perspective: 'none',
    contain: 'none',
    willChange: 'auto',
    mask: 'none'
  };

  it('treats an identity dialog transform as a containing block', () => {
    assert.equal(computedStyleCreatesFixedContainingBlock({
      ...clear,
      transform: 'matrix(1, 0, 0, 1, 0, 0)'
    }), true);
    assert.equal(computedStyleCreatesFixedContainingBlock(clear), false);
  });

  it('treats will-change transform as a containing block and clears it', () => {
    assert.equal(computedStyleCreatesFixedContainingBlock({
      ...clear,
      willChange: 'transform'
    }), true);
    assert.equal(NETFLIX_CONTAINMENT_VALUES['will-change'], 'auto');
  });

  it('treats a hero mask gradient as a containing block', () => {
    assert.equal(computedStyleCreatesFixedContainingBlock({
      ...clear,
      mask: 'linear-gradient(rgb(255, 255, 255) 70%, rgba(0, 0, 0, 0))'
    }), true);
  });

  it('clears the dialog transition that kept the identity matrix, and keeps mask longhands', () => {
    assert.equal(NETFLIX_CONTAINMENT_VALUES.transition, 'none');
    assert.equal(NETFLIX_CONTAINMENT_VALUES.transform, 'none');
    assert.equal(NETFLIX_CONTAINMENT_VALUES.scale, 'none');
    assert.equal(NETFLIX_CONTAINMENT_VALUES['mask-image'], 'none');
    assert.equal(NETFLIX_CONTAINMENT_VALUES['-webkit-mask-image'], 'none');
    assert.equal('mask' in NETFLIX_CONTAINMENT_VALUES, false);
    assert.equal(NETFLIX_CONTAINMENT_VALUES.overflow, 'visible');
  });
});

function cueLine(top: number, width = 200, height = 36, lineHeight = 20): NetflixSpanBox {
  return { left: 540, top, width, height, lineHeight };
}

describe('netflix caption dock', () => {
  const viewport = { viewportWidth: 1280, viewportHeight: 800 };
  const toolbar = { left: 24, right: 1256, top: 724, bottom: 776 };
  const sideControl = { left: 1080, right: 1240, top: 500, bottom: 720 };
  const centeredMenu = { left: 560, right: 760, top: 600, bottom: 740 };

  it('measures painted cue text and ignores the gap between native line positions', () => {
    const tight = netflixPaintedCaptionBox([[cueLine(600)], [cueLine(640, 180)]]);
    const spread = netflixPaintedCaptionBox([[cueLine(200)], [cueLine(900, 180)]]);
    assert.deepEqual(spread, tight);
    assert.equal(tight?.width, 200);
    assert.equal(tight?.height, 72);
    assert.equal(tight?.rows, 2);
    assert.equal(raisedCaptionRowCount(tight?.height ?? 0, tight?.lineHeight ?? 0), 3);

    const centered = raisedCaptionRestBottom(
      120,
      tight?.height ?? 0,
      1200,
      CAPTION_DOCK_RAISED_EDGE,
      CAPTION_DOCK_RAISED_CENTER_GAP,
      tight?.rows ?? 2
    );
    const pinned = raisedCaptionRestBottom(
      120,
      tight?.height ?? 0,
      1200,
      CAPTION_DOCK_RAISED_EDGE,
      CAPTION_DOCK_RAISED_CENTER_GAP,
      3
    );
    assert.equal(centered, 24);
    assert.equal(pinned, CAPTION_DOCK_RAISED_EDGE);
    const spreadRest = raisedCaptionRestBottom(
      120,
      spread?.height ?? 0,
      1200,
      CAPTION_DOCK_RAISED_EDGE,
      CAPTION_DOCK_RAISED_CENTER_GAP,
      spread?.rows ?? 2
    );
    assert.equal(spreadRest, centered);

    const one = netflixPaintedCaptionBox([[cueLine(640)]]);
    assert.equal(one?.rows, 1);
    assert.equal(raisedCaptionRestBottom(
      120,
      one?.height ?? 0,
      1200,
      CAPTION_DOCK_RAISED_EDGE,
      CAPTION_DOCK_RAISED_CENTER_GAP,
      one?.rows ?? 1
    ), 42);

    const words = netflixPaintedCaptionBox([[
      { left: 400, top: 700, width: 80, height: 53.8, lineHeight: 37.8 },
      { left: 488, top: 700, width: 90, height: 53.8, lineHeight: 37.8 }
    ]]);
    assert.equal(words?.rows, 1);
    assert.equal(words?.width, 178);
    assert.equal(words?.height, 54);

    const wrapped = netflixPaintedCaptionBox([[
      { left: 400, top: 700, width: 220, height: 56, lineHeight: 20 }
    ]]);
    assert.equal(wrapped?.rows, 2);
    assert.equal(wrapped?.width, 220);
  });

  it('keeps the last painted cue between lines and drops it when the host leaves', () => {
    const one = netflixPaintedCaptionBox([[cueLine(640)]]);
    const two = netflixPaintedCaptionBox([[cueLine(600)], [cueLine(640)]]);
    assert.equal(nextNetflixCaptionBox(one, null, true), one);
    assert.equal(nextNetflixCaptionBox(one, two, true), two);
    assert.equal(nextNetflixCaptionBox(two, null, false), null);
  });

  it('lifts painted cues for the toolbar and a centered menu, not for a side control the 80vw host would hit', () => {
    const painted = { width: 200, height: 72 };
    const host = { width: 1024, height: 72 };
    const paintedToolbar = computeCaptionDockBottom({
      captionSize: painted,
      obstacles: [toolbar, sideControl],
      ...viewport
    });
    const hostToolbar = computeCaptionDockBottom({
      captionSize: host,
      obstacles: [toolbar, sideControl],
      ...viewport
    });
    assert.equal(paintedToolbar, 800 - toolbar.top + CAPTION_DOCK_GAP);
    assert.equal(hostToolbar, 800 - sideControl.top + CAPTION_DOCK_GAP);
    assert.ok(hostToolbar > paintedToolbar);

    const paintedMenu = computeCaptionDockBottom({
      captionSize: painted,
      obstacles: [toolbar, centeredMenu],
      ...viewport
    });
    assert.equal(paintedMenu, 800 - centeredMenu.top + CAPTION_DOCK_GAP);
    assert.equal(computeCaptionDockBottom({
      captionSize: painted,
      obstacles: [sideControl],
      ...viewport
    }), CAPTION_DOCK_REST_BOTTOM);
  });
});
