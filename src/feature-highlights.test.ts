import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import {
  featureHighlightsAcknowledgement, SEEN_ITEMS_STORAGE_KEY, acknowledgeGeneration, initialSeenThrough, installedGeneration, isNewFeature, isNewSince,
  resolveFeatureHighlights, resolveHighlightNewFeatures, withFeatureHighlightsLocal, resolveSeenThrough,
  pendingFeatureHighlights, previousGeneration, HIDDEN_THROUGH_STORAGE_KEY, badgesHiddenUntilNextVersion, compareGenerations, NEW_FEATURE_ITEMS, SEEN_THROUGH_STORAGE_KEY, HIGHLIGHT_NEW_FEATURES_STORAGE_KEY
} from './feature-highlights';
import { MEDIA_PROVIDER_IDS } from './media-features/provider-flags';
import { CURRENT_GENERATION, CURRENT_VERSION, PREVIOUS_GENERATION } from './test-utils/release';

// Newest generation with registered items, and the one preceding it: an upgrade that sees its items as new.
const ITEMS_SINCE = NEW_FEATURE_ITEMS.map(item => item.since).sort(compareGenerations).at(-1)!;
const BEFORE_ITEMS = previousGeneration(ITEMS_SINCE);
// A development build carries the previous manifest version while already containing the items.
const DEV_VERSION = `${BEFORE_ITEMS}.0`;

it('fresh installs start seen; updates keep their existing acknowledgement, including skips', () => {
  const patch = `${CURRENT_VERSION}.3`;
  const fresh = initialSeenThrough('install', patch);
  assert.deepEqual(fresh, { [SEEN_THROUGH_STORAGE_KEY]: CURRENT_GENERATION });
  assert.equal(isNewFeature('settingsLanguage', resolveFeatureHighlights(patch, {}, fresh)), false);
  // Synthetic far-future line: independent of the current release.
  assert.deepEqual(initialSeenThrough('update', '9.2.0'), {});
  const skipped = resolveFeatureHighlights('9.2.0', {}, { [SEEN_THROUGH_STORAGE_KEY]: '9.0' });
  assert.equal(isNewSince('9.1', skipped), true);
  assert.equal(isNewSince('9.2', skipped), true);
});

it('upgrading from before the items shows them and acknowledges through the current generation', () => {
  // The 1.5 line is the last release before the 2.0 major rollover, which history supplies.
  assert.equal(previousGeneration('2.0'), '1.5');
  const state = resolveFeatureHighlights(CURRENT_VERSION, {}, { [SEEN_THROUGH_STORAGE_KEY]: BEFORE_ITEMS });
  assert.equal(isNewFeature('playerAudioTrack', state), true);
  assert.equal(compareGenerations('1.10', '2.0') < 0, true);
  assert.deepEqual(featureHighlightsAcknowledgement(state), { [SEEN_THROUGH_STORAGE_KEY]: CURRENT_GENERATION });
});

it('expires old generations, excludes future items and compares minors numerically', () => {
  // Synthetic lines: arithmetic must not depend on the current release.
  const state = resolveFeatureHighlights('9.2.2', {}, { [SEEN_THROUGH_STORAGE_KEY]: '8.2' });
  assert.equal(isNewSince('9.0', state), false);
  assert.equal(isNewSince('9.1', state), true);
  assert.equal(isNewSince('9.2', state), true);
  assert.equal(isNewSince('8.8', state), false);
  assert.equal(isNewSince('9.10', resolveFeatureHighlights('9.10.0', {}, { [SEEN_THROUGH_STORAGE_KEY]: '9.9' })), true);
  assert.equal(installedGeneration('9.0.9.1'), '9.0');
  assert.throws(() => installedGeneration('bad'));
});

it('a development build on the previous manifest version shows and acknowledges the new generation', () => {
  const dev = resolveFeatureHighlights(DEV_VERSION, {}, { [SEEN_THROUGH_STORAGE_KEY]: BEFORE_ITEMS });
  assert.equal(dev.installed, ITEMS_SINCE);
  assert.equal(isNewFeature('playerAudioTrack', dev), true);
  assert.equal(isNewFeature('playerAudioTrack', resolveFeatureHighlights(DEV_VERSION, {}, featureHighlightsAcknowledgement(dev))), false);
  assert.equal(isNewFeature('playerAudioTrack', pendingFeatureHighlights(DEV_VERSION)), false);
});

it('normalizes missing/invalid storage through shared resolvers', () => {
  for (const value of [undefined, null, 1.6, false, [], {}, '2.0.0', '01.6', '1.x', '1.-1', 'Infinity.0']) {
    assert.equal(resolveSeenThrough(value, CURRENT_GENERATION), PREVIOUS_GENERATION);
    assert.equal(resolveHighlightNewFeatures(value), value === false ? false : true);
  }
  assert.equal(resolveHighlightNewFeatures(false), false);
  assert.equal(resolveSeenThrough('1.4', CURRENT_GENERATION), '1.4');
  assert.equal(isNewFeature('playerAudioTrack', resolveFeatureHighlights(CURRENT_VERSION)), true);
});

