import {
  APPEARANCE_CHOICES, HIGH_CONTRAST_STORAGE_KEY, REDUCE_TRANSPARENCY_STORAGE_KEY, REDUCE_MOTION_STORAGE_KEY,
  resolveHighContrast, resolveReduceTransparency, resolveReduceMotion
} from '../src/appearance-preferences';
import { languageRuntime } from '../src/i18n-runtime';
import { t } from '../src/i18n';
import { createCombobox } from './combobox';

/** Settings owns persistence; the shared combobox owns rendering and keyboard behavior. */
export function setupAppearanceChoices(): () => void {
  let disposed = false;
  const bindings = [
    { key: HIGH_CONTRAST_STORAGE_KEY, resolve: resolveHighContrast },
    { key: REDUCE_TRANSPARENCY_STORAGE_KEY, resolve: resolveReduceTransparency },
    { key: REDUCE_MOTION_STORAGE_KEY, resolve: resolveReduceMotion }
  ].map(binding => ({
    ...binding, value: binding.resolve(undefined), changed: false,
    menu: createCombobox(document.querySelector<HTMLButtonElement>(`#${binding.key}-combobox`)!, APPEARANCE_CHOICES.map(value => ({
      value,
      label: () => t(value === 'auto' ? 'appearanceAuto' : value === 'on' ? 'controlsVisibilityOn' : 'controlsVisibilityOff')
    })), async value => {
      try {
        await chrome.storage.sync.set({ [binding.key]: value });
      } catch (error) {
        console.error('Error saving appearance:', error);
      }
    })
  }));
  const render = () => {
    if (!disposed) for (const binding of bindings) binding.menu.render(binding.value);
  };
  const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (disposed || area !== 'sync') return;
    for (const binding of bindings) {
      if (binding.key in changes) {
        binding.changed = true;
        binding.value = binding.resolve(changes[binding.key].newValue);
        binding.menu.render(binding.value);
      }
    }
  };
  chrome.storage.onChanged.addListener(onStorage);
  const stopLanguage = languageRuntime.subscribe(render);
  render();
  chrome.storage.sync.get(bindings.map(binding => binding.key), data => {
    if (disposed || chrome.runtime.lastError) return;
    for (const binding of bindings) if (!binding.changed) binding.value = binding.resolve(data[binding.key]);
    render();
  });
  return () => {
    if (disposed) return;
    disposed = true;
    chrome.storage.onChanged.removeListener(onStorage);
    stopLanguage();
    for (const binding of bindings) binding.menu.destroy();
  };
}
