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
  itemKeys: [],
  autoOpenOptions: true
};

describe('What\'s New release configuration', () => {
  it('announces Rich Theater Experience and opens Settings after an update', () => {
    assert.equal(WHATS_NEW_RELEASE.id, 'rich-theater-experience');
    assert.deepEqual(WHATS_NEW_RELEASE.itemKeys, [
      'whatsNewItemCaptions',
      'whatsNewItemChapters',
      'whatsNewItemPreviews'
    ]);
    assert.equal(shouldAutoOpenWhatsNewOnUpdate(
      { reason: 'update', previousVersion: '1.4.0' }
    ), true);
  });

  it('has Rich Theater Experience copy in every locale without legacy items', () => {
    const requiredKeys = [
      'whatsNewLead',
      'whatsNewItemCaptions',
      'whatsNewItemChapters',
      'whatsNewItemPreviews',
      'whatsNewThanks'
    ];
    const legacyKeys = [
      'whatsNewItemFit',
      'whatsNewItemSwitchVideo',
      'whatsNewItemSettings'
    ];
    const localesDir = resolve(import.meta.dirname, '../_locales');

    for (const locale of readdirSync(localesDir)) {
      const messages = JSON.parse(readFileSync(resolve(localesDir, locale, 'messages.json'), 'utf8')) as Record<
        string,
        { message?: string }
      >;
      for (const key of requiredKeys) {
        assert.equal(typeof messages[key]?.message, 'string', `${locale} is missing ${key}`);
        assert.ok(messages[key].message?.trim(), `${locale} has an empty ${key}`);
      }
      for (const key of legacyKeys) {
        assert.equal(messages[key], undefined, `${locale} still contains ${key}`);
      }
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
    assert.equal(whatsNewAutoOpenStorageKey('2.0.0', autoOpenRelease),
      'whatsNewAutoOpenedRelease:major-update:2.0.0');
  });
});
