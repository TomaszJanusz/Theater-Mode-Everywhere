import { AUTO_THEATER_STORAGE_KEY, resolveAutoEnterTheater } from '../src/auto-theater-preferences';
import { createModal, type ModalOptions } from '../src/dialog';
import { languageRuntime } from '../src/i18n-runtime';
import type { ProviderSettingsStore, SettingsProvider } from '../src/providers/settings';
import { BYLINE_STORAGE_KEY, providerAutoEnabled, providerBylineEnabled, resolveBylineEnabled } from '../src/providers/settings-values';

import { settingsMessage as t } from './provider-settings-copy';

/**
 * Service settings that a global switch can override: while the switch is off, the service's own switch shows off and
 * unavailable, with a note naming where to turn the global one on. The service's saved choice is kept.
 */
interface GlobalGate {
  key: string;
  resolve: (value: unknown) => boolean;
  /** The service's effective preference, the same rule the runtime applies. */
  enabled: (global: boolean, settings: unknown, provider: string) => boolean;
  note: string;
}
const GLOBAL_GATES: Record<string, GlobalGate> = {
  autoTheater: { key: AUTO_THEATER_STORAGE_KEY, resolve: resolveAutoEnterTheater, enabled: providerAutoEnabled, note: 'providerAutoTheaterGlobalOff' },
  showAuthor: { key: BYLINE_STORAGE_KEY, resolve: resolveBylineEnabled, enabled: providerBylineEnabled, note: 'providerShowAuthorGlobalOff' }
};
const GATE_KEYS = Object.values(GLOBAL_GATES).map(gate => gate.key);

/** Descriptor-driven content in the existing accessible page-dialog shell. */
export function openProviderSettings(
  provider: SettingsProvider & { name: string }, store: ProviderSettingsStore,
  options: Pick<ModalOptions, 'signal' | 'mount' | 'returnFocus'> = {}
) {
  // The global switches by storage key; a key changed after opening is not overwritten by the initial read.
  const globals: Record<string, unknown> = {};
  const changedGlobals = new Set<string>();
  const content = document.createElement('div');
  content.className = 'provider-settings';
  const rows = provider.settings.map(setting => {
    const row = document.createElement('label');
    row.className = 'provider-setting';
    const copy = document.createElement('span');
    const label = document.createElement('span');
    label.className = 'provider-setting-label';
    label.id = `provider-setting-${provider.id}-${setting.id}-label`;
    const description = document.createElement('span');
    description.className = 'provider-setting-description';
    description.id = `${label.id}-description`;
    const unavailable = document.createElement('span');
    unavailable.className = 'provider-setting-unavailable';
    unavailable.id = `${label.id}-unavailable`;
    unavailable.hidden = true;
    copy.append(label, description, unavailable);
    const control = document.createElement('span');
    control.className = 'toggle-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.role = 'switch';
    input.setAttribute('aria-labelledby', label.id);
    input.setAttribute('aria-describedby', description.id);
    const slider = document.createElement('span');
    slider.className = 'toggle-slider';
    slider.setAttribute('aria-hidden', 'true');
    control.append(input, slider);
    row.append(copy, control);
    content.append(row);
    input.addEventListener('change', () => {
      void store.set(provider.id, setting.id, input.checked).then(() => {
        if (modal.isOpen) error.hidden = true;
      }, () => {
        if (modal.isOpen) error.hidden = false;
      }).finally(() => { if (modal.isOpen) render(); });
    });
    return { setting, label, description, input, row, unavailable };
  });
  const error = document.createElement('p');
  error.className = 'provider-settings-error';
  error.role = 'alert';
  error.hidden = true;
  content.append(error);
  const copy = () => ({ title: t('providerSettingsTitle', provider.name), closeLabel: t('dialogClose'), content });
  const modal = createModal({ ...copy(), ...options });
  modal.dialog.classList.add('te-dialog-provider-settings');
  modal.dialog.setAttribute('aria-describedby', modal.dialog.querySelector('.te-dialog-body')!.id);
  function render() {
    for (const { setting, label, description, input, row, unavailable } of rows) {
      label.textContent = t(setting.label);
      description.textContent = t(setting.description);
      const gate = GLOBAL_GATES[setting.id] as GlobalGate | undefined;
      const global = gate ? gate.resolve(globals[gate.key]) : true;
      input.checked = gate ? gate.enabled(global, store.values, provider.id) : store.values[provider.id][setting.id];
      input.disabled = !store.loaded || !global;
      row.classList.toggle('is-unavailable', !global);
      unavailable.hidden = global;
      unavailable.textContent = gate ? t(gate.note) : '';
      input.setAttribute('aria-describedby', [description.id, ...(unavailable.hidden ? [] : [unavailable.id])].join(' '));
    }
    error.textContent = t('rteSaveError');
  }
  render();
  const onGlobal = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    const changed = GATE_KEYS.filter(key => key in changes);
    if (!modal.isOpen || area !== 'sync' || !changed.length) return;
    for (const key of changed) { changedGlobals.add(key); globals[key] = changes[key].newValue; }
    render();
  };
  chrome.storage.onChanged.addListener(onGlobal);
  void chrome.storage.sync.get(GATE_KEYS).then(data => {
    if (!modal.isOpen) return;
    for (const key of GATE_KEYS) if (!changedGlobals.has(key)) globals[key] = data[key];
    render();
  }).catch(() => { if (modal.isOpen) error.hidden = false; });
  const stopStorage = store.subscribe(render);
  const stopLanguage = languageRuntime.subscribe(() => {
    const focused = document.activeElement;
    render(); modal.update(copy());
    if (focused instanceof HTMLElement && content.contains(focused)) focused.focus();
    modal.dialog.setAttribute('aria-describedby', modal.dialog.querySelector('.te-dialog-body')!.id); });
  void store.ready.catch(() => { if (modal.isOpen) error.hidden = false; });
  void modal.closed.then(() => { stopStorage(); stopLanguage(); chrome.storage.onChanged.removeListener(onGlobal); });
  return modal;
}
