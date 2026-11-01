import type { EndScreenItem } from '../end-screen-view';

import { BILIBILI_END_TILE } from './autoplay';

const ORIGIN = 'https://www.bilibili.com';
const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

/** Covers come from Bilibili's image hosts only; a missing or malformed one keeps the placeholder. */
export function normalizeBilibiliCover(raw: string): string | undefined {
  try {
    const url = new URL(raw, ORIGIN);
    return url.protocol === 'https:' && /^i\d\.hdslb\.com$/.test(url.hostname) && !url.username && !url.password && !url.port ? url.href : undefined;
  } catch { return undefined; }
}

/** The BV id of a related video's link, or null for anything but an ordinary video page. */
export function bilibiliVideoId(href: string): string | null {
  try {
    const url = new URL(href, ORIGIN);
    const match = /^(?:\/[a-z]{2,3}(?:-[A-Za-z]{2,4})?)?\/video\/(BV[0-9A-Za-z]{10})\/?$/.exec(url.pathname);
    return url.protocol === 'https:' && url.hostname === 'www.bilibili.com' && !url.port && match ? match[1] : null;
  } catch { return null; }
}

interface Card { id: string; title: string; cover?: string; uploader: string; views: string; durationText: string }

/** The sidebar's related cards are the same list the ending panel shows, with the facts the panel leaves out. */
function readCard(card: Element): Card | null {
  const id = bilibiliVideoId(card.querySelector('a[href]')?.getAttribute('href') ?? '');
  const title = clean(card.querySelector('.title')?.textContent);
  if (!id || !title) return null;
  const duration = clean(card.querySelector('.duration')?.textContent);
  return { id, title, cover: normalizeBilibiliCover(card.querySelector('img')?.getAttribute('src') ?? ''),
    uploader: clean(card.querySelector('.upname .name')?.textContent),
    views: /^[\d.,]+[万亿]?$/.exec(clean(card.querySelector('.playinfo')?.textContent).split(' ')[0] ?? '')?.[0] ?? '',
    durationText: /^\d{1,2}(?::\d{2}){1,2}$/.test(duration) ? duration : '' };
}

/**
 * The first tiles Bilibili rendered in its ending panel, in its order, each completed from the matching sidebar card
 * (same title) when the page has one. Only what the page already rendered: no player internals, no requests.
 */
export function readBilibiliEndTiles(root: ParentNode, doc: ParentNode, limit = 3): Array<{ item: EndScreenItem; element: HTMLElement }> {
  const cards = [...doc.querySelectorAll('.next-play .video-page-card-small, .rec-list .video-page-card-small')]
    .map(readCard).filter((card): card is Card => card !== null);
  const result: Array<{ item: EndScreenItem; element: HTMLElement }> = [];
  for (const [index, element] of [...root.querySelectorAll<HTMLElement>(BILIBILI_END_TILE)].entries()) {
    const title = clean(element.querySelector('.bpx-player-ending-related-item-title')?.textContent);
    if (!title) continue;
    const card = cards.find(card => card.title === title);
    const background = /^url\(["']?(.*?)["']?\)$/.exec(element.querySelector<HTMLElement>('.bpx-player-ending-related-item-img')?.style.backgroundImage ?? '')?.[1] ?? '';
    const id = card?.id ?? `tile-${index}`;
    if (result.some(entry => entry.item.id === id)) continue;
    result.push({ element, item: { id, kind: 'video', title, thumbnailUrl: normalizeBilibiliCover(background) ?? card?.cover,
      channel: card?.uploader, meta: card?.views, durationText: card?.durationText } });
    if (result.length === limit) break;
  }
  return result;
}
