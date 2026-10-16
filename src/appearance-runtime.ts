import {
  HIGH_CONTRAST_STORAGE_KEY, REDUCE_TRANSPARENCY_STORAGE_KEY, REDUCE_MOTION_STORAGE_KEY,
  resolveHighContrast, resolveReduceTransparency, resolveReduceMotion, effectiveAppearanceMode
} from './appearance-preferences';

export const CONTRAST_QUERY = '(prefers-contrast: more)';
export const TRANSPARENCY_QUERY = '(prefers-reduced-transparency: reduce)';
export const MOTION_QUERY = '(prefers-reduced-motion: reduce)';
/** Mirrors `data-motion` onto the host page, where extension-owned page styles read it. */
export const PAGE_MOTION_ATTRIBUTE = 'data-theater-everywhere-motion';

export interface AppearanceModes { contrast: boolean; transparency: boolean; motion: boolean }

export function applyAppearanceModes(target: HTMLElement, modes: AppearanceModes): void {
  target.dataset.contrast = modes.contrast ? 'high' : 'normal';
  target.dataset.transparency = modes.transparency ? 'reduced' : 'normal';
  target.dataset.motion = modes.motion ? 'reduced' : 'normal';
}

/**
 * Whether motion is reduced for a document: the resolved Auto/On/Off preference when an
 * extension root owns it, otherwise the system query. Animation timing in script must
 * agree with the stylesheet, which keys off the same marker.
 */
export function isMotionReduced(doc: Document = document): boolean {
  const root = doc.documentElement;
  const marker = root.dataset.motion ?? root.getAttribute(PAGE_MOTION_ATTRIBUTE);
  if (marker) return marker === 'reduced';
  return doc.defaultView?.matchMedia?.(MOTION_QUERY).matches ?? false;
}

/**
 * One owner per root. Subscribe before reading so a late read cannot undo a change.
 * `onChange` receives every resolved state for roots that also mirror it elsewhere.
 */
export function observeAppearance(target: HTMLElement, onChange?: (modes: AppearanceModes | null) => void): () => void {
  const contrast = window.matchMedia?.(CONTRAST_QUERY);
  const transparency = window.matchMedia?.(TRANSPARENCY_QUERY);
  const motion = window.matchMedia?.(MOTION_QUERY);
  let highContrast = resolveHighContrast(undefined);
  let reduceTransparency = resolveReduceTransparency(undefined);
  let reduceMotion = resolveReduceMotion(undefined);
  let disposed = false;
  const changedKeys = new Set<string>();
  const render = () => {
    if (disposed) return;
    const modes = {
      contrast: effectiveAppearanceMode(highContrast, contrast?.matches),
      transparency: effectiveAppearanceMode(reduceTransparency, transparency?.matches),
      motion: effectiveAppearanceMode(reduceMotion, motion?.matches)
    };
    applyAppearanceModes(target, modes);
    onChange?.(modes);
  };
  const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'sync' || disposed
      || !(HIGH_CONTRAST_STORAGE_KEY in changes || REDUCE_TRANSPARENCY_STORAGE_KEY in changes
        || REDUCE_MOTION_STORAGE_KEY in changes)) return;
    if (HIGH_CONTRAST_STORAGE_KEY in changes) {
      changedKeys.add(HIGH_CONTRAST_STORAGE_KEY);
      highContrast = resolveHighContrast(changes[HIGH_CONTRAST_STORAGE_KEY].newValue);
    }
    if (REDUCE_TRANSPARENCY_STORAGE_KEY in changes) {
      changedKeys.add(REDUCE_TRANSPARENCY_STORAGE_KEY);
      reduceTransparency = resolveReduceTransparency(changes[REDUCE_TRANSPARENCY_STORAGE_KEY].newValue);
    }
    if (REDUCE_MOTION_STORAGE_KEY in changes) {
      changedKeys.add(REDUCE_MOTION_STORAGE_KEY);
      reduceMotion = resolveReduceMotion(changes[REDUCE_MOTION_STORAGE_KEY].newValue);
    }
    render();
  };
  const storage = typeof chrome === 'undefined' ? undefined : chrome.storage;
  contrast?.addEventListener('change', render);
  transparency?.addEventListener('change', render);
  motion?.addEventListener('change', render);
  storage?.onChanged?.addListener(onStorage);
  render();
  try {
    storage?.sync.get([HIGH_CONTRAST_STORAGE_KEY, REDUCE_TRANSPARENCY_STORAGE_KEY, REDUCE_MOTION_STORAGE_KEY], data => {
      if (disposed || chrome.runtime.lastError) return;
      if (!changedKeys.has(HIGH_CONTRAST_STORAGE_KEY)) highContrast = resolveHighContrast(data[HIGH_CONTRAST_STORAGE_KEY]);
      if (!changedKeys.has(REDUCE_TRANSPARENCY_STORAGE_KEY)) reduceTransparency = resolveReduceTransparency(data[REDUCE_TRANSPARENCY_STORAGE_KEY]);
      if (!changedKeys.has(REDUCE_MOTION_STORAGE_KEY)) reduceMotion = resolveReduceMotion(data[REDUCE_MOTION_STORAGE_KEY]);
      render();
    });
  } catch { /* An invalidated extension retains the resolved system appearance. */ }
  return () => {
    if (disposed) return;
    disposed = true;
    contrast?.removeEventListener('change', render);
    transparency?.removeEventListener('change', render);
    motion?.removeEventListener('change', render);
    storage?.onChanged?.removeListener?.(onStorage);
    delete target.dataset.contrast;
    delete target.dataset.transparency;
    delete target.dataset.motion;
    onChange?.(null);
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
