import assert from 'node:assert/strict';
import { it } from 'node:test';

import { AUTO_THEATER_STORAGE_KEY } from '../src/auto-theater-preferences';
import { FRESH_INSTALL_SETTINGS, INSTALL_SHORTCUTS } from '../src/first-run-setup';
import {
  MEDIA_PROVIDER_FLAG_KEYS, MEDIA_PROVIDER_IDS, mediaProviderFlagStorageKeys, resolveMediaProviderFlags
} from '../src/media-features/provider-flags';
import { PROVIDER_CAPABILITIES } from '../src/providers/capabilities';

import { answersFromSettings, autoTheaterAvailable, defaultSetupAnswers, effectiveStart, setupSettingsPatch, type SetupAnswers } from './setup-answers';

/** What sync holds right after a fresh install wrote its defaults. */
const FRESH = { shortcuts: { ...INSTALL_SHORTCUTS }, blacklist: [], ...FRESH_INSTALL_SETTINGS };
const answers = (change: Partial<SetupAnswers> = {}): SetupAnswers => ({ ...defaultSetupAnswers(), ...change });
const PROMPT = { videoActivatorPromptAnswer: false };

it('preselects a fresh install: every service, the theater key only, hold for 2x on and no volume boost', () => {
  assert.deepEqual({ ...defaultSetupAnswers(), chosen: undefined }, {
    services: 'all', chosen: undefined, start: 'key', skipCountdown: false, seekHold: true, volumeBoost: false,
    language: 'automatic', accent: 'system', layout: 'top', raiseOnlyWithSubtitles: true, pinControls: false
  });
  assert.deepEqual(answersFromSettings(FRESH), defaultSetupAnswers());
  // Finishing the preselection writes only the launcher offer's answer, so it does not come back later.
  assert.deepEqual(setupSettingsPatch(defaultSetupAnswers(), FRESH), PROMPT);
});

it('writes nothing for unchanged services, and every service flag for any service change', () => {
  assert.deepEqual(setupSettingsPatch(answers({ services: 'choose' }), FRESH), PROMPT, 'Choose with every switch on');
  const none = setupSettingsPatch(answers({ services: 'none' }), FRESH);
  assert.deepEqual(Object.keys(none).filter(key => key.endsWith('IntegrationEnabled')).sort(), mediaProviderFlagStorageKeys().sort());
  assert.ok(MEDIA_PROVIDER_IDS.every(id => !resolveMediaProviderFlags(none)[id]));
  // Turning off exactly the five legacy services must not read back as the legacy "everything off".
  const chosen = { ...defaultSetupAnswers().chosen, youtube: false, vimeo: false, patreon: false, twitch: false, disney: false };
  const patch = setupSettingsPatch(answers({ services: 'choose', chosen }), FRESH);
  assert.deepEqual(resolveMediaProviderFlags(patch), chosen);
  // The switches behind "Choose services" do not leak into "All".
  assert.deepEqual(setupSettingsPatch(answers({ chosen }), FRESH), PROMPT);
});

it('maps how theater mode starts onto AutoTheater, the launcher and its offer', () => {
  assert.deepEqual(setupSettingsPatch(answers({ start: 'button' }), FRESH), { videoActivator: true, videoActivatorPromptAnswer: true });
  assert.deepEqual(setupSettingsPatch(answers({ start: 'auto' }), FRESH), { [AUTO_THEATER_STORAGE_KEY]: true });
  assert.deepEqual(setupSettingsPatch(answers({ start: 'auto', skipCountdown: true }), FRESH),
    { [AUTO_THEATER_STORAGE_KEY]: true, autoTheaterSkipCountdown: true });
  // "Skip countdown" belongs to "Start automatically"; another start leaves it as saved.
  assert.deepEqual(setupSettingsPatch(answers({ skipCountdown: true }), FRESH), PROMPT);
  // An offer already answered stays answered.
  assert.deepEqual(setupSettingsPatch(answers(), { ...FRESH, videoActivatorPromptAnswer: true }), {});
  // A profile with AutoTheater (the code default: no key) and the launcher keeps both when the start stays automatic.
  const both = { videoActivator: true };
  assert.equal(answersFromSettings(both).start, 'auto');
  assert.deepEqual(setupSettingsPatch(answersFromSettings(both), both), {});
  // Moving such a profile to the key alone turns both off.
  assert.deepEqual(setupSettingsPatch({ ...answersFromSettings(both), start: 'key' }, both), { [AUTO_THEATER_STORAGE_KEY]: false, videoActivator: false, ...PROMPT });
});

