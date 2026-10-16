import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createFeatureHighlightsLifecycle } from './feature-highlights-lifecycle';
import {
  FEATURE_HIGHLIGHTS_MAX_AGE_MS, HIDDEN_THROUGH_STORAGE_KEY, HIGHLIGHTS_WINDOW_STORAGE_KEY, NEW_FEATURE_ITEMS,
  SEEN_ITEMS_STORAGE_KEY, isNewFeature, resolveFeatureHighlights
} from './feature-highlights';
import {
  WHATS_NEW_AUTO_OPEN_MIGRATION_KEY, WHATS_NEW_AUTO_OPEN_STORAGE_KEY, WHATS_NEW_RELEASE,
  LEGACY_WHATS_NEW_AUTO_OPEN_PREFIX, legacyWhatsNewAutoOpenStorageKey, resolveWhatsNewAutoOpened
} from './whatsNew-release';
import { CURRENT_GENERATION, CURRENT_VERSION, PREVIOUS_GENERATION } from './test-utils/release';

function storage(initial: Record<string, unknown> = {}) {
  const values = { ...initial };
  let enumerations = 0;
  const removals: string[][] = [];
  return {
    values, removals, get enumerations() { return enumerations; },
    async get(keys: string | string[] | null) {
      if (keys === null) { enumerations++; return { ...values }; }
      return Object.fromEntries((typeof keys === 'string' ? [keys] : keys).map(key => [key, values[key]]));
    },
    async set(next: Record<string, unknown>) { Object.assign(values, next); },
    async remove(keys: string[]) { removals.push(keys); keys.forEach(key => delete values[key]); }
  };
}
const update = { reason: 'update', previousVersion: `${PREVIOUS_GENERATION}.0` };
const time = 1_800_000_000_000;

it('migrates exact current marker once, removes only legacy keys in one batch and never re-prompts', async () => {
  const db = storage({
    [legacyWhatsNewAutoOpenStorageKey(CURRENT_VERSION)]: true,
    [`${LEGACY_WHATS_NEW_AUTO_OPEN_PREFIX}older:0.1`]: true,
    [`${LEGACY_WHATS_NEW_AUTO_OPEN_PREFIX}corrupt`]: false,
    whatsNewAutoOpenedRelease: 'unrelated exact prefix without colon', unrelated: { keep: true },
    [WHATS_NEW_AUTO_OPEN_MIGRATION_KEY]: 'corrupt truthy marker',
    [WHATS_NEW_AUTO_OPEN_STORAGE_KEY]: { releaseId: 'older', version: '0.1' }
  });
  let opens = 0;
  const lifecycle = createFeatureHighlightsLifecycle(db, CURRENT_VERSION, () => time);
  await Promise.all(Array.from({ length: 5 }, () => lifecycle.installed(update, async () => { opens++; })));
  assert.equal(opens, 0);
  assert.equal(db.enumerations, 1);
  assert.equal(db.removals.length, 1);
  assert.equal(db.removals[0].length, 3);
  assert.equal(db.values[WHATS_NEW_AUTO_OPEN_MIGRATION_KEY], true);
  assert.deepEqual(db.values[WHATS_NEW_AUTO_OPEN_STORAGE_KEY], { releaseId: WHATS_NEW_RELEASE.id, version: CURRENT_VERSION });
  assert.deepEqual(db.values.unrelated, { keep: true });
  assert.equal(db.values.whatsNewAutoOpenedRelease, 'unrelated exact prefix without colon');
  assert.ok(!Object.keys(db.values).some(key => key.startsWith(LEGACY_WHATS_NEW_AUTO_OPEN_PREFIX)));
});

it('serializes concurrent updates, keeps one auto-open record and preserves announcement acknowledgement across builds', async () => {
  const db = storage({ [legacyWhatsNewAutoOpenStorageKey(`${CURRENT_VERSION}.9`)]: true });
  let opens = 0;
  const open = async () => { opens++; };
  const lifecycle = createFeatureHighlightsLifecycle(db, CURRENT_VERSION, () => time);
  await Promise.all([lifecycle.installed(update, open), lifecycle.read(), lifecycle.installed(update, open)]);
  assert.equal(opens, WHATS_NEW_RELEASE.autoOpenOptions ? 1 : 0);
  const patch = `${CURRENT_VERSION}.1`;
  await createFeatureHighlightsLifecycle(db, patch, () => time + 100).installed(update, open);
  assert.equal(opens, WHATS_NEW_RELEASE.autoOpenOptions ? 2 : 0);
  assert.deepEqual(db.values[HIGHLIGHTS_WINDOW_STORAGE_KEY], { generation: CURRENT_GENERATION, firstShownAt: time });
  db.values.whatsNewAcknowledgedId = WHATS_NEW_RELEASE.id;
  await createFeatureHighlightsLifecycle(db, `${CURRENT_VERSION}.2`, () => time + 200).installed(update, open);
  assert.equal(opens, WHATS_NEW_RELEASE.autoOpenOptions ? 2 : 0);
});

