import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveAutoEnterTheater, resolveAutoTheaterSkipCountdown, shouldAutoEnterTheater, updateAutoTheaterContent, updateAutoTheaterVisit,
  type AutoTheaterDecision, type AutoTheaterVisit
} from './auto-theater';

const allowed: AutoTheaterDecision = {
  enabled: true, topLevel: true, policyAllowed: true, providerEnabled: true,
  fullscreen: false, editableFocused: false, theaterActive: false, transitioning: false,
  mainVideo: true, eligibleVideo: true, playing: true
};
const visit: AutoTheaterVisit = { identity: 'youtube:abcdefghijk', entered: false };

describe('automatic theater entry', () => {
  it('defaults on and only an explicit boolean overrides it', () => {
    for (const value of [undefined, null, 0, 1, 'false', {}, []]) assert.equal(resolveAutoEnterTheater(value), true);
    assert.equal(resolveAutoEnterTheater(true), true);
    assert.equal(resolveAutoEnterTheater(false), false);
  });

  it('keeps the skip countdown off unless explicitly true', () => {
    for (const value of [undefined, null, false, 0, 1, 'true', {}, []]) assert.equal(resolveAutoTheaterSkipCountdown(value), false);
    assert.equal(resolveAutoTheaterSkipCountdown(true), true);
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

  it('starts a new visit for new content on the same page, such as the next live broadcast', () => {
    const live = { identity: 'twitch:live:somechannel', entered: true };
    const first = updateAutoTheaterContent(live, '1001');
    assert.deepEqual(first, { ...live, content: '1001' }, 'the first content seen is recorded, not new');
    assert.equal(updateAutoTheaterContent(first, '1001'), first);
    const next = updateAutoTheaterContent(first, '1002');
    assert.deepEqual(next, { identity: live.identity, entered: false, content: '1002' });
    assert.equal(shouldAutoEnterTheater(next, allowed), true);
    assert.equal(updateAutoTheaterVisit(next, 'twitch:live:otherchannel').content, undefined, 'a new page forgets it');
  });
});
