import { sanitizeContentTitle, type ContentAuthor } from '../../media-features/content-title';

import { patreonPostId } from './watch-playback';

/** Creator avatars come from Patreon's image CDN only. */
export const PATREON_AVATAR_HOSTS = ['c10.patreonusercontent.com'];

/** The creator of one post: `postId` is the post it was read for, so a later page cannot inherit it. */
export type PatreonCreator = { postId: string; author: ContentAuthor };

const VANITY = /^[A-Za-z0-9_-]{1,64}$/;
const postOf = (href: string): string | null => {
  try { return patreonPostId(new URL(href)); } catch { return null; }
};

/** The vanity name in `https://www.patreon.com/<vanity>`, as the post's `article:author` names its campaign. */
function campaignVanity(doc: Document): string | null {
  try {
    const url = new URL(doc.querySelector('meta[property="article:author"]')?.getAttribute('content') ?? '');
    const segments = url.pathname.split('/').filter(Boolean);
    return url.protocol === 'https:' && url.hostname === 'www.patreon.com' && segments.length === 1 && VANITY.test(segments[0]) ? segments[0] : null;
  } catch {
    return null;
  }
}

/**
 * The post's creator, read in MAIN with its title: the campaign the post's metadata names, with the name and avatar
 * from the creator header that links to that same campaign. A post under `/<vanity>/posts/…` must name its own
 * vanity, so a page that has not caught up with a client navigation names nobody.
 */
export function readPatreonCreator(doc: Document): PatreonCreator | null {
  const postId = postOf(doc.location.href);
  const vanity = campaignVanity(doc);
  if (!postId || !vanity) return null;
  const path = new URL(doc.location.href).pathname.split('/').filter(Boolean);
  if (path[0] !== 'posts' && path[0]?.toLowerCase() !== vanity.toLowerCase()) return null;
  const url = `https://www.patreon.com/cw/${vanity}`;
  const header = [...doc.querySelectorAll<HTMLAnchorElement>('a[href]')].slice(0, 400)
    .find(link => link.href === url && link.querySelector('img') && sanitizeContentTitle(link.textContent));
  const name = sanitizeContentTitle(header?.textContent)?.slice(0, 80);
  if (!header || !name) return null;
  return { postId, author: { id: vanity.toLowerCase(), name, url, avatarUrl: header.querySelector('img')?.src || null, verified: false, stat: null } };
}

/** The creator as it crossed from MAIN; the byline checks its link and avatar hosts again. */
export function parsePatreonCreator(value: unknown): PatreonCreator | undefined {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const author = raw.author && typeof raw.author === 'object' ? raw.author as Record<string, unknown> : {};
  const text = (field: unknown, max: number) => typeof field === 'string' && field && field.length <= max ? field : null;
  const postId = text(raw.postId, 20);
  const id = text(author.id, 64);
  const name = text(author.name, 80);
  if (!postId || !/^\d+$/.test(postId) || !id || !VANITY.test(id) || !name) return undefined;
  return { postId, author: { id, name, url: text(author.url, 2000), avatarUrl: text(author.avatarUrl, 2000), verified: false, stat: null } };
}
