import assert from 'node:assert/strict';
import { it } from 'node:test';

import { AUTO_THEATER_STORAGE_KEY, resolveAutoEnterTheater } from './auto-theater-preferences';
import { hasSettingsProfile, INSTALL_SHORTCUTS, installPlan, resolveSetupState, SETUP_STEPS, setupComplete, shownSetupSteps } from './first-run-setup';
import { MEDIA_PROVIDER_FLAG_KEYS } from './media-features/provider-flags';

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
  const fresh = installPlan({}, undefined, '2.1.0', true);
  assert.deepEqual(fresh, {
    sync: { shortcuts: { ...INSTALL_SHORTCUTS }, blacklist: [], [AUTO_THEATER_STORAGE_KEY]: false },
    state: { status: 'pending', version: '2.1.0' }, openSetup: true
  });
  assert.equal(resolveAutoEnterTheater(fresh.sync[AUTO_THEATER_STORAGE_KEY]), false);
  // A synced profile keeps its settings, AutoTheater included; the install defaults only fill what is missing.
  const synced = installPlan({ blacklist: ['example.com'] }, undefined, '2.1.0', true);
  assert.deepEqual(synced, { sync: { shortcuts: { ...INSTALL_SHORTCUTS } }, state: { status: 'profile', version: '2.1.0' }, openSetup: false });
  // A device that has been through it (a Firefox temporary add-on reinstalls on every reload) is not asked again.
  for (const status of ['pending', 'completed', 'skipped', 'profile']) {
    assert.deepEqual(installPlan(FRESH, { status, version: '2.1.0' }, '2.1.1', true), { sync: {}, openSetup: false }, status);
  }
  // Until every step ships, an install keeps today's behaviour.
  assert.deepEqual(installPlan({}, undefined, '2.1.0', false), { sync: { shortcuts: { ...INSTALL_SHORTCUTS }, blacklist: [] }, openSetup: false });
});
