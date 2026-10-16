import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import {
  featureHighlightsAcknowledgement, SEEN_ITEMS_STORAGE_KEY, acknowledgeGeneration, initialSeenThrough, installedGeneration, isNewFeature, isNewSince,
  resolveFeatureHighlights, resolveHighlightNewFeatures, resolveSeenThrough,
  pendingFeatureHighlights, previousGeneration, compareGenerations, NEW_FEATURE_ITEMS, SEEN_THROUGH_STORAGE_KEY, HIGHLIGHT_NEW_FEATURES_STORAGE_KEY
} from './feature-highlights';
import { MEDIA_PROVIDER_IDS } from './media-features/provider-flags';

it('fresh installs start seen; updates keep their existing acknowledgement, including skips', () => {
  const fresh = initialSeenThrough('install', '2.0.3');
  assert.deepEqual(fresh, { [SEEN_THROUGH_STORAGE_KEY]: '2.0' });
  assert.equal(isNewFeature('settingsLanguage', resolveFeatureHighlights('2.0.3', {}, fresh)), false);
  assert.deepEqual(initialSeenThrough('update', '2.2.0'), {});
  const skipped = resolveFeatureHighlights('2.2.0', {}, { [SEEN_THROUGH_STORAGE_KEY]: '1.5' });
  assert.equal(isNewSince('2.1', skipped), true);
  assert.equal(isNewSince('2.2', skipped), true);
});

it('upgrading from 1.5 to 2.0 shows the 2.0 items and acknowledges through 2.0', () => {
  assert.equal(previousGeneration('2.0'), '1.5');
  const state = resolveFeatureHighlights('2.0.0', {}, { [SEEN_THROUGH_STORAGE_KEY]: '1.5' });
  assert.equal(isNewFeature('playerAudio', state), true);
  assert.equal(compareGenerations('1.10', '2.0') < 0, true);
  assert.deepEqual(featureHighlightsAcknowledgement(state), { [SEEN_THROUGH_STORAGE_KEY]: '2.0' });
});

it('expires old generations, excludes future items and compares minors numerically', () => {
  const state = resolveFeatureHighlights('2.2.2', {}, { [SEEN_THROUGH_STORAGE_KEY]: '1.2' });
  assert.equal(isNewSince('2.0', state), false);
  assert.equal(isNewSince('2.1', state), true);
  assert.equal(isNewSince('2.2', state), true);
  assert.equal(isNewSince('1.8', state), false);
  assert.equal(isNewSince('2.10', resolveFeatureHighlights('2.10.0', {}, { [SEEN_THROUGH_STORAGE_KEY]: '2.9' })), true);
  assert.equal(installedGeneration('2.0.9.1'), '2.0');
  assert.throws(() => installedGeneration('bad'));
});

it('a development build on the previous manifest version shows and acknowledges the new generation', () => {
  const dev = resolveFeatureHighlights('1.5.0', {}, { [SEEN_THROUGH_STORAGE_KEY]: '1.5' });
  assert.equal(dev.installed, '2.0');
  assert.equal(isNewFeature('playerAudio', dev), true);
  assert.equal(isNewFeature('playerAudio', resolveFeatureHighlights('1.5.0', {}, featureHighlightsAcknowledgement(dev))), false);
  assert.equal(isNewFeature('playerAudio', pendingFeatureHighlights('1.5.0')), false);
});

it('normalizes missing/invalid storage through shared resolvers', () => {
  for (const value of [undefined, null, 1.6, false, [], {}, '2.0.0', '01.6', '1.x', '1.-1', 'Infinity.0']) {
    assert.equal(resolveSeenThrough(value, '2.0'), '1.5');
    assert.equal(resolveHighlightNewFeatures(value), value === false ? false : true);
  }
  assert.equal(resolveHighlightNewFeatures(false), false);
  assert.equal(resolveSeenThrough('1.4', '2.0'), '1.4');
  assert.equal(isNewFeature('settingsLanguage', resolveFeatureHighlights('2.0.0')), true);
});

it('acknowledgement covers installed generations without regressing after downgrade', () => {
  const state = resolveFeatureHighlights('2.0.0');
  assert.equal(acknowledgeGeneration(state), '2.0');
  const disabled = resolveFeatureHighlights('2.0.0', { [HIGHLIGHT_NEW_FEATURES_STORAGE_KEY]: false });
  assert.equal(isNewFeature('settingsLanguage', disabled), false);
  const acknowledged = { ...state, seenThrough: acknowledgeGeneration(disabled) };
  assert.equal(isNewFeature('settingsLanguage', acknowledged), false);
  assert.equal(acknowledgeGeneration({ ...state, seenThrough: '2.1' }), '2.1');
});

