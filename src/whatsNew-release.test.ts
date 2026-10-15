import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  WHATS_NEW_RELEASE,
  shouldAutoOpenWhatsNewOnUpdate,
  whatsNewAutoOpenStorageKey,
  type WhatsNewRelease
} from './whatsNew-release';

const autoOpenRelease: WhatsNewRelease = {
  id: 'major-update',
  autoOpenOptions: true
};

describe('Update highlights release configuration', () => {
  it('keeps announcement copy out of every locale catalog', () => {
    const removed = ['whatsNewLead', 'whatsNewItemChat', 'whatsNewItemLayout', 'whatsNewItemControls', 'whatsNewItemAudio', 'whatsNewItemServices', 'whatsNewThanks'];
    const locales = resolve(import.meta.dirname, '../_locales');
    for (const locale of readdirSync(locales)) {
      const messages = JSON.parse(readFileSync(resolve(locales, locale, 'messages.json'), 'utf8'));
      for (const key of removed) assert.equal(Object.hasOwn(messages, key), false, `${locale}: ${key}`);
      assert.ok(messages.whatsNewDialogTitle);
      assert.ok(messages.whatsNew);
    }
    assert.equal(WHATS_NEW_RELEASE.id, '1.6');
    const update = { reason: 'update', previousVersion: '1.5.0' };
    assert.equal(shouldAutoOpenWhatsNewOnUpdate(update, 'player-layout-and-integrations'), true);
    assert.equal(shouldAutoOpenWhatsNewOnUpdate(update, '1.6'), false);
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

  it('uses a release and target-version-specific idempotency key', () => {
    const key = whatsNewAutoOpenStorageKey('2.0.0', autoOpenRelease);
    assert.equal(whatsNewAutoOpenStorageKey('2.0.0', autoOpenRelease), key);
    assert.notEqual(whatsNewAutoOpenStorageKey('2.0.1', autoOpenRelease), key);
    assert.notEqual(whatsNewAutoOpenStorageKey('2.0.0', { ...autoOpenRelease, id: 'next-release' }), key);
  });
});
