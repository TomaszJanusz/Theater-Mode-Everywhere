/** "Pin controls": the stored choice to keep the playback controls visible in theater mode. */
export const KEEP_CONTROLS_VISIBLE_STORAGE_KEY = 'keepControlsVisible';

export function resolveKeepControlsVisible(value: unknown): boolean {
  return value === true;
}
