import type { EndScreenItem } from '../end-screen-view';

/** Pure normalization of the small fields read from a native suggestion anchor. */
export function normalizeSuggestion(fields: {
  href: string; title: string; image: string; channel: string; meta: string; duration: string;
}): EndScreenItem | null {
  try {
    const url = new URL(fields.href, 'https://www.youtube.com');
    const id = url.searchParams.get('v');
    const title = fields.title.replace(/\s+/g, ' ').trim();
    if (url.protocol !== 'https:' || !['www.youtube.com', 'youtube.com'].includes(url.hostname)
      || url.pathname !== '/watch' || !id || !/^[\w-]{11}$/.test(id) || !title || url.username || url.password || url.port) return null;
    let thumbnailUrl: string | undefined;
    try {
      const image = new URL(fields.image);
      if (image.protocol === 'https:' && /^(?:i\d*|img)\.ytimg\.com$/.test(image.hostname)
        && !image.username && !image.password && !image.port) thumbnailUrl = image.href;
    } catch { /* A missing or malformed thumbnail keeps its placeholder. */ }
    return { id, href: url.href, kind: url.searchParams.has('list') ? 'playlist' : 'video', title, thumbnailUrl,
      channel: fields.channel.trim(), meta: fields.meta.replace(/\s+/g, ' ').trim(), durationText: fields.duration.trim() };
  } catch { return null; }
}

export const YOUTUBE_END_TILES = '.ytp-fullscreen-grid a.ytp-modern-videowall-still';

/** No player internals or initial-page JSON: these are the links YouTube has rendered for this visit. */
export function readYouTubeSuggestions(root: ParentNode): Array<{ item: EndScreenItem; anchor: HTMLAnchorElement }> {
  const result: Array<{ item: EndScreenItem; anchor: HTMLAnchorElement }> = [];
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>(YOUTUBE_END_TILES)) {
    const text = (selector: string) => anchor.querySelector(selector)?.textContent ?? '';
    const background = anchor.querySelector<HTMLElement>('.ytp-modern-videowall-still-image')?.style.backgroundImage ?? '';
    const image = /^url\(["']?(.*?)["']?\)$/.exec(background)?.[1] ?? '';
    const item = normalizeSuggestion({ href: anchor.href, title: text('.ytp-modern-videowall-still-info-title'), image,
      channel: text('.ytp-modern-videowall-still-info-author'), meta: text('.ytp-modern-videowall-still-view-count-and-date-info'),
      duration: text('.ytp-modern-videowall-still-info-duration') });
    if (item && !result.some(entry => entry.item.id === item.id)) result.push({ item, anchor });
    if (result.length === 3) break;
  }
  return result;
}
