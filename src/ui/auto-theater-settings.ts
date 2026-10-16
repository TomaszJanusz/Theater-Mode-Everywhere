import { openDialog, type OpenDialogOptions } from '../dialog';
import { t } from '../i18n';
import { AUTO_THEATER_STORAGE_KEY, resolveAutoEnterTheater } from './auto-theater';
import { shouldOfferVideoActivator, VIDEO_ACTIVATOR_PROMPT_ANSWER_STORAGE_KEY, VIDEO_ACTIVATOR_STORAGE_KEY } from './video-activator-settings';

const PROMPT_KEYS = [AUTO_THEATER_STORAGE_KEY, VIDEO_ACTIVATOR_STORAGE_KEY, VIDEO_ACTIVATOR_PROMPT_ANSWER_STORAGE_KEY];
let revision = 0;
let autoTheaterWrite: Promise<void> = Promise.resolve();

/** Only the initiating settings surface asks; storage observers merely render the saved state. */
export async function saveAutoTheaterEnabled(
  enabled: boolean,
  options: Pick<OpenDialogOptions, 'mount'> & { isCurrent?: () => boolean } = {}
): Promise<void> {
  const request = ++revision;
  const previous = await chrome.storage.sync.get(AUTO_THEATER_STORAGE_KEY);
  if (request !== revision) return;
  const write = autoTheaterWrite.then(async () => {
    if (request !== revision) return;
    await chrome.storage.sync.set({ [AUTO_THEATER_STORAGE_KEY]: enabled });
  });
  // Keep later writes moving while preserving this caller's storage error.
  autoTheaterWrite = write.catch(() => {});
  await write;
  if (enabled || !resolveAutoEnterTheater(previous[AUTO_THEATER_STORAGE_KEY])) return;

  const current = () => request === revision && (options.isCurrent?.() ?? true);
  const settings = await chrome.storage.sync.get(PROMPT_KEYS);
  if (!current() || resolveAutoEnterTheater(settings[AUTO_THEATER_STORAGE_KEY]) || !shouldOfferVideoActivator(settings)) return;

  const controller = new AbortController();
  const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'sync') return;
    for (const key of PROMPT_KEYS) if (changes[key]) settings[key] = changes[key].newValue;
    if (resolveAutoEnterTheater(settings[AUTO_THEATER_STORAGE_KEY]) || !shouldOfferVideoActivator(settings)) controller.abort();
  };
  chrome.storage.onChanged.addListener(onChanged);
  try {
    const answer = await openDialog(() => ({
      title: t('videoActivatorPromptTitle'),
      content: t('videoActivatorPromptDescription'),
      actions: { type: 'choice', initialFocus: 'cancel' },
      mount: options.mount,
      signal: controller.signal
    }));
    const latest = await chrome.storage.sync.get(PROMPT_KEYS);
    if (!current() || controller.signal.aborted || resolveAutoEnterTheater(latest[AUTO_THEATER_STORAGE_KEY]) || !shouldOfferVideoActivator(latest)) return;
    // A single boolean remembers both answers; declining never changes the launcher preference.
    await chrome.storage.sync.set({
      [VIDEO_ACTIVATOR_PROMPT_ANSWER_STORAGE_KEY]: answer,
      ...(answer ? { [VIDEO_ACTIVATOR_STORAGE_KEY]: true } : {})
    });
  } finally {
    chrome.storage.onChanged.removeListener(onChanged);
  }
}