it('retries interrupted migration before/after removal without losing the seed or touching unrelated storage', async () => {
  for (const phase of ['seed', 'remove', 'complete']) {
    const db = storage({ [legacyWhatsNewAutoOpenStorageKey(CURRENT_VERSION)]: true, keep: true });
    const set = db.set, remove = db.remove;
    let failed = false;
    db.set = async next => {
      if (!failed && ((phase === 'seed' && WHATS_NEW_AUTO_OPEN_STORAGE_KEY in next)
        || (phase === 'complete' && WHATS_NEW_AUTO_OPEN_MIGRATION_KEY in next))) {
        failed = true; throw new Error('interrupted');
      }
      await set(next);
    };
    db.remove = async keys => {
      if (!failed && phase === 'remove') { failed = true; throw new Error('interrupted'); }
      await remove(keys);
    };
    let opens = 0;
    const lifecycle = createFeatureHighlightsLifecycle(db, CURRENT_VERSION, () => time);
    await assert.rejects(lifecycle.installed(update, async () => { opens++; }), /interrupted/);
    // A new owner also models worker restart after a partially persisted migration.
    await createFeatureHighlightsLifecycle(db, CURRENT_VERSION, () => time).installed(update, async () => { opens++; });
    assert.equal(opens, 0, phase);
    assert.equal(db.values.keep, true);
    assert.equal(db.values[WHATS_NEW_AUTO_OPEN_MIGRATION_KEY], true);
  }
});

it('normalizes corrupt/partial records and prunes removed, duplicate and untrusted item identities', async () => {
  for (const value of [undefined, null, true, [], {}, { generation: CURRENT_GENERATION },
    { generation: CURRENT_GENERATION, firstShownAt: -1 },
    { generation: CURRENT_GENERATION, firstShownAt: NaN },
    { generation: CURRENT_GENERATION, firstShownAt: time + 1 },
    { generation: 'bad', firstShownAt: time }]) {
    const key = `${NEW_FEATURE_ITEMS[0].id}@${NEW_FEATURE_ITEMS[0].since}`;
    const db = storage({ [HIGHLIGHTS_WINDOW_STORAGE_KEY]: value, [SEEN_ITEMS_STORAGE_KEY]: ['removed@1.0', key, key, null, 9] });
    const lifecycle = createFeatureHighlightsLifecycle(db, CURRENT_VERSION, () => time);
    await Promise.all([lifecycle.read(), lifecycle.read()]);
    assert.deepEqual(db.values[HIGHLIGHTS_WINDOW_STORAGE_KEY], { generation: CURRENT_GENERATION, firstShownAt: time });
    assert.deepEqual(db.values[SEEN_ITEMS_STORAGE_KEY], [key]);
    await lifecycle.acknowledge();
    assert.ok((db.values[SEEN_ITEMS_STORAGE_KEY] as string[]).every(item => item === key));
  }
  for (const value of [null, true, 'yes', {}, { releaseId: WHATS_NEW_RELEASE.id }, { releaseId: '', version: CURRENT_VERSION }]) {
    assert.equal(resolveWhatsNewAutoOpened(value), undefined);
    const db = storage({ [WHATS_NEW_AUTO_OPEN_STORAGE_KEY]: value });
    let opens = 0;
    await createFeatureHighlightsLifecycle(db, CURRENT_VERSION, () => time).installed(update, async () => { opens++; });
    assert.equal(opens, WHATS_NEW_RELEASE.autoOpenOptions ? 1 : 0);
  }
});

