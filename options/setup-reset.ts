import { openDialog, type OpenDialogOptions } from '../src/dialog';
import { SETUP_STATE_KEY } from '../src/first-run-setup';
import { t } from '../src/i18n';
import { languageRuntime } from '../src/i18n-runtime';

import { defaultSetupAnswers, resetSettingsPatch, type ResetPatch, type SetupAnswers } from './setup-answers';
import { element } from './setup-steps';
import { setupMessage as copy } from './setup-wizard-copy';

/** The storage a reset touches; Settings passes `chromeResetStorage()`, stories and tests a fake. */
export interface ResetStorage {
  readSync(): Promise<Record<string, unknown>>;
  /** Applies the sync changes, then forgets this device's setup state. */
  reset(patch: ResetPatch): Promise<void>;
}

export function chromeResetStorage(): ResetStorage {
  return {
    readSync: () => chrome.storage.sync.get(null),
    async reset({ remove, set }) {
      if (remove.length) await chrome.storage.sync.remove(remove);
      if (Object.keys(set).length) await chrome.storage.sync.set(set);
      await chrome.storage.local.remove(SETUP_STATE_KEY);
    }
  };
}

export interface SetupActionsOptions {
  storage: ResetStorage;
  /** `SetupRoute.start`: the saved settings when `initial` is omitted. */
  start(initial?: SetupAnswers): void;
  /** Tells open tabs that settings changed, as the Settings controls do. */
  notify?(): Promise<void>;
  /** Where the confirmation mounts; the page body when omitted. */
  mount?: OpenDialogOptions['mount'];
}

/** Asks before a reset; resolves with the reset's scope, or `undefined` when cancelled. */
async function confirmReset(doc: Document, signal: AbortSignal, mount: OpenDialogOptions['mount']): Promise<{ everything: boolean } | undefined> {
  const content = element(doc, 'div', 'setup-reset-confirm');
  const description = element(doc, 'p');
  const also = element(doc, 'label', 'setup-reset-also');
  const checkbox = element(doc, 'input');
  checkbox.type = 'checkbox';
  const label = element(doc, 'span');
  also.append(checkbox, label);
  content.append(description, also);
  // Rebuilt on a language change; the same nodes keep the checkbox state.
  const confirmed = await openDialog(() => {
    description.textContent = copy('setupResetDescription');
    label.textContent = copy('setupResetAlso');
    return {
      title: copy('setupResetTitle'), content, signal, mount,
      actions: { type: 'choice', trueLabel: copy('setupResetConfirm'), falseLabel: copy('setupResetCancel'), initialFocus: 'cancel' }
    };
  });
  return confirmed ? { everything: checkbox.checked } : undefined;
}

/**
 * The Settings card that runs the setup again or resets every setting first. A reset asks, writes only what
 * differs from a fresh install, forgets this device's setup state, and then opens the setup at its defaults.
 */
export function mountSetupActions(root: HTMLElement, options: SetupActionsOptions): () => void {
  const doc = root.ownerDocument;
  let disposed = false;
  let busy = false;
  // Leaving Settings closes an open confirmation as a cancel.
  const lifetime = new AbortController();
  const title = element(doc, 'h2');
  title.id = 'setup-actions-title';
  const description = element(doc, 'p');
  const row = element(doc, 'div', 'setup-actions-row');
  // The About tab's own button style: neither action is the page's primary one.
  const again = element(doc, 'button', 'te-dialog-btn about-privacy-btn');
  const reset = element(doc, 'button', 'te-dialog-btn about-privacy-btn');
  for (const button of [again, reset]) button.type = 'button';
  row.append(again, reset);
  const error = element(doc, 'p', 'setup-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  root.setAttribute('aria-labelledby', title.id);
  root.replaceChildren(title, description, row, error);

  function localize(): void {
    title.textContent = copy('setupAgainTitle');
    description.textContent = copy('setupAgainDescription');
    again.textContent = copy('setupRunAgain');
    reset.textContent = t('resetToDefaults');
    error.textContent = t('errorSavingSettings');
  }

  async function resetSettings(): Promise<void> {
    if (busy) return;
    busy = true;
    error.hidden = true;
    try {
      const scope = await confirmReset(doc, lifetime.signal, options.mount);
      if (!scope || disposed) return;
      await options.storage.reset(resetSettingsPatch(await options.storage.readSync(), scope.everything));
      await options.notify?.();
      if (!disposed) options.start(defaultSetupAnswers());
    } catch (reason) {
      console.error('[Theater Everywhere] Could not reset the settings:', reason);
      if (!disposed) error.hidden = false;
    } finally {
      busy = false;
    }
  }

  again.addEventListener('click', () => { if (!busy) options.start(); });
  reset.addEventListener('click', () => { void resetSettings(); });
  const stopLanguage = languageRuntime.subscribe(localize);
  localize();
  return () => {
    if (disposed) return;
    disposed = true;
    lifetime.abort();
    stopLanguage();
    root.replaceChildren();
  };
}
