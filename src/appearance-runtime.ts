import {
  HIGH_CONTRAST_STORAGE_KEY, REDUCE_TRANSPARENCY_STORAGE_KEY,
  resolveHighContrast, resolveReduceTransparency, effectiveAppearanceMode
} from './appearance-preferences';

export const CONTRAST_QUERY = '(prefers-contrast: more)';
export const TRANSPARENCY_QUERY = '(prefers-reduced-transparency: reduce)';

export function applyAppearanceModes(target: HTMLElement, contrast: boolean, transparency: boolean): void {
  target.dataset.contrast = contrast ? 'high' : 'normal';
  target.dataset.transparency = transparency ? 'reduced' : 'normal';
}

/** One owner per root. Subscribe before reading so a late read cannot undo a change. */
export function observeAppearance(target: HTMLElement): () => void {
  const contrast = window.matchMedia?.(CONTRAST_QUERY);
  const transparency = window.matchMedia?.(TRANSPARENCY_QUERY);
  let highContrast = resolveHighContrast(undefined);
  let reduceTransparency = resolveReduceTransparency(undefined);
  let disposed = false;
  const changedKeys = new Set<string>();
  const render = () => {
    if (disposed) return;
    applyAppearanceModes(target,
      effectiveAppearanceMode(highContrast, contrast?.matches),
      effectiveAppearanceMode(reduceTransparency, transparency?.matches));
  };
  const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'sync' || disposed
      || !(HIGH_CONTRAST_STORAGE_KEY in changes || REDUCE_TRANSPARENCY_STORAGE_KEY in changes)) return;
    if (HIGH_CONTRAST_STORAGE_KEY in changes) {
      changedKeys.add(HIGH_CONTRAST_STORAGE_KEY);
      highContrast = resolveHighContrast(changes[HIGH_CONTRAST_STORAGE_KEY].newValue);
    }
    if (REDUCE_TRANSPARENCY_STORAGE_KEY in changes) {
      changedKeys.add(REDUCE_TRANSPARENCY_STORAGE_KEY);
      reduceTransparency = resolveReduceTransparency(changes[REDUCE_TRANSPARENCY_STORAGE_KEY].newValue);
    }
    render();
  };
  const storage = typeof chrome === 'undefined' ? undefined : chrome.storage;
  contrast?.addEventListener('change', render);
  transparency?.addEventListener('change', render);
  storage?.onChanged?.addListener(onStorage);
  render();
  try {
    storage?.sync.get([HIGH_CONTRAST_STORAGE_KEY, REDUCE_TRANSPARENCY_STORAGE_KEY], data => {
      if (disposed || chrome.runtime.lastError) return;
      if (!changedKeys.has(HIGH_CONTRAST_STORAGE_KEY)) highContrast = resolveHighContrast(data[HIGH_CONTRAST_STORAGE_KEY]);
      if (!changedKeys.has(REDUCE_TRANSPARENCY_STORAGE_KEY)) reduceTransparency = resolveReduceTransparency(data[REDUCE_TRANSPARENCY_STORAGE_KEY]);
      render();
    });
  } catch { /* An invalidated extension retains the resolved system appearance. */ }
  return () => {
    if (disposed) return;
    disposed = true;
    contrast?.removeEventListener('change', render);
    transparency?.removeEventListener('change', render);
    storage?.onChanged?.removeListener?.(onStorage);
    delete target.dataset.contrast;
    delete target.dataset.transparency;
  };
}

export function observeDocumentAppearance(): void {
  const dispose = observeAppearance(document.documentElement);
  window.addEventListener('pagehide', () => {
    dispose();
    // Register after pagehide: the initial pageshow must not consume this listener.
    window.addEventListener('pageshow', event => { if (event.persisted) observeDocumentAppearance(); }, { once: true });
  }, { once: true });
}
