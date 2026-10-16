/** Stored choices are shared by every extension surface. Unknown values follow the OS. */
export const HIGH_CONTRAST_STORAGE_KEY = 'highContrast';
export const REDUCE_TRANSPARENCY_STORAGE_KEY = 'reduceTransparency';
export const REDUCE_MOTION_STORAGE_KEY = 'reduceMotion';
export const APPEARANCE_CHOICES = ['auto', 'on', 'off'] as const;
export type AppearancePreference = typeof APPEARANCE_CHOICES[number];
export const DEFAULT_APPEARANCE_PREFERENCE: AppearancePreference = 'auto';

function resolvePreference(value: unknown): AppearancePreference {
  return value === 'on' || value === 'off' || value === 'auto' ? value : DEFAULT_APPEARANCE_PREFERENCE;
}
export const resolveHighContrast = resolvePreference;
export const resolveReduceTransparency = resolvePreference;
export const resolveReduceMotion = resolvePreference;

/** Unsupported media queries never match; an absent matchMedia is equivalent. */
export function effectiveAppearanceMode(preference: AppearancePreference, systemPrefers = false): boolean {
  return preference === 'on' || (preference === 'auto' && systemPrefers);
}
