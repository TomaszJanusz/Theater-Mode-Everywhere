import manifest from '../manifest.json';
import { FEATURE_HIGHLIGHTS_LOCAL_KEYS } from './feature-highlights';

export function installedVersion(): string {
  return typeof chrome !== 'undefined' && chrome.runtime?.getManifest
    ? chrome.runtime.getManifest().version : manifest.version;
}

export async function acknowledgeFeatureHighlights(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await requestFeatureHighlights('acknowledge');
}

export async function setFeatureHighlightsHidden(hidden: boolean): Promise<void> {
  await requestFeatureHighlights(hidden ? 'hide' : 'restore');
}

/** Writes and lazy initialization share the background queue, even across frames and Settings tabs. */
async function requestFeatureHighlights(operation: 'read' | 'acknowledge' | 'hide' | 'restore'): Promise<Record<string, unknown>> {
  const result: unknown = await chrome.runtime.sendMessage({ action: 'feature-highlights', operation });
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Feature highlights storage request failed');
  }
  return result as Record<string, unknown>;
}

/** A failed optional local read must not discard otherwise valid synced player settings. */
export async function readFeatureHighlightsLocal(): Promise<Record<string, unknown>> {
  const missing = Object.fromEntries(FEATURE_HIGHLIGHTS_LOCAL_KEYS.map(key => [key, undefined]));
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      return { ...missing, ...await requestFeatureHighlights('read') };
    }
  } catch (error) {
    console.warn('[Theater Everywhere] Could not read feature highlights:', error);
  }
  return missing;
}
