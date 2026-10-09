export const VOLUME_BOOST_STORAGE_KEY = 'volumeBoostEnabled';
export const DEFAULT_VOLUME_BOOST_ENABLED = false;

export function resolveVolumeBoostEnabled(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_VOLUME_BOOST_ENABLED;
}
