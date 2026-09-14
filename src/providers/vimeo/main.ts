export function vimeoIntegrationEnabled(): boolean {
  return !document.documentElement.hasAttribute('data-te-vimeo-integration-off');
}

export function readVimeoSnapshot(): Record<string, unknown> | null {
  try {
    const win = window as Window & {
      playerConfig?: Record<string, unknown>;
      _player_config?: Record<string, unknown>;
    };
    const config = (win.playerConfig || win._player_config || null) as Record<string, any> | null;
    if (!config) return null;
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

    if (normalizedChapters.length === 0 && !thumbPreview) return null;
    const videoIdRaw = config?.video?.id ?? config?.video?.clip_id;
    return {
      videoId: videoIdRaw != null ? String(videoIdRaw).slice(0, 32) : undefined,
      duration: Number(config?.video?.duration || config?.duration || config?.embed?.duration) || undefined,
      chapters: normalizedChapters,
      thumbPreview
    };
  } catch {
    return null;
  }
}
