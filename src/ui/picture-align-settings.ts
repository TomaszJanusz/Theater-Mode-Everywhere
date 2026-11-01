/** The stored layout choice: where the picture sits in theater mode, and whether Raised waits for subtitles. */
export const PICTURE_ALIGN_STORAGE_KEY = 'pictureAlign';
export const PICTURE_ALIGNS = ['center', 'top'] as const;
export type PictureAlign = (typeof PICTURE_ALIGNS)[number];
export const DEFAULT_PICTURE_ALIGN: PictureAlign = 'top';

export const RAISE_ONLY_WITH_SUBTITLES_STORAGE_KEY = 'raiseOnlyWithSubtitles';
export const DEFAULT_RAISE_ONLY_WITH_SUBTITLES = true;

export function resolvePictureAlign(value: unknown): PictureAlign {
  return typeof value === 'string' && PICTURE_ALIGNS.includes(value as PictureAlign)
    ? value as PictureAlign
    : DEFAULT_PICTURE_ALIGN;
}

/** Only a saved boolean overrides the default, so an explicit choice always wins. */
export function resolveRaiseOnlyWithSubtitles(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_RAISE_ONLY_WITH_SUBTITLES;
}
