export type WhatsNewRelease = {
  id: string;
  autoOpenOptions: boolean;
  autoOpenFromVersions?: readonly string[];
};

/**
 * Release-owned configuration for the current Update highlights announcement.
 *
 * Change `id` only when an announcement should be shown again. Set
 * `autoOpenOptions` only for deliberate, high-impact release onboarding.
 */
export const WHATS_NEW_RELEASE: WhatsNewRelease = {
  // Replaces the pre-release layout/integrations announcement with the full 2.0 copy.
  id: '2.0',
  autoOpenOptions: true
};

export const WHATS_NEW_ACK_STORAGE_KEY = 'whatsNewAcknowledgedId';
export const WHATS_NEW_AUTO_OPEN_STORAGE_KEY = 'whatsNewAutoOpened';
export const LEGACY_WHATS_NEW_AUTO_OPEN_PREFIX = 'whatsNewAutoOpenedRelease:';
export const WHATS_NEW_AUTO_OPEN_MIGRATION_KEY = 'migration:bound-whats-new-auto-open:v1';
export type WhatsNewAutoOpened = { releaseId: string; version: string };

export function resolveWhatsNewAutoOpened(value: unknown): WhatsNewAutoOpened | undefined {
  if (!value || typeof value !== 'object') return;
  const { releaseId, version } = value as Record<string, unknown>;
  if (typeof releaseId === 'string' && releaseId && typeof version === 'string' && version) {
    return { releaseId, version };
  }
  return undefined;
}

export type WhatsNewInstallDetails = {
  reason: string;
  previousVersion?: string;
};

export function shouldAutoOpenWhatsNewOnUpdate(
  details: WhatsNewInstallDetails,
  acknowledgedId: string | undefined,
  release: WhatsNewRelease = WHATS_NEW_RELEASE
): boolean {
  if (details.reason !== 'update' || !details.previousVersion || !release.autoOpenOptions || acknowledgedId === release.id) {
    return false;
  }
  return !release.autoOpenFromVersions || release.autoOpenFromVersions.includes(details.previousVersion);
}

export function legacyWhatsNewAutoOpenStorageKey(
  targetVersion: string,
  release: WhatsNewRelease = WHATS_NEW_RELEASE
): string {
  return `${LEGACY_WHATS_NEW_AUTO_OPEN_PREFIX}${release.id}:${targetVersion}`;
}