it('offers AutoTheater only through a chosen service that supports it and has its own switch on', () => {
  const capable = PROVIDER_CAPABILITIES.filter(provider => provider.capabilities.autoTheater.status !== 'no');
  const incapable = PROVIDER_CAPABILITIES.filter(provider => provider.capabilities.autoTheater.status === 'no');
  assert.ok(capable.length > 0 && incapable.length > 0, 'the catalog has both kinds');
  const only = (ids: string[]) => Object.fromEntries(MEDIA_PROVIDER_IDS.map(id => [id, ids.includes(id)])) as SetupAnswers['chosen'];
  assert.equal(autoTheaterAvailable(answers(), FRESH), true);
  assert.equal(autoTheaterAvailable(answers({ services: 'none' }), FRESH), false);
  assert.equal(autoTheaterAvailable(answers({ services: 'choose', chosen: only(incapable.map(provider => provider.id)) }), FRESH), false);
  const one = answers({ services: 'choose', chosen: only([capable[0].id]), start: 'auto' });
  assert.equal(autoTheaterAvailable(one, FRESH), true);
  // That service's own AutoTheater switch (Settings → Features) is off: nothing could start it.
  const off = { ...FRESH, providerSettings: { [capable[0].id]: { autoTheater: false } } };
  assert.equal(autoTheaterAvailable(one, off), false);
  // "Start automatically" then applies as the key alone, and writes AutoTheater off rather than on.
  assert.equal(effectiveStart(one, off), 'key');
  assert.equal(setupSettingsPatch(one, off)[AUTO_THEATER_STORAGE_KEY], undefined, 'already off on a fresh install');
  assert.equal(setupSettingsPatch(answers({ services: 'none', start: 'auto' }), {})[AUTO_THEATER_STORAGE_KEY], false);
});

it('maps hold for 2x and volume boost, and describes saved values as the matching answers', () => {
  assert.deepEqual(setupSettingsPatch(answers({ seekHold: false, volumeBoost: true }), FRESH),
    { ...PROMPT, seekForwardHold: false, volumeBoostEnabled: true });
  const saved = { ...FRESH, seekForwardHold: false, volumeBoostEnabled: true, autoTheaterSkipCountdown: true, [MEDIA_PROVIDER_FLAG_KEYS.netflix]: false };
  const described = answersFromSettings(saved);
  assert.deepEqual([described.services, described.chosen.netflix, described.seekHold, described.volumeBoost, described.skipCountdown],
    ['choose', false, false, true, true]);
  assert.deepEqual(setupSettingsPatch(described, saved), PROMPT);
  const off = Object.fromEntries(MEDIA_PROVIDER_IDS.map(id => [MEDIA_PROVIDER_FLAG_KEYS[id], false]));
  assert.equal(answersFromSettings(off).services, 'none');
  // "None" keeps the switches on, so moving to "Choose services" starts from everything.
  assert.ok(MEDIA_PROVIDER_IDS.every(id => answersFromSettings(off).chosen[id]));
});

it('reads and writes language, accent, layout and pinned controls through their own keys and resolvers', () => {
  const stored = { ...FRESH, language: 'de', accentColor: 'green', pictureAlign: 'center', raiseOnlyWithSubtitles: false, keepControlsVisible: true };
  assert.deepEqual(answersFromSettings(stored), answers({
    language: 'de', accent: 'green', layout: 'center', raiseOnlyWithSubtitles: false, pinControls: true
  }));
  // Invalid stored values read as their defaults, as Settings shows them.
  assert.deepEqual(answersFromSettings({ ...FRESH, language: 'xx', accentColor: 'plaid', pictureAlign: 'left' }), defaultSetupAnswers());
  assert.deepEqual(setupSettingsPatch(answersFromSettings(stored), stored), PROMPT, 'run again unchanged: nothing new');
  assert.deepEqual(setupSettingsPatch(answers({ language: 'ar', accent: 'teal', layout: 'center', pinControls: true }), FRESH), {
    ...PROMPT, language: 'ar', accentColor: 'teal', pictureAlign: 'center', keepControlsVisible: true
  });
  // Back to Automatic is a change too.
  assert.deepEqual(setupSettingsPatch(answers(), stored), {
    ...PROMPT, language: 'automatic', accentColor: 'system', pictureAlign: 'top', raiseOnlyWithSubtitles: true, keepControlsVisible: false
  });
});

it('writes "Raised only with subtitles" only with Raised, as Settings offers it', () => {
  assert.deepEqual(setupSettingsPatch(answers({ raiseOnlyWithSubtitles: false }), FRESH), { ...PROMPT, raiseOnlyWithSubtitles: false });
  assert.deepEqual(setupSettingsPatch(answers({ layout: 'center', raiseOnlyWithSubtitles: false }), FRESH), { ...PROMPT, pictureAlign: 'center' });
});
