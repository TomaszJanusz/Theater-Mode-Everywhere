export const VIDEO_ACTIVATOR_STORAGE_KEY = 'videoActivator';
export const DEFAULT_VIDEO_ACTIVATOR = true;

/** Only an explicit `false` turns the activator off, so missing or invalid storage keeps the default. */
export function resolveVideoActivator(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_VIDEO_ACTIVATOR;
}
