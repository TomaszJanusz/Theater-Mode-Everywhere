import { openDialog } from './dialog';
import { t } from './i18n';

/**
 * Stable ID of the current What's New announcement.
 *
 * Bump this string only when the What's New copy should be shown again
 * to people who already dismissed a previous announcement.
 *
 * Leave it unchanged for version bumps, hotfixes, store-listing edits,
 * or any release that should not reopen this dialog.
 */
export const WHATS_NEW_ANNOUNCEMENT_ID = 'fit-and-settings';
export const WHATS_NEW_ACK_STORAGE_KEY = 'whatsNewAcknowledgedId';

const WHATS_NEW_ITEM_KEYS = [
  'whatsNewItemFit',
  'whatsNewItemSwitchVideo',
  'whatsNewItemSettings'
] as const;

export function buildWhatsNewContent(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'whats-new-content';

  const lead = document.createElement('p');
  lead.className = 'whats-new-lead';
  lead.textContent = t('whatsNewLead');
  root.appendChild(lead);

  const list = document.createElement('ul');
  list.className = 'whats-new-list';
  for (const key of WHATS_NEW_ITEM_KEYS) {
    const item = document.createElement('li');
    item.textContent = t(key);
    list.appendChild(item);
  }
  root.appendChild(list);

  const thanks = document.createElement('p');
  thanks.className = 'whats-new-thanks';
  thanks.textContent = t('whatsNewThanks');
  root.appendChild(thanks);
  return root;
}

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
  const result = await openDialog({
    title: t('whatsNewDialogTitle'),
    content: buildWhatsNewContent(),
    actions: {
      type: 'acknowledge',
      label: t('dialogAcknowledge')
    }
  });

  if (result) {
    await acknowledgeWhatsNew();
  }

  return result;
}

export async function syncWhatsNewButtonState(button: HTMLElement): Promise<void> {
  const unseen = await hasUnseenWhatsNew();
  button.classList.toggle('has-unseen', unseen);
  button.toggleAttribute('data-unseen', unseen);
}
