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
  /** Adjacent headings can name both the series and the episode more fully than <title>. */
  headingBeforeDocument?: boolean;
};

/** Absolute URLs of the page and of the playing media. */
export type MediaIdentity = {
  page: string;
  sources: string[];
  /** Player document URL when reading a parent page. */
  embedPage?: string;
};

type PageSource = 'openGraph' | 'twitter' | 'document' | 'heading';
type PageValues = Record<PageSource, string | null>;

const PAGE_SOURCES: PageSource[] = ['openGraph', 'twitter', 'document', 'heading'];
const SITE_SEPARATOR = String.raw`\s*[|\-–—·:]\s*`;
const JSON_LD_BUDGET = 2000;
const JSON_LD_DEPTH = 10;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A conservative host label fallback, not a public-suffix lookup. */
export function siteNameFromUrl(page: string): string | null {
  try {
    const host = new URL(page).hostname.replace(/\.$/, '').toLowerCase();
    if (host.includes(':') || /^[\d.]+$/.test(host)) return null;
    const labels = host.split('.');
    if (labels.length < 2) return null;
    // Common country-code suffixes use an extra registry label (for example co.uk).
    const registry = labels.at(-1)!.length === 2 && /^(?:ac|co|com|edu|gov|net|org)$/.test(labels.at(-2)!);
    return labels.at(registry ? -3 : -2)?.replace(/-/g, '') || null;
  } catch {
    return null;
  }
}

/** Drops a trailing site name, and a title that is only the site name. */
export function stripSiteName(value: unknown, siteName: unknown, page = ''): string | null {
  const title = sanitizeContentTitle(value);
  const explicitSite = sanitizeContentTitle(siteName);
  const site = explicitSite || siteNameFromUrl(page);
  if (!title || !site) return title;
  // Host labels omit word separators; keep explicit og:site_name matching exact.
  const pattern = explicitSite ? escapeRegExp(site) : [...site].map(escapeRegExp).join('[\\s-]*');
  if (new RegExp(`^${pattern}$`, 'i').test(title)) return null;
  return sanitizeContentTitle(title.replace(new RegExp(`${SITE_SEPARATOR}${pattern}$`, 'i'), ''));
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
  const page = normalizeMediaUrl(media.embedPage || media.page, media.page);
  return object.contentUrls.some((url) => sources.has(normalizeMediaUrl(url, media.page)))
    || Boolean(page && object.embedUrls.some((url) => normalizeMediaUrl(url, media.page) === page));
}

function pageValues(input: GenericTitleCandidates, page: string): PageValues {
  return {
    openGraph: stripSiteName(input.openGraph, input.siteName, page),
    twitter: stripSiteName(input.twitter, input.siteName, page),
    document: stripSiteName(input.document, input.siteName, page),
    heading: stripSiteName(input.heading, input.siteName, page)
  };
}

/**
 * Generic title order: the element's own title, its `aria-labelledby` label,
 * a VideoObject matching the media, then page metadata and a tied heading.
 * A composite series/episode heading outranks the document title.
 */
function selectGenericTitle(input: GenericTitleCandidates, values: PageValues, media: MediaIdentity, stale: PageValues | null): string | null {
  const own = sanitizeContentTitle(input.element) || sanitizeContentTitle(input.labelledBy);
  if (own) return own;
  const object = input.videoObjects.find((item) => item.name && videoObjectMatches(item, media));
  if (object?.name) return object.name;
  const order: PageSource[] = input.headingBeforeDocument ? ['openGraph', 'twitter', 'heading', 'document'] : PAGE_SOURCES;
  for (const source of order) {
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
 * replaces it. Parent metadata also follows the embed URL. Fragment changes keep the page.
 */
export class GenericTitleTracker {
  private page: string | null = null;
  private last: PageValues | null = null;
  private stale: PageValues | null = null;

  select(input: GenericTitleCandidates, media: MediaIdentity): string | null {
    const page = `${pageKey(media.page)}\n${pageKey(media.embedPage || media.page)}`;
    if (this.page !== null && page !== this.page) this.stale = this.last;
    this.page = page;
    this.last = pageValues(input, media.page);
    return selectGenericTitle(input, this.last, media, this.stale);
  }
}