it('lazy reads and same-generation rebuilds never restart an expired development window', async () => {
  const version = '0.26.1016.1512';
  const db = storage();
  let now = time;
  const lifecycle = createFeatureHighlightsLifecycle(db, version, () => now);
  const first = await lifecycle.read();
  now += FEATURE_HIGHLIGHTS_MAX_AGE_MS;
  const again = await createFeatureHighlightsLifecycle(db, '0.26.1017.1200', () => now).read();
  assert.deepEqual(again[HIGHLIGHTS_WINDOW_STORAGE_KEY], first[HIGHLIGHTS_WINDOW_STORAGE_KEY]);
  assert.equal(isNewFeature('playerAudio', resolveFeatureHighlights(version, {}, again, now)), false);
  assert.equal(db.enumerations, 0, 'ordinary reads never enumerate the profile');
  await lifecycle.acknowledge();
  assert.deepEqual(db.values[SEEN_ITEMS_STORAGE_KEY], NEW_FEATURE_ITEMS.map(item => `${item.id}@${item.since}`));
});

it('carries only the previous generation clock so rollover cannot revive expired badges', async () => {
  const db = storage();
  await createFeatureHighlightsLifecycle(db, '9.1.0', () => time).read();
  const nextTime = time + FEATURE_HIGHLIGHTS_MAX_AGE_MS;
  const next = await createFeatureHighlightsLifecycle(db, '9.2.0', () => nextTime).read();
  assert.deepEqual(next[HIGHLIGHTS_WINDOW_STORAGE_KEY], {
    generation: '9.2', firstShownAt: nextTime, previous: { generation: '9.1', firstShownAt: time }
  });
  const { isNewSince } = await import('./feature-highlights');
  let state = resolveFeatureHighlights('9.2.0', {}, { ...next, newFeaturesSeenThrough: '9.0' }, nextTime);
  assert.equal(isNewSince('9.1', state), false, 'expired previous badges stay expired');
  assert.equal(isNewSince('9.2', state), true);
  const rollover = await createFeatureHighlightsLifecycle(db, '9.3.0', () => nextTime + 1).read();
  assert.deepEqual(rollover[HIGHLIGHTS_WINDOW_STORAGE_KEY], {
    generation: '9.3', firstShownAt: nextTime + 1, previous: { generation: '9.2', firstShownAt: nextTime }
  });
  state = resolveFeatureHighlights('9.3.0', {}, { ...rollover, newFeaturesSeenThrough: '9.0' }, nextTime + 1);
  assert.equal(isNewSince('9.1', state), false, 'older generations leave the bounded record and eligibility');
  assert.equal(isNewSince('9.2', state), true);
  assert.equal(isNewSince('9.2', resolveFeatureHighlights('9.3.0', {}, { ...rollover, newFeaturesSeenThrough: '9.0' }, nextTime + FEATURE_HIGHLIGHTS_MAX_AGE_MS)), false);
  const skipped = await createFeatureHighlightsLifecycle(db, '9.5.0', () => nextTime + 2).read();
  assert.deepEqual(skipped[HIGHLIGHTS_WINDOW_STORAGE_KEY], { generation: '9.5', firstShownAt: nextTime + 2 });
});

it('stores one hidden-through generation, drops it on a newer generation and restores on request', async () => {
  const db = storage();
  const lifecycle = createFeatureHighlightsLifecycle(db, '9.1.0', () => time);
  await Promise.all([lifecycle.hideUntilNextVersion(), lifecycle.hideUntilNextVersion()]);
  assert.equal(db.values[HIDDEN_THROUGH_STORAGE_KEY], '9.1');
  assert.equal((await lifecycle.read())[HIDDEN_THROUGH_STORAGE_KEY], '9.1');
  const patch = await createFeatureHighlightsLifecycle(db, '9.1.4', () => time + 1).read();
  assert.equal(patch[HIDDEN_THROUGH_STORAGE_KEY], '9.1', 'patch builds stay hidden');
  const next = await createFeatureHighlightsLifecycle(db, '9.2.0', () => time + 2).read();
  assert.equal(next[HIDDEN_THROUGH_STORAGE_KEY], undefined);
  assert.ok(!(HIDDEN_THROUGH_STORAGE_KEY in db.values), 'expired marker is removed from storage');
  await lifecycle.hideUntilNextVersion();
  await lifecycle.restoreHidden();
  assert.ok(!(HIDDEN_THROUGH_STORAGE_KEY in db.values));
  db.values[HIDDEN_THROUGH_STORAGE_KEY] = 'corrupt';
  await lifecycle.read();
  assert.ok(!(HIDDEN_THROUGH_STORAGE_KEY in db.values));
});
