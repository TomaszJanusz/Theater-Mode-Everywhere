import { t } from '../src/i18n';
import { requestOptionsPage } from '../src/protocol/options-page';
import { announcedGeneration, PENDING_UPDATE_KEY, resolvePendingUpdate } from '../src/update-notice';

/**
 * The popup's update panel. It follows the stored announcement, so opening Update highlights anywhere
 * (this button, the player menu, Settings) hides it here too; the background owns the write.
 */
export function setupPopupUpdateNotice(): { render(): void; dispose(): void } {
  const card = document.getElementById('update-card') as HTMLElement;
  const title = document.getElementById('update-title') as HTMLElement;
  const button = document.getElementById('update-btn') as HTMLButtonElement;
  let version: string | null = null;
  let changed = false;
  const render = () => {
    card.hidden = !version;
    title.textContent = version ? t('updatePanelTitle', version) : '';
  };
  const show = (value: unknown) => {
    const pending = resolvePendingUpdate(value);
    version = pending ? announcedGeneration(pending) : null;
    render();
  };
  // A change that lands while the first read is in flight is newer than its snapshot.
  const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !changes[PENDING_UPDATE_KEY]) return;
    changed = true;
    show(changes[PENDING_UPDATE_KEY].newValue);
  };
  const open = () => requestOptionsPage('whats-new');
  chrome.storage.onChanged.addListener(onChanged);
  button.addEventListener('click', open);
  chrome.storage.local.get(PENDING_UPDATE_KEY).then(data => {
    if (!changed) show(data[PENDING_UPDATE_KEY]);
  }).catch(error => console.error('Error loading the update notice:', error));
  return {
    render,
    dispose() {
      chrome.storage.onChanged.removeListener(onChanged);
      button.removeEventListener('click', open);
    }
  };
}
