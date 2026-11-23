import { PROVIDER_AUTO_DEFAULT } from './catalog';

export const settingsRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function settingBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** A service's own AutoTheater switch. Auto-entry checks it beside the global preference, which it never replaces. */
export function serviceAutoEnabled(settings: unknown, provider: string): boolean {
  return settingBoolean(settingsRecord(settingsRecord(settings)[provider]).autoTheater, PROVIDER_AUTO_DEFAULT);
}

/** Effective preference, shared by the provider modal and auto-entry. Domain policy and player qualification remain separate gates. */
export function providerAutoEnabled(global: boolean, settings: unknown, provider: string): boolean {
  return global && serviceAutoEnabled(settings, provider);
}

/**
 * Settings > Appearance > "Channel beside the title": the author byline on every service, on by default. Off wins over
 * each service's own "Show the channel" (`showAuthor`); on defers to it. Settings and the byline view
 * (`author-byline-setting.ts`) both read it here, so they agree on a missing or malformed value.
 */
export const BYLINE_STORAGE_KEY = 'authorByline';
export const DEFAULT_AUTHOR_BYLINE = true;

export function resolveBylineEnabled(value: unknown): boolean {
  return settingBoolean(value, DEFAULT_AUTHOR_BYLINE);
}

/**
 * Effective byline preference, shared by the provider modal and the byline view (and SOOP's title, which drops the
 * streamer while the byline names them). `settings` are resolved provider settings, so `showAuthor` is always set.
 */
export function providerBylineEnabled(global: boolean, settings: unknown, provider: string): boolean {
  return global && settingsRecord(settingsRecord(settings)[provider]).showAuthor === true;
}
