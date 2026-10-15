import { sanitizeContentTitle } from './content-title';

/** A schema.org VideoObject found in JSON-LD or microdata. */
export type VideoObjectCandidate = {
  name: string | null;
  contentUrls: string[];
  embedUrls: string[];
  /** Microdata scope that encloses the playing element. */
  containsMedia?: boolean;
};

/** Raw title candidates read for the playing element, strongest first. */
export type GenericTitleCandidates = {
  element: unknown;
  labelledBy: unknown;
  videoObjects: VideoObjectCandidate[];
  openGraph: unknown;
  twitter: unknown;
  document: unknown;
  siteName: unknown;
  /** A heading the reader has already tied to the playing element. */
  heading: unknown;
};

/** Absolute URLs of the page and of the playing media. */
export type MediaIdentity = { page: string; sources: string[] };

type PageSource = 'openGraph' | 'twitter' | 'document' | 'heading';
type PageValues = Record<PageSource, string | null>;

const PAGE_SOURCES: PageSource[] = ['openGraph', 'twitter', 'document', 'heading'];
const SITE_SEPARATOR = String.raw`\s*[|\-–—·:]\s*`;
const JSON_LD_BUDGET = 2000;
const JSON_LD_DEPTH = 10;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Drops a trailing site name, and a title that is only the site name. */
export function stripSiteName(value: unknown, siteName: unknown): string | null {
  const title = sanitizeContentTitle(value);
  const site = sanitizeContentTitle(siteName);
  if (!title || !site) return title;
  if (title.toLowerCase() === site.toLowerCase()) return null;
  return sanitizeContentTitle(title.replace(new RegExp(`${SITE_SEPARATOR}${escapeRegExp(site)}$`, 'i'), ''));
}

/** Absolute URL without its fragment, or null for unusable values. */
export function normalizeMediaUrl(value: unknown, base: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim(), base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function urlList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) => {
    if (typeof item === 'string') return [item];
    // JSON-LD may wrap a URL as { "@id": … } or { "url": … }.
    if (item && typeof item === 'object') {
      const record = item as { '@id'?: unknown; url?: unknown };
      return [record.url, record['@id']].filter((url): url is string => typeof url === 'string');
    }
    return [];
  });
}

function isVideoObjectType(type: unknown): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some((item) => typeof item === 'string' && /(?:^|[/#:])VideoObject$/.test(item));
}

/** VideoObjects in one JSON-LD script, including `@graph` and nested entities. */
export function parseJsonLdVideoObjects(text: string): VideoObjectCandidate[] {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return [];
  }
  const found: VideoObjectCandidate[] = [];
  let budget = JSON_LD_BUDGET;
  const walk = (node: unknown, depth: number) => {
    if (budget <= 0 || depth > JSON_LD_DEPTH || !node || typeof node !== 'object') return;
    budget -= 1;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    if (isVideoObjectType(record['@type'])) {
      found.push({
        name: sanitizeContentTitle(record.name),
        contentUrls: urlList(record.contentUrl),
        embedUrls: urlList(record.embedUrl)
      });
    }
    for (const value of Object.values(record)) walk(value, depth + 1);
  };
  walk(root, 0);
  return found;
}

/**
 * Whether a VideoObject describes the playing media: its `contentUrl` is a
 * media source, its `embedUrl` is this (embedded player) page, or its
 * microdata scope encloses the element.
 */
export function videoObjectMatches(object: VideoObjectCandidate, media: MediaIdentity): boolean {
  if (object.containsMedia) return true;
  const sources = new Set(media.sources.map((source) => normalizeMediaUrl(source, media.page)).filter(Boolean));
  const page = normalizeMediaUrl(media.page, media.page);
  return object.contentUrls.some((url) => sources.has(normalizeMediaUrl(url, media.page)))
    || Boolean(page && object.embedUrls.some((url) => normalizeMediaUrl(url, media.page) === page));
}

function pageValues(input: GenericTitleCandidates): PageValues {
  return {
    openGraph: stripSiteName(input.openGraph, input.siteName),
    twitter: stripSiteName(input.twitter, input.siteName),
    document: stripSiteName(input.document, input.siteName),
    heading: sanitizeContentTitle(input.heading)
  };
}

/**
 * Generic title order: the element's own title, its `aria-labelledby` label,
 * a VideoObject matching the media, then page metadata and a tied heading.
 */
function selectGenericTitle(input: GenericTitleCandidates, values: PageValues, media: MediaIdentity, stale: PageValues | null): string | null {
  const own = sanitizeContentTitle(input.element) || sanitizeContentTitle(input.labelledBy);
  if (own) return own;
  const object = input.videoObjects.find((item) => item.name && videoObjectMatches(item, media));
  if (object?.name) return object.name;
  for (const source of PAGE_SOURCES) {
    const value = values[source];
    if (value && value !== stale?.[source]) return value;
  }
  return null;
}

function pageKey(url: string): string {
  const hash = url.indexOf('#');
  return hash < 0 ? url : url.slice(0, hash);
}

/**
 * Remembers page values per URL. A client-side navigation can change the URL
 * before `<title>`, meta tags or the heading, so after a URL change each page
 * value still equal to the previous page's is rejected until the page
 * replaces it. Fragment changes keep the page.
 */
export class GenericTitleTracker {
  private page: string | null = null;
  private last: PageValues | null = null;
  private stale: PageValues | null = null;

  select(input: GenericTitleCandidates, media: MediaIdentity): string | null {
    const page = pageKey(media.page);
    if (this.page !== null && page !== this.page) this.stale = this.last;
    this.page = page;
    this.last = pageValues(input);
    return selectGenericTitle(input, this.last, media, this.stale);
  }
}
