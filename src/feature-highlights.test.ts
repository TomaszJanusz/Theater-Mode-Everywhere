import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  acknowledgeGeneration, initialSeenThrough, installedGeneration, isNewFeature, isNewSince,
  resolveFeatureHighlights, resolveHighlightNewFeatures, resolveSeenThrough,
  pendingFeatureHighlights, SEEN_THROUGH_STORAGE_KEY, HIGHLIGHT_NEW_FEATURES_STORAGE_KEY
} from './feature-highlights';

it('fresh installs start seen; updates keep their existing acknowledgement, including skips', () => {
  const fresh = initialSeenThrough('install', '1.6.3');
  assert.deepEqual(fresh, { [SEEN_THROUGH_STORAGE_KEY]: '1.6' });
  assert.equal(isNewFeature('settingsLanguage', resolveFeatureHighlights('1.6.3', {}, fresh)), false);
  assert.deepEqual(initialSeenThrough('update', '1.7.0'), {});
  const skipped = resolveFeatureHighlights('1.7.0', {}, { [SEEN_THROUGH_STORAGE_KEY]: '1.5' });
  assert.equal(isNewSince('1.6', skipped), true);
  assert.equal(isNewSince('1.7', skipped), true);
});

it('expires old generations, excludes future items and compares minors numerically', () => {
  const state = resolveFeatureHighlights('1.7.2', {}, { [SEEN_THROUGH_STORAGE_KEY]: '1.2' });
  assert.equal(isNewSince('1.5', state), false);
  assert.equal(isNewSince('1.6', state), true);
  assert.equal(isNewSince('1.7', state), true);
  assert.equal(isNewSince('1.8', state), false);
  assert.equal(isNewFeature('settingsLanguage', resolveFeatureHighlights('1.5.0')), false);
  assert.equal(isNewSince('1.10', resolveFeatureHighlights('1.10.0', {}, { [SEEN_THROUGH_STORAGE_KEY]: '1.9' })), true);
  assert.equal(installedGeneration('1.6.9.1'), '1.6');
  assert.throws(() => installedGeneration('bad'));
});

it('normalizes missing/invalid storage through shared resolvers', () => {
  for (const value of [undefined, null, 1.6, false, [], {}, '1.6.0', '01.6', '1.x', '1.-1', 'Infinity.0']) {
    assert.equal(resolveSeenThrough(value, '1.6'), '1.5');
    assert.equal(resolveHighlightNewFeatures(value), value === false ? false : true);
  }
  assert.equal(resolveHighlightNewFeatures(false), false);
  assert.equal(resolveSeenThrough('1.4', '1.6'), '1.4');
  assert.equal(isNewFeature('settingsLanguage', resolveFeatureHighlights('1.6.0')), true);
});

it('acknowledgement covers installed generations without regressing after downgrade', () => {
  const state = resolveFeatureHighlights('1.6.0');
  assert.equal(acknowledgeGeneration(state), '1.6');
  const disabled = resolveFeatureHighlights('1.6.0', { [HIGHLIGHT_NEW_FEATURES_STORAGE_KEY]: false });
  assert.equal(isNewFeature('settingsLanguage', disabled), false);
  const acknowledged = { ...state, seenThrough: acknowledgeGeneration(disabled) };
  assert.equal(isNewFeature('settingsLanguage', acknowledged), false);
  assert.equal(acknowledgeGeneration({ ...state, seenThrough: '1.7' }), '1.7');
});

it('shows nothing as new until the acknowledged generation has been read', () => {
  const pending = pendingFeatureHighlights('1.6.0');
  assert.equal(isNewFeature('settingsLanguage', pending), false);
  assert.equal(isNewFeature('playerAudio', pending), false);
  assert.equal(isNewFeature('settingsLanguage', resolveFeatureHighlights('1.6.0')), true, 'an existing install without a stored value still sees the current items');
});
