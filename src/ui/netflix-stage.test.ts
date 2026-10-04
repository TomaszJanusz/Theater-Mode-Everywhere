import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { netflixPlaybackRank, shouldFollowNetflixVideo, type NetflixVideoFacts } from './netflix-playback';
import {
  NETFLIX_CONTAINMENT_VALUES,
  computedStyleCreatesFixedContainingBlock
} from './netflix-stage';

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