it('acknowledgement covers installed generations without regressing after downgrade', () => {
  const state = resolveFeatureHighlights(CURRENT_VERSION);
  assert.equal(acknowledgeGeneration(state), CURRENT_GENERATION);
  const disabled = resolveFeatureHighlights(CURRENT_VERSION, { [HIGHLIGHT_NEW_FEATURES_STORAGE_KEY]: false });
  assert.equal(isNewFeature('settingsLanguage', disabled), false);
  const acknowledged = { ...state, seenThrough: acknowledgeGeneration(disabled) };
  assert.equal(isNewFeature('settingsLanguage', acknowledged), false);
  assert.equal(acknowledgeGeneration({ ...state, seenThrough: '9.9' }), '9.9');
});

it('shows nothing as new until the acknowledged generation has been read', () => {
  const pending = pendingFeatureHighlights(CURRENT_VERSION);
  assert.equal(isNewFeature('settingsLanguage', pending), false);
  assert.equal(isNewFeature('playerAudioTrack', pending), false);
  assert.equal(isNewFeature('playerAudioTrack', resolveFeatureHighlights(CURRENT_VERSION)), true, 'an existing install without a stored value still sees the current items');
});

it('registers every New marker of Settings, and every service tile added since the previous release', () => {
  const html = readFileSync(new URL('../options/options.html', import.meta.url), 'utf8');
  const ids = new Set<string>(NEW_FEATURE_ITEMS.map(item => item.id));
  const marked = [...html.matchAll(/data-new-feature="([^"]+)"/g)].map(match => match[1]);
  for (const id of marked) assert.ok(ids.has(id), `${id} is marked in options.html but not registered`);
  for (const id of ['settingsAutoEnterTheater', 'settingsHighContrast', 'settingsReduceTransparency', 'settingsReduceMotion']) {
    assert.ok(marked.includes(id), `${id} has a home in options.html`);
  }
  // Tiles are generated from the provider list, named `rte` + the capitalized provider id.
  const tiles = new Set<string>(MEDIA_PROVIDER_IDS.map(id => `rte${id[0].toUpperCase()}${id.slice(1)}`));
  for (const id of ['rteBilibili', 'rteBilibiliIntl', 'rteTencent', 'rteCrunchyroll', 'rteNetflix', 'rteViki', 'rteIqiyi', 'rteSoop']) {
    assert.ok(ids.has(id) && tiles.has(id), `${id} is registered for a real service tile`);
  }
  // An install from before the first item generation still sees every generation's items.
  const first = NEW_FEATURE_ITEMS.map(item => item.since).sort(compareGenerations)[0];
  const state = resolveFeatureHighlights(CURRENT_VERSION, {}, { [SEEN_THROUGH_STORAGE_KEY]: previousGeneration(first) });
  for (const item of NEW_FEATURE_ITEMS) assert.equal(isNewFeature(item.id, state), true, item.id);
});

it('development acknowledgements track item identity rather than suppressing a whole unreleased generation', () => {
  for (const version of ['0.26.1016.1512', DEV_VERSION]) {
    const legacy = { [SEEN_THROUGH_STORAGE_KEY]: ITEMS_SINCE };
    const state = resolveFeatureHighlights(version, {}, legacy);
    assert.equal(isNewFeature('playerAudioTrack', state), true, 'legacy generation ack cannot hide unreleased items');
    const acknowledged = featureHighlightsAcknowledgement(state);
    const reloaded = resolveFeatureHighlights(version, {}, acknowledged);
    assert.equal(NEW_FEATURE_ITEMS.some(item => isNewFeature(item.id, reloaded)), false);
    const rebuilt = resolveFeatureHighlights('0.26.1017.1200', {}, acknowledged);
    assert.equal(isNewFeature('playerAudioTrack', rebuilt), false, 'date/version changes alone do not resurrect items');
    const beforeAudioWasAdded = { ...acknowledged,
      [SEEN_ITEMS_STORAGE_KEY]: (acknowledged[SEEN_ITEMS_STORAGE_KEY] as string[]).filter(key => key !== `playerAudioTrack@${ITEMS_SINCE}`) };
    const added = resolveFeatureHighlights(version, {}, beforeAudioWasAdded);
    assert.equal(isNewFeature('playerAudioTrack', added), true);
    assert.equal(isNewFeature('playerPictureLayout', added), false);
    assert.equal(isNewFeature('playerAudioTrack', resolveFeatureHighlights(version,
      { [HIGHLIGHT_NEW_FEATURES_STORAGE_KEY]: false }, beforeAudioWasAdded)), false);
    assert.equal(isNewFeature('playerAudioTrack', pendingFeatureHighlights(version)), false);
  }
  const release = resolveFeatureHighlights(CURRENT_VERSION, {}, { [SEEN_THROUGH_STORAGE_KEY]: BEFORE_ITEMS, [SEEN_ITEMS_STORAGE_KEY]: NEW_FEATURE_ITEMS.map(item => `${item.id}@${item.since}`) });
  assert.equal(isNewFeature('playerAudioTrack', release), true, 'dev snapshots do not acknowledge a release');
  assert.deepEqual(featureHighlightsAcknowledgement(release), { [SEEN_THROUGH_STORAGE_KEY]: CURRENT_GENERATION });
});

