import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { theaterVideoNeedsRestyle, theaterViewportPinOffset } from './theater-layout';

describe('theater viewport pin', () => {
  it('is a no-op when the element already covers the viewport origin', () => {
    assert.equal(
      theaterViewportPinOffset({ top: 0.4, left: -0.2 }, { top: 0, left: 0 }),
      null
    );
  });

  it('shifts a containing-block origin up to the viewport', () => {
    assert.deepEqual(
      theaterViewportPinOffset({ top: 56, left: 12 }, { top: 0, left: 0 }),
      { top: -56, left: -12 }
    );
  });

  it('compounds against an existing pin instead of resetting it', () => {
    assert.deepEqual(
      theaterViewportPinOffset({ top: 8, left: 0 }, { top: -56, left: -12 }),
      { top: -64, left: -12 }
    );
  });
});

describe('theater video restyle guard', () => {
  it('restyles when the stable marker or critical inline styles are gone', () => {
    assert.equal(
      theaterVideoNeedsRestyle({
        hasAttribute: () => false,
        getAttribute: () => 'position: fixed !important; background: #000000;'
      }),
      true
    );
    assert.equal(
      theaterVideoNeedsRestyle({
        hasAttribute: (name) => name === 'data-theater-everywhere',
        getAttribute: () => 'position: fixed; width: 100vw;'
      }),
      true
    );
  });

  it('leaves intact inline theater styles alone', () => {
    assert.equal(
      theaterVideoNeedsRestyle({
        hasAttribute: (name) => name === 'data-theater-everywhere',
        getAttribute: () => 'position: fixed; --theater-object-fit: contain; background: #000000;'
      }),
      false
    );
  });
});
