import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { NEW_FEATURE_ITEMS, compareGenerations, installedGeneration } from './feature-highlights';
import { WHATS_NEW_CONTENT } from './whatsNew-content';
import { MANIFEST_GENERATION, MANIFEST_VERSION } from './test-utils/release';
import {
  WHATS_NEW_RELEASE,
  shouldAutoOpenWhatsNewOnUpdate,
  legacyWhatsNewAutoOpenStorageKey,
  type WhatsNewRelease
} from './whatsNew-release';

const autoOpenRelease: WhatsNewRelease = {
  id: 'major-update',
  autoOpenOptions: true
};

describe('Update highlights release configuration', () => {
  it('agrees with the manifest, package and feature generations, so a half-done version bump fails', () => {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'));
    assert.equal(pkg.version, MANIFEST_VERSION, 'package.json and manifest.json versions differ');
    assert.equal(WHATS_NEW_RELEASE.id, MANIFEST_GENERATION, 'WHATS_NEW_RELEASE.id is not the manifest generation');
    assert.equal(installedGeneration(MANIFEST_VERSION), MANIFEST_GENERATION);
    assert.ok(WHATS_NEW_CONTENT.heading.includes(MANIFEST_GENERATION), 'What\'s New heading names another generation');
    // Items of the next generation may land on dev before the release is prepared (see runningGeneration).
    const [major, minor] = MANIFEST_GENERATION.split('.').map(Number);
    for (const item of NEW_FEATURE_ITEMS) {
      assert.ok(compareGenerations(item.since, `${major}.${minor + 1}`) <= 0, `${item.id} is more than one generation ahead of the manifest`);
    }
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
    const update = { reason: 'update', previousVersion: '0.9.0' };
    assert.equal(shouldAutoOpenWhatsNewOnUpdate(update, 'player-layout-and-integrations'), true);
    assert.equal(shouldAutoOpenWhatsNewOnUpdate(update, WHATS_NEW_RELEASE.id), false);
  });

  it('does not auto-open when the release flag is disabled', () => {
    assert.equal(shouldAutoOpenWhatsNewOnUpdate(
      { reason: 'update', previousVersion: '1.0.0' },
      undefined,
      { ...autoOpenRelease, autoOpenOptions: false }
    ), false);
  });

  it('opens only for update events with a previous version', () => {
    assert.equal(shouldAutoOpenWhatsNewOnUpdate({ reason: 'install' }, undefined, autoOpenRelease), false);
    assert.equal(shouldAutoOpenWhatsNewOnUpdate({ reason: 'update' }, undefined, autoOpenRelease), false);
    assert.equal(shouldAutoOpenWhatsNewOnUpdate(
      { reason: 'update', previousVersion: '1.0.0' },
      undefined,
      autoOpenRelease
    ), true);
  });

  it('does not open Settings when the announcement has already been acknowledged', () => {
    assert.equal(shouldAutoOpenWhatsNewOnUpdate(
      { reason: 'update', previousVersion: '1.0.0' },
      autoOpenRelease.id,
      autoOpenRelease
    ), false);
    assert.equal(shouldAutoOpenWhatsNewOnUpdate(
      { reason: 'update', previousVersion: '1.0.0' },
      'older-announcement',
      autoOpenRelease
    ), true);
  });

  it('honors a release allowlist for source versions', () => {
    const release: WhatsNewRelease = {
      ...autoOpenRelease,
      autoOpenFromVersions: ['1.0.0']
    };
    assert.equal(shouldAutoOpenWhatsNewOnUpdate(
      { reason: 'update', previousVersion: '1.0.0' },
      undefined,
      release
    ), true);
    assert.equal(shouldAutoOpenWhatsNewOnUpdate(
      { reason: 'update', previousVersion: '1.1.0' },
      undefined,
      release
    ), false);
  });

  it('identifies only exact release/build legacy markers for migration', () => {
    const key = legacyWhatsNewAutoOpenStorageKey('7.0.0', autoOpenRelease);
    assert.equal(legacyWhatsNewAutoOpenStorageKey('7.0.0', autoOpenRelease), key);
    assert.notEqual(legacyWhatsNewAutoOpenStorageKey('7.0.1', autoOpenRelease), key);
    assert.notEqual(legacyWhatsNewAutoOpenStorageKey('7.0.0', { ...autoOpenRelease, id: 'next-release' }), key);
  });
});
