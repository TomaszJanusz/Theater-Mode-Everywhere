import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
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
