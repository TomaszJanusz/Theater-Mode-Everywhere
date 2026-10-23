/** Settings tabs a caller may land on; their ids are the Options panel ids (`options.html#shortcuts`). */
export const OPTIONS_SECTIONS = ['shortcuts'] as const;
export type OptionsSection = (typeof OPTIONS_SECTIONS)[number];

export interface OpenOptionsRequest { action: 'open-options-page'; section?: OptionsSection }

/** Only the manifest options page may be opened, optionally at a known tab; callers cannot supply a URL or hash. */
export function isOpenOptionsRequest(value: unknown): value is OpenOptionsRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { action, section, ...rest } = value as Record<string, unknown>;
  return action === 'open-options-page' && Object.keys(rest).length === 0
    && (!('section' in value) || (OPTIONS_SECTIONS as readonly unknown[]).includes(section));
}

/** Asks the background to open Settings; the player can render where the extension runtime is unavailable. */
export function requestOptionsPage(section?: OptionsSection): void {
  const request: OpenOptionsRequest = section ? { action: 'open-options-page', section } : { action: 'open-options-page' };
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      // Reading lastError marks a closed or missing background as handled.
      chrome.runtime.sendMessage(request, () => chrome.runtime.lastError);
    }
  } catch {
    // Extension context invalidated or absent (fixtures, a reloaded extension).
  }
}
