import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import { compareGenerations, pendingAfterInstall, resolvePendingUpdate, versionGeneration, type Generation } from './update-notice';
import { releasesSince, WHATS_NEW_RELEASES } from './whatsNew-content';

const update = (previousVersion: string) => ({ reason: 'update', previousVersion });

describe('update announcement', () => {
  it('announces only an update to a newer major or minor release', () => {
    assert.deepEqual(pendingAfterInstall(update('2.0.8'), '2.1.0', undefined), { version: '2.1.0', since: '2.0' });
    assert.deepEqual(pendingAfterInstall(update('2.9.3'), '3.0.0', undefined), { version: '3.0.0', since: '2.9' });
    assert.deepEqual(pendingAfterInstall(update('2.9.0'), '2.10.0', undefined), { version: '2.10.0', since: '2.9' }, 'minors compare as numbers');
    for (const [previous, version] of [['2.1.0', '2.1.1'], ['2.1.0', '2.1.0'], ['2.1.0', '2.0.8'], ['2.1.0', 'x'], ['', '2.1.0']]) {
      assert.equal(pendingAfterInstall(update(previous), version, undefined), undefined, `${previous} → ${version}`);
    }
    assert.equal(pendingAfterInstall({ reason: 'install' }, '2.1.0', undefined), undefined);
    assert.equal(pendingAfterInstall({ reason: 'update' }, '2.1.0', undefined), undefined);
  });

  it('never announces a local development build, whose date-based version starts with 0', () => {
    assert.equal(pendingAfterInstall(update('0.26.1231.2359'), '0.27.0101.0000', undefined), undefined, 'a new year');
    assert.equal(pendingAfterInstall(update('2.0.8'), '0.26.1031.1530', undefined), undefined, 'a release replaced by a local build');
  });

  it('keeps the oldest unacknowledged release, so skipped versions add up', () => {
    const pending = { version: '2.1.0', since: '2.0' as Generation };
    assert.deepEqual(pendingAfterInstall(update('2.1.0'), '2.3.0', pending), { version: '2.3.0', since: '2.0' });
    assert.deepEqual(pendingAfterInstall(update('1.9.0'), '2.3.0', pending), { version: '2.3.0', since: '1.9' });
    assert.equal(pendingAfterInstall(update('2.1.0'), '2.1.1', pending), undefined, 'a patch leaves the announcement as it is');
  });

  it('accepts only a well-formed stored announcement', () => {
    assert.deepEqual(resolvePendingUpdate({ version: '2.1.0', since: '2.0' }), { version: '2.1.0', since: '2.0' });
    for (const value of [undefined, null, '2.1.0', {}, { version: '2.1.0' }, { version: 'next', since: '2.0' }, { version: '2.1.0', since: '02.0' }]) {
      assert.equal(resolvePendingUpdate(value), undefined, JSON.stringify(value));
    }
  });
});

describe('Update highlights catalog', () => {
  const releases = [{ ...WHATS_NEW_RELEASES[0], generation: '2.3' as Generation },
    { ...WHATS_NEW_RELEASES[0], generation: '2.1' as Generation }, { ...WHATS_NEW_RELEASES[0], generation: '2.0' as Generation }];
  const shown = (since?: Generation) => releasesSince(since, releases).map(release => release.generation);

  it('shows every release since the last announced one, newest first, or the latest one', () => {
    assert.deepEqual(shown('2.0'), ['2.3', '2.1']);
    assert.deepEqual(shown('2.1'), ['2.3']);
    assert.deepEqual(shown('1.5'), ['2.3', '2.1', '2.0']);
    assert.deepEqual(shown('2.3'), ['2.3'], 'nothing newer: the latest highlights');
    assert.deepEqual(shown(), ['2.3'], 'opened without an announcement');
  });

  it('lists releases newest first and keeps up with the manifest, so a release cannot ship without its highlights', () => {
    const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '../manifest.json'), 'utf8')).version;
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'));
    assert.equal(pkg.version, manifest, 'package.json and manifest.json versions differ');
    const generation = versionGeneration(manifest)!;
    const [major, minor] = generation.split('.').map(Number);
    const latest = WHATS_NEW_RELEASES[0].generation;
    // A development branch may carry the next release's highlights before its version bump.
    assert.ok(compareGenerations(latest, generation) >= 0, `Update highlights have no ${generation} entry`);
    assert.ok(compareGenerations(latest, `${major}.${minor + 1}`) <= 0, `${latest} is more than one release ahead of the manifest`);
    WHATS_NEW_RELEASES.forEach((release, index) => {
      assert.ok(release.heading.includes(release.generation), `the ${release.generation} heading names another release`);
      if (index) assert.ok(compareGenerations(WHATS_NEW_RELEASES[index - 1].generation, release.generation) > 0, 'releases are newest first');
    });
  });

  it('keeps announcement copy out of every locale catalog', () => {
    const removed = ['whatsNewLead', 'whatsNewItemChat', 'whatsNewItemLayout', 'whatsNewItemControls', 'whatsNewItemAudio', 'whatsNewItemServices', 'whatsNewThanks'];
    const locales = resolve(import.meta.dirname, '../_locales');
    for (const locale of readdirSync(locales)) {
      const messages = JSON.parse(readFileSync(resolve(locales, locale, 'messages.json'), 'utf8'));
      for (const key of removed) assert.equal(Object.hasOwn(messages, key), false, `${locale}: ${key}`);
      assert.ok(messages.whatsNewDialogTitle);
      assert.ok(messages.whatsNew);
    }
  });
});