it('shows nothing as new until the acknowledged generation has been read', () => {
  const pending = pendingFeatureHighlights('2.0.0');
  assert.equal(isNewFeature('settingsLanguage', pending), false);
  assert.equal(isNewFeature('playerAudio', pending), false);
  assert.equal(isNewFeature('settingsLanguage', resolveFeatureHighlights('2.0.0')), true, 'an existing install without a stored value still sees the current items');
});

it('registers every New marker of Settings, and every service tile added since 1.5.0', () => {
  const html = readFileSync(new URL('../options/options.html', import.meta.url), 'utf8');
  const ids = new Set<string>(NEW_FEATURE_ITEMS.map(item => item.id));
  const marked = [...html.matchAll(/data-new-feature="([^"]+)"/g)].map(match => match[1]);
  for (const id of marked) assert.ok(ids.has(id), `${id} is marked in options.html but not registered`);
  for (const id of ['settingsAutoEnterTheater', 'settingsHighContrast', 'settingsReduceTransparency', 'settingsReduceMotion']) {
    assert.ok(marked.includes(id), `${id} has a home in options.html`);
  }
  // Tiles are generated from the provider list, named `rte` + the capitalized provider id.
  const tiles = new Set<string>(MEDIA_PROVIDER_IDS.map(id => `rte${id[0].toUpperCase()}${id.slice(1)}`));
  for (const id of ['rteBilibili', 'rteBilibiliIntl', 'rteTencent', 'rteCrunchyroll', 'rteNetflix']) {
    assert.ok(ids.has(id) && tiles.has(id), `${id} is registered for a real service tile`);
  }
  const state = resolveFeatureHighlights('2.0.0', {}, { [SEEN_THROUGH_STORAGE_KEY]: '1.5' });
  for (const item of NEW_FEATURE_ITEMS) assert.equal(isNewFeature(item.id, state), true, item.id);
});

it('development acknowledgements track item identity rather than suppressing a whole unreleased generation', () => {
  for (const version of ['0.26.1016.1512', '1.5.0']) {
    const legacy = { [SEEN_THROUGH_STORAGE_KEY]: '2.0' };
    const state = resolveFeatureHighlights(version, {}, legacy);
    assert.equal(isNewFeature('playerAudio', state), true, 'legacy generation ack cannot hide unreleased items');
    const acknowledged = featureHighlightsAcknowledgement(state);
    const reloaded = resolveFeatureHighlights(version, {}, acknowledged);
    assert.equal(NEW_FEATURE_ITEMS.some(item => isNewFeature(item.id, reloaded)), false);
    const rebuilt = resolveFeatureHighlights('0.26.1017.1200', {}, acknowledged);
    assert.equal(isNewFeature('playerAudio', rebuilt), false, 'date/version changes alone do not resurrect items');
    const beforeAudioWasAdded = { ...acknowledged,
      [SEEN_ITEMS_STORAGE_KEY]: (acknowledged[SEEN_ITEMS_STORAGE_KEY] as string[]).filter(key => key !== 'playerAudio@2.0') };
    const added = resolveFeatureHighlights(version, {}, beforeAudioWasAdded);
    assert.equal(isNewFeature('playerAudio', added), true);
    assert.equal(isNewFeature('playerPictureLayout', added), false);
    assert.equal(isNewFeature('playerAudio', resolveFeatureHighlights(version,
      { [HIGHLIGHT_NEW_FEATURES_STORAGE_KEY]: false }, beforeAudioWasAdded)), false);
    assert.equal(isNewFeature('playerAudio', pendingFeatureHighlights(version)), false);
  }
  const release = resolveFeatureHighlights('2.0.0', {}, { [SEEN_THROUGH_STORAGE_KEY]: '1.5', [SEEN_ITEMS_STORAGE_KEY]: NEW_FEATURE_ITEMS.map(item => `${item.id}@${item.since}`) });
  assert.equal(isNewFeature('playerAudio', release), true, 'dev snapshots do not acknowledge a release');
  assert.deepEqual(featureHighlightsAcknowledgement(release), { [SEEN_THROUGH_STORAGE_KEY]: '2.0' });
});
