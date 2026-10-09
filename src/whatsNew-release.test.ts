import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  itemKeys: [],
  autoOpenOptions: true
};

describe('What\'s New release configuration', () => {
  it('references available announcement messages in the canonical catalog', () => {
    const requiredKeys = [
      'whatsNewLead',
      ...WHATS_NEW_RELEASE.itemKeys,
      'whatsNewThanks'
    ];
    // Catalog shape, other locales and key parity are covered in scripts/locales.test.ts.
    const messages = JSON.parse(readFileSync(resolve(import.meta.dirname, '../_locales/en/messages.json'), 'utf8')) as Record<
      string,
      { message?: string }
    >;
    for (const key of requiredKeys) {
      assert.ok(messages[key]?.message?.trim(), `announcement references missing or empty message ${key}`);
    }
  });

  it('does not auto-open when the release flag is disabled', () => {
    assert.equal(shouldAutoOpenWhatsNewOnUpdate(
      { reason: 'update', previousVersion: '1.0.0' },
      { ...autoOpenRelease, autoOpenOptions: false }
    ), false);
  });

  it('opens only for update events with a previous version', () => {
    assert.equal(shouldAutoOpenWhatsNewOnUpdate({ reason: 'install' }, autoOpenRelease), false);
    assert.equal(shouldAutoOpenWhatsNewOnUpdate({ reason: 'update' }, autoOpenRelease), false);
    assert.equal(shouldAutoOpenWhatsNewOnUpdate(
      { reason: 'update', previousVersion: '1.0.0' },
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
      release
    ), true);
    assert.equal(shouldAutoOpenWhatsNewOnUpdate(
      { reason: 'update', previousVersion: '1.1.0' },
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
