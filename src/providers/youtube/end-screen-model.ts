import { allowedHttpsUrl } from '../author-byline';
import type { EndScreenItem } from '../end-screen-view';

import type { YouTubeSuggestionChannel } from './owner-main';

/** The tiles link only to YouTube's own pages. */
const isYouTubePage = (hostname: string) => hostname === 'www.youtube.com' || hostname === 'youtube.com';

/** Pure normalization of the small fields read from a native suggestion anchor. */
export function normalizeSuggestion(fields: {
  href: string; title: string; image: string; channel: string; meta: string; duration: string;
}): EndScreenItem | null {
  try {
    const url = new URL(fields.href, 'https://www.youtube.com');
    const id = url.searchParams.get('v');
    const title = fields.title.replace(/\s+/g, ' ').trim();
    if (url.protocol !== 'https:' || !isYouTubePage(url.hostname)
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

/**
 * The tile's channel link, only when YouTube's data names the same channel the tile shows (so a reply for another
 * list never links the wrong name) and the link stays on YouTube, as the byline's links do.
 */
export function suggestionChannelHref(item: EndScreenItem, channel: YouTubeSuggestionChannel | undefined): string | undefined {
  if (!channel || !item.channel || channel.name.replace(/\s+/g, ' ').trim() !== item.channel.replace(/\s+/g, ' ')) return undefined;
  return allowedHttpsUrl(channel.url, isYouTubePage) ?? undefined;
}

export const YOUTUBE_END_TILES = '.ytp-fullscreen-grid a.ytp-modern-videowall-still';

/**
 * No player internals: these are the links YouTube has rendered for this visit. `channels` (by video id, from the
 * watch-next end screen MAIN holds) only adds the channel link the rendered tiles leave out.
 */
export function readYouTubeSuggestions(
  root: ParentNode, channels?: ReadonlyMap<string, YouTubeSuggestionChannel>
): Array<{ item: EndScreenItem; anchor: HTMLAnchorElement }> {
  const result: Array<{ item: EndScreenItem; anchor: HTMLAnchorElement }> = [];
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>(YOUTUBE_END_TILES)) {
    const text = (selector: string) => anchor.querySelector(selector)?.textContent ?? '';
    const background = anchor.querySelector<HTMLElement>('.ytp-modern-videowall-still-image')?.style.backgroundImage ?? '';
    const image = /^url\(["']?(.*?)["']?\)$/.exec(background)?.[1] ?? '';
    const item = normalizeSuggestion({ href: anchor.href, title: text('.ytp-modern-videowall-still-info-title'), image,
      channel: text('.ytp-modern-videowall-still-info-author'), meta: text('.ytp-modern-videowall-still-view-count-and-date-info'),
      duration: text('.ytp-modern-videowall-still-info-duration') });
    if (!item || result.some(entry => entry.item.id === item.id)) continue;
    const channelHref = suggestionChannelHref(item, channels?.get(item.id));
    result.push({ item: channelHref ? { ...item, channelHref } : item, anchor });
    if (result.length === 3) break;
  }
  return result;
}
