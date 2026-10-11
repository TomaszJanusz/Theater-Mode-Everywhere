import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveAutoEnterTheater, shouldAutoEnterTheater, updateAutoTheaterVisit,
  type AutoTheaterDecision, type AutoTheaterVisit
} from './auto-theater';

const allowed: AutoTheaterDecision = {
  enabled: true, topLevel: true, policyAllowed: true, providerEnabled: true,
  fullscreen: false, editableFocused: false, theaterActive: false, transitioning: false,
  mainVideo: true, eligibleVideo: true, playing: true
};
const visit: AutoTheaterVisit = { identity: 'youtube:abcdefghijk', entered: false };

describe('automatic theater entry', () => {
  it('defaults off and only accepts the boolean true', () => {
    for (const value of [undefined, null, false, 0, 1, 'true', {}, []]) {
      assert.equal(resolveAutoEnterTheater(value), false);
    }
    assert.equal(resolveAutoEnterTheater(true), true);
  });

  it('requires an eligible playing main video on a declared watch page', () => {
    assert.equal(shouldAutoEnterTheater(visit, allowed), true);
    assert.equal(shouldAutoEnterTheater({ identity: null, entered: false }, allowed), false);
    for (const key of ['enabled', 'topLevel', 'policyAllowed', 'providerEnabled', 'mainVideo', 'eligibleVideo', 'playing'] as const) {
      assert.equal(shouldAutoEnterTheater(visit, { ...allowed, [key]: false }), false, key);
    }
    for (const key of ['fullscreen', 'editableFocused', 'theaterActive', 'transitioning'] as const) {
      assert.equal(shouldAutoEnterTheater(visit, { ...allowed, [key]: true }), false, key);
    }
  });

  it('does not repeat after exit, replay, source replacement, or a preference toggle on the same visit', () => {
    const entered = { ...visit, entered: true };
    assert.equal(shouldAutoEnterTheater(entered, allowed), false);
    assert.equal(updateAutoTheaterVisit(entered, entered.identity), entered);
    assert.equal(shouldAutoEnterTheater(updateAutoTheaterVisit(entered, entered.identity), allowed), false);
  });

  it('resets for a different SPA video or leaving the watch page, but not a tracking/query change', () => {
    const entered = { ...visit, entered: true };
    const next = updateAutoTheaterVisit(entered, 'youtube:lmnopqrstuv');
    assert.equal(shouldAutoEnterTheater(next, allowed), true);
    const home = updateAutoTheaterVisit(entered, null);
    assert.equal(shouldAutoEnterTheater(home, allowed), false);
    assert.equal(shouldAutoEnterTheater(updateAutoTheaterVisit(home, entered.identity), allowed), true);
  });
});
