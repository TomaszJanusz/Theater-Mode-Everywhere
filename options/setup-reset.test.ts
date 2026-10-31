import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';

import { FRESH_INSTALL_SETTINGS, hasSettingsProfile, INSTALL_SHORTCUTS } from '../src/first-run-setup';

import { answersFromSettings, defaultSetupAnswers, resetSettingsPatch, type ResetPatch } from './setup-answers';
import { SETUP_FALLBACKS } from './setup-wizard-copy';

const FRESH = { shortcuts: { ...INSTALL_SHORTCUTS }, blacklist: [], ...FRESH_INSTALL_SETTINGS };
/** Someone's settings after a while: services, AutoTheater, appearance, language, remembered subtitles. */
const USED = {
  shortcuts: { ...INSTALL_SHORTCUTS, toggle: 'G', togglePiP: 'P' }, blacklist: ['example.com'],
  autoEnterTheater: true, netflixIntegrationEnabled: false, accentColor: 'green', language: 'pl',
  volumeBoostEnabled: true, captionPreferenceMap: { youtube: 'pl' }, providerSettings: { youtube: { autoTheater: false } }
};
const apply = (sync: Record<string, unknown>, { remove, set }: ResetPatch) =>
  ({ ...Object.fromEntries(Object.entries(sync).filter(([key]) => !remove.includes(key))), ...set });

it('resets to a fresh install but keeps excluded websites and shortcuts unless asked', () => {
  const patch = resetSettingsPatch(USED, false);
  assert.deepEqual(patch.set, { autoEnterTheater: false });
  assert.deepEqual(patch.remove.sort(), ['accentColor', 'captionPreferenceMap', 'language', 'netflixIntegrationEnabled', 'providerSettings', 'volumeBoostEnabled']);
  const after = apply(USED, patch);
  assert.deepEqual(after, { shortcuts: USED.shortcuts, blacklist: USED.blacklist, ...FRESH_INSTALL_SETTINGS });
  assert.deepEqual(answersFromSettings(after), defaultSetupAnswers());
});

it('resets excluded websites and shortcuts too, to exactly what an install writes', () => {
  const after = apply(USED, resetSettingsPatch(USED, true));
  assert.deepEqual(after, FRESH);
  assert.equal(hasSettingsProfile(after), false, 'indistinguishable from a fresh install');
});

it('writes nothing that already matches a fresh install', () => {
  assert.deepEqual(resetSettingsPatch(FRESH, true), { remove: [], set: {} });
  assert.deepEqual(resetSettingsPatch(FRESH, false), { remove: [], set: {} });
  // Never written yet, such as before the install defaults: only the fresh-install values.
  assert.deepEqual(resetSettingsPatch({}, false), { remove: [], set: { ...FRESH_INSTALL_SETTINGS } });
});

it('keeps the setup copy fallbacks identical to English', () => {
  const english = JSON.parse(readFileSync(new URL('../_locales/en/messages.json', import.meta.url), 'utf8')) as Record<string, { message: string }>;
  for (const [key, message] of Object.entries(SETUP_FALLBACKS)) assert.equal(english[key]?.message, message, key);
});
