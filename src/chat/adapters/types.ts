export type ForcedTheme = 'light' | 'dark';

/** Owns only service-specific presentation. False means native fallback. */
export interface ChatThemeAdapter {
  apply(theme: ForcedTheme): boolean;
  restore(): void;
}
