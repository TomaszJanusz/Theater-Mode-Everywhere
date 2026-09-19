export type WhatsNewRelease = {
  id: string;
  itemKeys: readonly string[];
  autoOpenOptions: boolean;
  autoOpenFromVersions?: readonly string[];
};

/**
 * Release-owned configuration for the current What's New announcement.
 *
 * Change `id` only when an announcement should be shown again. Set
 * `autoOpenOptions` only for deliberate, high-impact release onboarding.
 */
export const WHATS_NEW_RELEASE: WhatsNewRelease = {
  id: 'rich-theater-experience',
  itemKeys: [
    'whatsNewItemCaptions',
    'whatsNewItemChapters',
    'whatsNewItemPreviews'
  ],
  autoOpenOptions: true
};

export const WHATS_NEW_ACK_STORAGE_KEY = 'whatsNewAcknowledgedId';
export const WHATS_NEW_AUTO_OPEN_STORAGE_KEY = 'whatsNewAutoOpenedRelease';

export type WhatsNewInstallDetails = {
  reason: string;
  previousVersion?: string;
};

export function shouldAutoOpenWhatsNewOnUpdate(
  details: WhatsNewInstallDetails,
  release: WhatsNewRelease = WHATS_NEW_RELEASE
): boolean {
  if (details.reason !== 'update' || !details.previousVersion || !release.autoOpenOptions) {
    return false;
  }
  return !release.autoOpenFromVersions || release.autoOpenFromVersions.includes(details.previousVersion);
}

export function whatsNewAutoOpenStorageKey(
  targetVersion: string,
  release: WhatsNewRelease = WHATS_NEW_RELEASE
): string {
  return `${WHATS_NEW_AUTO_OPEN_STORAGE_KEY}:${release.id}:${targetVersion}`;
}
