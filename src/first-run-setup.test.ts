import assert from 'node:assert/strict';
import { it } from 'node:test';

import { AUTO_THEATER_STORAGE_KEY, resolveAutoEnterTheater } from './auto-theater-preferences';
import { hasLegacyInstall, hasSettingsProfile, INSTALL_SHORTCUTS, installPlan, resolveSetupState, SETUP_STEPS, setupComplete, shownSetupSteps } from './first-run-setup';
import { MEDIA_PROVIDER_FLAG_KEYS } from './media-features/provider-flags';
import { RECORDED_208 } from './test-utils/recorded-208-profile';

/** What sync holds right after a fresh install wrote its defaults. */
const FRESH = { shortcuts: { ...INSTALL_SHORTCUTS }, blacklist: [], [AUTO_THEATER_STORAGE_KEY]: false };

it('shows only finished steps, and offers the setup on install only when no step is pending', () => {
  assert.deepEqual(shownSetupSteps(), SETUP_STEPS.filter(step => step.ready).map(step => step.id));
  assert.equal(shownSetupSteps().at(-1), 'summary');
  assert.equal(setupComplete(), SETUP_STEPS.every(step => step.ready));
});

it('treats only the install defaults as no profile', () => {
  assert.equal(hasSettingsProfile({}), false);
  assert.equal(hasSettingsProfile(FRESH), false);
  assert.equal(hasSettingsProfile({ shortcuts: { ...INSTALL_SHORTCUTS, toggle: 'Y' } }), true);
  assert.equal(hasSettingsProfile({ shortcuts: { ...INSTALL_SHORTCUTS, mute: 'M' } }), true);
  assert.equal(hasSettingsProfile({ blacklist: ['example.com'] }), true);
  assert.equal(hasSettingsProfile({ [AUTO_THEATER_STORAGE_KEY]: true }), true);
  assert.equal(hasSettingsProfile({ language: 'pl' }), true);
  assert.equal(hasSettingsProfile({ [MEDIA_PROVIDER_FLAG_KEYS.youtube]: false }), true);
});

it('validates the stored setup state', () => {
  assert.deepEqual(resolveSetupState({ status: 'completed', version: '2.1.0' }), { status: 'completed', version: '2.1.0' });
  for (const value of [undefined, null, 'completed', { status: 'done', version: '2.1.0' }, { status: 'pending' }]) {
    assert.equal(resolveSetupState(value), undefined, JSON.stringify(value));
  }
});

it('opens the setup and starts AutoTheater off only for a fresh profile on a device without setup state', () => {
  const fresh = installPlan({}, {}, '2.1.0', true);
  assert.deepEqual(fresh, {
    sync: { shortcuts: { ...INSTALL_SHORTCUTS }, blacklist: [], [AUTO_THEATER_STORAGE_KEY]: false },
    state: { status: 'pending', version: '2.1.0' }, openSetup: true
  });
  assert.equal(resolveAutoEnterTheater(fresh.sync[AUTO_THEATER_STORAGE_KEY]), false);
  // A synced profile keeps its settings, AutoTheater included; the install defaults only fill what is missing.
  const synced = installPlan({ blacklist: ['example.com'] }, {}, '2.1.0', true);
  assert.deepEqual(synced, { sync: { shortcuts: { ...INSTALL_SHORTCUTS } }, state: { status: 'profile', version: '2.1.0' }, openSetup: false });
  // A device that has been through it (a Firefox temporary add-on reinstalls on every reload) is not asked again.
  for (const status of ['pending', 'completed', 'skipped', 'profile']) {
    assert.deepEqual(installPlan(FRESH, { firstRunSetup: { status, version: '2.1.0' } }, '2.1.1', true), { sync: {}, openSetup: false }, status);
  }
  // Until every step ships, an install keeps today's behaviour.
  assert.deepEqual(installPlan({}, {}, '2.1.0', false), { sync: { shortcuts: { ...INSTALL_SHORTCUTS }, blacklist: [] }, openSetup: false });
});

it('takes the markers 2.0.x left in local storage as an existing profile, even when sync holds only the defaults', () => {
  for (const [name, recorded] of Object.entries(RECORDED_208)) {
    assert.equal(hasLegacyInstall(recorded.local), true, name);
    // The wizard stays closed and AutoTheater keeps its code default: nothing writes the fresh-install `false`.
    const plan = installPlan({ ...recorded.sync }, { ...recorded.local }, '2.1.0', true);
    assert.deepEqual({ ...plan, sync: Object.keys(plan.sync) }, {
      sync: Object.keys(recorded.sync).length ? [] : ['shortcuts', 'blacklist'],
      state: { status: 'profile', version: '2.1.0' }, openSetup: false
    }, name);
  }
  for (const key of ['whatsNewAutoOpenedRelease:2.0:2.0.8', 'migration:remove-legacy-youtube-exclusion:v1', 'newFeaturesHiddenThrough']) {
    assert.equal(hasLegacyInstall({ [key]: true }), true, key);
  }
  // Keys a fresh 2.1 install or an unrelated profile holds are not evidence.
  assert.equal(hasLegacyInstall({}), false);
  assert.equal(hasLegacyInstall({ pendingUpdate: { version: '2.1.0', since: '2.0' }, firstRunSetup: { status: 'pending', version: '2.1.0' } }), false);
});
