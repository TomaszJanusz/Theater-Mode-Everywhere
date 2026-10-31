import assert from 'node:assert/strict';
import { it } from 'node:test';

import { AUTO_THEATER_STORAGE_KEY } from '../src/auto-theater-preferences';
import { INSTALL_SHORTCUTS } from '../src/first-run-setup';
import {
  MEDIA_PROVIDER_FLAG_KEYS, MEDIA_PROVIDER_IDS, mediaProviderFlagStorageKeys, resolveMediaProviderFlags
} from '../src/media-features/provider-flags';

import { answersFromSettings, defaultSetupAnswers, setupSettingsPatch } from './setup-answers';

/** What sync holds right after a fresh install wrote its defaults. */
const FRESH = { shortcuts: { ...INSTALL_SHORTCUTS }, blacklist: [], [AUTO_THEATER_STORAGE_KEY]: false };

it('writes nothing for answers that match the stored settings, and every service flag for any service change', () => {
  for (const stored of [{}, FRESH]) {
    const answers = answersFromSettings(stored);
    assert.equal(answers.services, 'all');
    assert.deepEqual(setupSettingsPatch(answers, stored), {}, 'All on a fresh profile');
    assert.deepEqual(setupSettingsPatch({ ...answers, services: 'choose' }, stored), {}, 'Choose with every switch on');
    const none = setupSettingsPatch({ ...answers, services: 'none' }, stored);
    assert.deepEqual(Object.keys(none).sort(), mediaProviderFlagStorageKeys().sort());
    assert.ok(Object.values(none).every(value => value === false));
    assert.ok(MEDIA_PROVIDER_IDS.every(id => !resolveMediaProviderFlags(none)[id]));
  }
  // Turning off exactly the five legacy services must not read back as the legacy "everything off".
  const chosen = { ...answersFromSettings({}).chosen, youtube: false, vimeo: false, patreon: false, twitch: false, disney: false };
  const patch = setupSettingsPatch({ services: 'choose', chosen }, {});
  assert.equal(Object.keys(patch).length, MEDIA_PROVIDER_IDS.length);
  assert.deepEqual(resolveMediaProviderFlags(patch), chosen);
  // The switches behind "Choose services" do not leak into "All" or "None".
  assert.deepEqual(setupSettingsPatch({ services: 'all', chosen }, {}), {});
});

it('describes saved service flags as the matching answer', () => {
  const off = Object.fromEntries(MEDIA_PROVIDER_IDS.map(id => [MEDIA_PROVIDER_FLAG_KEYS[id], false]));
  assert.equal(answersFromSettings(off).services, 'none');
  // "None" keeps the switches on, so moving to "Choose services" starts from everything.
  assert.ok(MEDIA_PROVIDER_IDS.every(id => answersFromSettings(off).chosen[id]));
  const some = answersFromSettings({ [MEDIA_PROVIDER_FLAG_KEYS.netflix]: false });
  assert.equal(some.services, 'choose');
  assert.equal(some.chosen.netflix, false);
  assert.deepEqual(setupSettingsPatch(some, { [MEDIA_PROVIDER_FLAG_KEYS.netflix]: false }), {});
});

it('preselects every service for a reset profile', () => {
  assert.deepEqual(defaultSetupAnswers(), answersFromSettings({}));
  assert.equal(defaultSetupAnswers().services, 'all');
});
