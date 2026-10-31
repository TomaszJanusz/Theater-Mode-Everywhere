import { openDialog } from './dialog';
import { t } from './i18n';
import { acknowledgeUpdate } from './protocol/options-page';
import { PENDING_UPDATE_KEY, resolvePendingUpdate, type Generation } from './update-notice';
import { buildWhatsNewContent } from './whatsNew-content';

/** The generation a pending update was announced since; read before acknowledging clears it. */
async function pendingSince(): Promise<Generation | undefined> {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return undefined;
    return resolvePendingUpdate((await chrome.storage.local.get(PENDING_UPDATE_KEY))[PENDING_UPDATE_KEY])?.since;
  } catch {
    return undefined;
  }
}

/**
 * Every route to Update highlights (the Settings button, the popup and the player menu, which land on
 * `options.html#whats-new`) ends here, so opening them is what acknowledges a pending update.
 */
export async function openWhatsNewDialog(): Promise<boolean> {
  const since = await pendingSince();
  if (since) {
    acknowledgeUpdate().catch(error => console.error('[Theater Everywhere] Could not acknowledge the update:', error));
  }
  return openDialog(() => {
    const content = buildWhatsNewContent(since);
    const note = content.querySelector('.whats-new-thanks') ?? undefined;
    return {
      title: t('whatsNewDialogTitle'),
      content,
      note,
      size: 'wide',
      scrollable: true,
      setup: (_overlay, dialog) => dialog.classList.add('te-dialog-whats-new'),
      actions: {
        type: 'acknowledge',
        label: t('dialogAcknowledge')
      }
    };
  });
}
