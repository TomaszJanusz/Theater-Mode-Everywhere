import { buildWhatsNewContent } from './whatsNew-content';
import { acknowledgeFeatureHighlights } from './feature-highlights-storage';
import { openDialog } from './dialog';
import { t } from './i18n';
import {
  WHATS_NEW_ACK_STORAGE_KEY,
  WHATS_NEW_RELEASE
} from './whatsNew-release';

export { buildWhatsNewContent } from './whatsNew-content';

/**
 * Stable ID of the current Update highlights announcement.
 *
 * Bump this string only when the Update highlights copy should be shown again
 * to people who already dismissed a previous announcement.
 *
 * Leave it unchanged for version bumps, hotfixes, store-listing edits,
 * or any release that should not reopen this dialog.
 */
export const WHATS_NEW_ANNOUNCEMENT_ID = WHATS_NEW_RELEASE.id;

export async function getAcknowledgedAnnouncementId(): Promise<string | null> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const data = await chrome.storage.local.get(WHATS_NEW_ACK_STORAGE_KEY);
      const value = data[WHATS_NEW_ACK_STORAGE_KEY];
      if (typeof value === 'string' && value) {
        return value;
      }
    }
  } catch (_) {
    // Fall through to localStorage for the Vite options preview.
  }

  try {
    return window.localStorage.getItem(WHATS_NEW_ACK_STORAGE_KEY);
  } catch (_) {
    return null;
  }
}

export async function hasUnseenWhatsNew(): Promise<boolean> {
  const acknowledged = await getAcknowledgedAnnouncementId();
  return acknowledged !== WHATS_NEW_ANNOUNCEMENT_ID;
}

export async function acknowledgeWhatsNew(): Promise<void> {
  try {
    await acknowledgeFeatureHighlights();
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({
        [WHATS_NEW_ACK_STORAGE_KEY]: WHATS_NEW_ANNOUNCEMENT_ID
      });
    }
  } catch (_) {
    // Fall through to localStorage for the Vite options preview.
  }

  try {
    window.localStorage.setItem(WHATS_NEW_ACK_STORAGE_KEY, WHATS_NEW_ANNOUNCEMENT_ID);
  } catch (_) {
    // Private mode or blocked storage should not break settings.
  }
}

export async function openWhatsNewDialog(): Promise<boolean> {
  await acknowledgeWhatsNew();
  const result = await openDialog(() => ({
    title: t('whatsNewDialogTitle'),
    content: buildWhatsNewContent(),
    setup: (_overlay, dialog) => dialog.classList.add('te-dialog-whats-new'),
    actions: {
      type: 'acknowledge',
      label: t('dialogAcknowledge')
    }
  }));

  return result;
}
