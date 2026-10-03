import { sanitizeContentTitle, vimeoPageTitle } from '../../media-features/content-title';
import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';

export function vimeoIntegrationEnabled(): boolean {
  return mediaProviderIntegrationEnabled('vimeo');
}

function readVimeoDomTitle(): string | null {
  const og = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
  const heading = document.querySelector('h1')?.textContent;
  return vimeoPageTitle(og, heading, document.title);
}

export function readVimeoSnapshot(): Record<string, unknown> | null {
  try {
    const win = window as Window & {
      playerConfig?: Record<string, unknown>;
      _player_config?: Record<string, unknown>;
    };
    const config = (win.playerConfig || win._player_config || null) as Record<string, any> | null;
    const domTitle = readVimeoDomTitle();
    if (!config) return domTitle ? { title: domTitle } : null;
    const chapters = Array.isArray(config?.embed?.chapters) ? config.embed.chapters : [];
    const normalizedChapters = chapters.slice(0, 80).map((chapter: any) => ({
      startTime: Number(chapter.startTime ?? chapter.timecode ?? chapter.start),
      title: String(chapter.title || chapter.name || '').slice(0, 120)
    })).filter((chapter: { startTime: number; title: string }) => Number.isFinite(chapter.startTime) && chapter.title);

    const thumb = config?.request?.thumb_preview;
    const thumbUrl = typeof thumb?.url === 'string' ? thumb.url.slice(0, 2000) : '';
    const thumbPreview = thumbUrl
      ? {
          url: thumbUrl,
          width: Number(thumb.width),
          height: Number(thumb.height),
          frameWidth: Number(thumb.frame_width),
          frameHeight: Number(thumb.frame_height),
          columns: Number(thumb.columns),
          frames: Number(thumb.frames)
        }
      : undefined;

    const title = sanitizeContentTitle(config?.video?.title) || sanitizeContentTitle(config?.video?.name) || domTitle;
    if (normalizedChapters.length === 0 && !thumbPreview && !title) return null;
    const videoIdRaw = config?.video?.id ?? config?.video?.clip_id;
    return {
      videoId: videoIdRaw != null ? String(videoIdRaw).slice(0, 32) : undefined,
      ...(title ? { title } : {}),
      duration: Number(config?.video?.duration || config?.duration || config?.embed?.duration) || undefined,
      chapters: normalizedChapters,
      thumbPreview
    };
  } catch {
    return null;
  }
}
