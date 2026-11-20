import type { ContentAuthor } from '../media-features/content-title';

import { descriptorMatchesHost } from './descriptor-hosts';

/** At most this many authors are shown; the panel stacks the first three avatars. */
export const MAX_AUTHORS = 8;
const MAX_NAME = 80;
const MAX_STAT = 40;

/** Where a provider's author links and avatars may point: its own hosts, and the image hosts it declares. */
export interface AuthorHosts {
  link(hostname: string): boolean;
  image(hostname: string): boolean;
}

/** Links to the provider's descriptor hosts; avatars from the exact image hosts it lists. */
export function providerAuthorHosts(
  hosts: readonly { domain: string; includeSubdomains: boolean }[],
  imageHosts: readonly string[]
): AuthorHosts {
  return { link: hostname => descriptorMatchesHost(hosts, hostname), image: hostname => imageHosts.includes(hostname) };
}

const clean = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return text || null;
};

/** An absolute https URL without credentials or a custom port, on a host `allowed` admits; null otherwise. */
export function allowedHttpsUrl(value: unknown, allowed: (hostname: string) => boolean): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowed(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * The byline's boundary check: authors come from host page data, so every field is checked again here. An author
 * without a name or id is dropped; a link or avatar off the provider's hosts is dropped alone. Duplicates (by id) go,
 * and at most `MAX_AUTHORS` stay, in the order the provider gave (owner first).
 */
export function checkedAuthors(value: unknown, hosts: AuthorHosts): ContentAuthor[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const authors: ContentAuthor[] = [];
  for (const raw of value.slice(0, 64) as unknown[]) {
    if (authors.length >= MAX_AUTHORS) break;
    if (!raw || typeof raw !== 'object') continue;
    const author = raw as Record<string, unknown>;
    const id = clean(author.id, 200);
    const name = clean(author.name, MAX_NAME);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    authors.push({
      id, name,
      url: allowedHttpsUrl(author.url, hosts.link),
      avatarUrl: allowedHttpsUrl(author.avatarUrl, hosts.image),
      verified: author.verified === true,
      stat: clean(author.stat, MAX_STAT)
    });
  }
  return authors;
}

/** The panel's visible names: one name, "A & B", or "A +2" for three or more. */
export function bylineNames(authors: readonly ContentAuthor[]): { names: string[]; more: number } {
  if (authors.length === 2) return { names: [authors[0].name, authors[1].name], more: 0 };
  return { names: authors.slice(0, 1).map(author => author.name), more: Math.max(0, authors.length - 1) };
}

/** Up to two initials, for an author without a usable avatar. */
export function monogram(name: string): string {
  const words = name.split(/[\s_.-]+/u).filter(Boolean);
  const letters = (words.length > 1 ? [words[0], words[1]] : [name]).map(word => [...word][0] ?? '');
  return (words.length > 1 ? letters.join('') : [...name].slice(0, 2).join('')).toLocaleUpperCase();
}
