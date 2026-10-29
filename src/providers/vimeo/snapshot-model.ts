export type VimeoThumbPreview = {
  url: string;
  width: number;
  height: number;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  frames: number;
};

export type VimeoPlayerSnapshot = {
  duration?: number;
  videoId?: string;
  title?: string;
  chapters?: Array<{ startTime: number; title: string }>;
  thumbPreview?: VimeoThumbPreview;
};

const text = (value: unknown, max: number): string | undefined => (typeof value === 'string' && value ? value.slice(0, max) : undefined);
const record = (value: unknown): Record<string, unknown> | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null);
const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/**
 * The MAIN-world probe answers across the world boundary as plain data; the adapter validates it here
 * instead of trusting the shape. The sprite URL is still checked against Vimeo's CDN when parsed.
 */
export function normalizeVimeoSnapshot(value: unknown): VimeoPlayerSnapshot | null {
  const raw = record(value);
  if (!raw) return null;
  const chapters = (Array.isArray(raw.chapters) ? raw.chapters : []).slice(0, 80).flatMap(item => {
    const chapter = record(item);
    const startTime = finite(chapter?.startTime);
    const title = text(chapter?.title, 120);
    return startTime !== undefined && title ? [{ startTime, title }] : [];
  });
  const thumb = record(raw.thumbPreview);
  const url = text(thumb?.url, 2000);
  const sheet = thumb && url ? {
    width: finite(thumb.width), height: finite(thumb.height), frameWidth: finite(thumb.frameWidth),
    frameHeight: finite(thumb.frameHeight), columns: finite(thumb.columns), frames: finite(thumb.frames)
  } : null;
  const thumbPreview = url && sheet && Object.values(sheet).every(item => item !== undefined) ? { url, ...sheet } as VimeoThumbPreview : undefined;
  return {
    videoId: text(raw.videoId, 32),
    title: text(raw.title, 300),
    duration: finite(raw.duration),
    chapters,
    thumbPreview
  };
}
