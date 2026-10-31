import { PROVIDER_AUTO_DEFAULT } from './catalog';

export const settingsRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function settingBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Shared by the provider modal and auto-entry. Domain policy and player qualification remain separate gates. */
export function providerAutoEnabled(global: boolean, settings: unknown, provider: string): boolean {
  return global && settingBoolean(settingsRecord(settingsRecord(settings)[provider]).autoTheater, PROVIDER_AUTO_DEFAULT);
}
