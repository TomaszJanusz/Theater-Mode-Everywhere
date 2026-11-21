import { sanitizeContentTitle, type ContentAuthor } from '../../media-features/content-title';

import { vimeoWatchPageId } from './watch-playback';

/** Owner portraits come from Vimeo's image CDN only. */
export const VIMEO_AVATAR_HOSTS = ['i.vimeocdn.com'];

/** The owner of one clip: `clipId` is the clip it was read for, so a later page cannot inherit it. */
export type VimeoOwner = { clipId: string; author: ContentAuthor };

type Fields = Record<string, unknown>;
const fields = (value: unknown): Fields | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Fields : null;
const text = (value: unknown, max = 2000): string | null => typeof value === 'string' && value && value.length <= max ? value : null;
const clipOf = (url: string): string | null => {
  try { return vimeoWatchPageId(new URL(url)); } catch { return null; }
};
const id = (value: unknown): string | null => {
  const raw = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : text(value, 40);
  return raw && /^\d{1,20}$/.test(raw) ? raw : null;
};

function owner(clipId: string, raw: { id: unknown; name: unknown; url: unknown; avatarUrl: unknown }): VimeoOwner | null {
  const author = id(raw.id);
  const name = sanitizeContentTitle(raw.name)?.slice(0, 80);
  return author && name ? { clipId, author: { id: author, name, url: text(raw.url), avatarUrl: text(raw.avatarUrl), verified: false, stat: null } } : null;
}

/** The JSON-LD VideoObject for `clipId`; vimeo.com keeps the first clip's after client navigation, so it must match. */
function linkedDataOwner(doc: Document, clipId: string): VimeoOwner | null {
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const source = script.textContent ?? '';
    if (source.length > 200_000) continue;
    let data: unknown;
    try { data = JSON.parse(source); } catch { continue; }
    const graph = fields(data)?.['@graph'];
    for (const item of (Array.isArray(graph) ? graph : [data]).slice(0, 20)) {
      const video = fields(item);
      const url = text(video?.url);
      if (video?.['@type'] !== 'VideoObject' || !url || clipOf(url) !== clipId) continue;
      const author = fields(video.author);
      return author ? owner(clipId, { id: author.identifier, name: author.name, url: author.url, avatarUrl: author.image }) : null;
    }
  }
  return null;
}

/**
 * Who owns the clip this page shows, read in MAIN with its title: the player config's owner in the player frame
 * (also embedded elsewhere; its `url` is often empty, which shows the name without a link), else the watch page's
 * JSON-LD for the same clip.
 */
export function readVimeoOwner(doc: Document, config: Fields | null): VimeoOwner | null {
  const clipId = clipOf(doc.location.href);
  if (!clipId) return null;
  const video = fields(config?.video);
  const configured = fields(video?.owner);
  if (configured && id(video?.id ?? video?.clip_id) === clipId) {
    return owner(clipId, { id: configured.id, name: configured.name, url: configured.url, avatarUrl: configured.img_2x ?? configured.img });
  }
  return linkedDataOwner(doc, clipId);
}

/** The owner as it crossed from MAIN; the byline checks its link and portrait hosts again. */
export function parseVimeoOwner(value: unknown): VimeoOwner | undefined {
  const raw = fields(value);
  const author = fields(raw?.author);
  const clipId = id(raw?.clipId);
  return clipId && author ? owner(clipId, author as Parameters<typeof owner>[1]) ?? undefined : undefined;
}
