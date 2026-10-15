import manifest from '../manifest.json';
import { resolveFeatureHighlights, acknowledgeGeneration, SEEN_THROUGH_STORAGE_KEY } from './feature-highlights';

export function installedVersion(): string {
  return typeof chrome !== 'undefined' && chrome.runtime?.getManifest
    ? chrome.runtime.getManifest().version : manifest.version;
}

export async function acknowledgeFeatureHighlights(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  const local = await chrome.storage.local.get(SEEN_THROUGH_STORAGE_KEY);
  const state = resolveFeatureHighlights(installedVersion(), {}, local);
  await chrome.storage.local.set({ [SEEN_THROUGH_STORAGE_KEY]: acknowledgeGeneration(state) });
}

/** A failed optional local read must not discard otherwise valid synced player settings. */
export async function readFeatureHighlightsLocal(): Promise<Record<string, unknown>> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      return await chrome.storage.local.get(SEEN_THROUGH_STORAGE_KEY);
    }
  } catch (error) {
    console.warn('[Theater Everywhere] Could not read feature highlights:', error);
  }
  return {};
}