it('caps current and previous generation badges at exactly 30 days with an injected clock', async () => {
  const { FEATURE_HIGHLIGHTS_MAX_AGE_MS: age, HIGHLIGHTS_WINDOW_STORAGE_KEY: key } = await import('./feature-highlights');
  const start = 1_800_000_000_000;
  const local = { [SEEN_THROUGH_STORAGE_KEY]: '9.0', [key]: { generation: '9.2', firstShownAt: start } };
  for (const [elapsed, visible] of [[age - 1, true], [age, false], [age + 1, false]] as const) {
    const state = resolveFeatureHighlights('9.2.0', {}, local, start + elapsed);
    assert.equal(isNewSince('9.1', state), visible);
    assert.equal(isNewSince('9.2', state), visible);
    assert.equal(isNewSince('9.0', state), false);
    assert.equal(isNewSince('9.3', state), false);
  }
  const next = resolveFeatureHighlights('9.3.0', {}, { ...local, [key]: { generation: '9.3', firstShownAt: start + age } }, start + age);
  assert.equal(isNewSince('9.1', next), false);
  assert.equal(isNewSince('9.2', next), true);
});

it('development item acknowledgements and disabled highlights obey the same profile time cap', async () => {
  const { FEATURE_HIGHLIGHTS_MAX_AGE_MS: age, HIGHLIGHTS_WINDOW_STORAGE_KEY: key } = await import('./feature-highlights');
  const start = 1_800_000_000_000;
  const local = { [key]: { generation: ITEMS_SINCE, firstShownAt: start } };
  const first = resolveFeatureHighlights(DEV_VERSION, {}, local, start);
  assert.equal(isNewFeature('playerAudioTrack', first), true);
  for (const version of [DEV_VERSION, '0.26.1017.1200']) {
    assert.equal(isNewFeature('playerAudioTrack', resolveFeatureHighlights(version, {}, local, start + age - 1)), true);
    assert.equal(isNewFeature('playerAudioTrack', resolveFeatureHighlights(version, {}, local, start + age)), false);
  }
  assert.equal(isNewFeature('playerAudioTrack', resolveFeatureHighlights(DEV_VERSION,
    { [HIGHLIGHT_NEW_FEATURES_STORAGE_KEY]: false }, local, start)), false);
  assert.equal(isNewFeature('playerAudioTrack', resolveFeatureHighlights(DEV_VERSION, {},
    { ...local, ...featureHighlightsAcknowledgement(first) }, start)), false);
});

it('normalizes window records to at most two valid adjacent generation clocks', async () => {
  const { resolveHighlightsWindow } = await import('./feature-highlights');
  const current = { generation: '9.2', firstShownAt: 100 };
  const previous = { generation: '9.1', firstShownAt: 50 };
  assert.deepEqual(resolveHighlightsWindow({ ...current, junk: true, previous: { ...previous, previous } }), { ...current, previous });
  for (const invalid of [{}, { ...previous, generation: '9.0' }, { ...previous, firstShownAt: 101 },
    { ...previous, firstShownAt: -1 }, { ...previous, firstShownAt: Infinity }]) {
    assert.deepEqual(resolveHighlightsWindow({ ...current, previous: invalid }), current);
  }
});

it('hide until next version silences badges and unseen state for the running generation only', () => {
  const hidden = { [HIDDEN_THROUGH_STORAGE_KEY]: CURRENT_GENERATION };
  const state = resolveFeatureHighlights(CURRENT_VERSION, {}, hidden);
  assert.equal(badgesHiddenUntilNextVersion(state), true);
  assert.equal(NEW_FEATURE_ITEMS.some(item => isNewFeature(item.id, state)), false);
  // Nothing was acknowledged, so restoring (or a newer generation) brings the badges back.
  assert.equal(state.seenThrough, PREVIOUS_GENERATION);
  assert.equal(isNewFeature('playerAudioTrack', withFeatureHighlightsLocal(state, { [HIDDEN_THROUGH_STORAGE_KEY]: undefined }, 0)), true);
  const next = `${CURRENT_GENERATION.split('.')[0]}.${Number(CURRENT_GENERATION.split('.')[1]) + 1}.0`;
  assert.equal(badgesHiddenUntilNextVersion(resolveFeatureHighlights(next, {}, hidden)), false);
  for (const value of [undefined, null, 5, '2', 'x.y', {}]) {
    assert.equal(badgesHiddenUntilNextVersion(resolveFeatureHighlights(CURRENT_VERSION, {}, { [HIDDEN_THROUGH_STORAGE_KEY]: value })), false);
  }
});
