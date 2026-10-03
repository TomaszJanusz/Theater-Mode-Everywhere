const CONTENT_TITLE_MAX = 180;

/** Collapses whitespace and drops empty or non-string labels before they reach the title HUD. */
export function sanitizeContentTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.length > CONTENT_TITLE_MAX ? cleaned.slice(0, CONTENT_TITLE_MAX).trim() : cleaned;
}

function nestedText(value: unknown): string | null {
  const direct = sanitizeContentTitle(value);
  if (direct) return direct;
  if (!value || typeof value !== 'object') return null;
  const record = value as { simpleText?: unknown; runs?: Array<{ text?: unknown }> };
  return sanitizeContentTitle(record.simpleText) || sanitizeContentTitle(record.runs?.[0]?.text);
}

const VIMEO_SITE_SUFFIX = /\s*[|\-–—]\s*(?:videos?\s*&\s*movies\s+on\s+)?vimeo(?:\.com)?$/i;
const GENERIC_VIMEO_TITLE = /^(?:vimeo|log in|join|sign up|verify to continue)$/i;

/** Watch-page title. Player config wins at the call site; this is the page fallback. */
export function vimeoPageTitle(ogTitle: unknown, heading: unknown, documentTitle: unknown): string | null {
  for (const candidate of [ogTitle, heading, documentTitle]) {
    const raw = typeof candidate === 'string' ? candidate.replace(VIMEO_SITE_SUFFIX, '') : candidate;
    const cleaned = sanitizeContentTitle(raw);
    if (!cleaned || GENERIC_VIMEO_TITLE.test(cleaned) || /all-in-one video platform/i.test(cleaned)) continue;
    return cleaned;
  }
  return null;
}

export function youtubePlayerTitle(videoDetails: unknown, microformatTitle?: unknown): string | null {
  const details = videoDetails && typeof videoDetails === 'object'
    ? nestedText((videoDetails as { title?: unknown }).title)
    : null;
  return details || nestedText(microformatTitle);
}

const DISNEY_SITE_SUFFIX = /\s*[|–—-]\s*Disney\+$/i;
const GENERIC_DISNEY_TITLE = /^(?:disney\+?|home|watch|search|hulu)$/i;
const DISNEY_UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function stripDisneySiteTitle(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.replace(DISNEY_SITE_SUFFIX, '').replace(/^watch\s+/i, '') : value;
  const cleaned = sanitizeContentTitle(raw);
  if (!cleaned || GENERIC_DISNEY_TITLE.test(cleaned)) return null;
  return cleaned;
}

export type DisneyTitleSource = 'chrome' | 'playback' | 'page';

const DISNEY_TITLE_RANK: Record<DisneyTitleSource, number> = {
  page: 1,
  playback: 2,
  chrome: 3
};

/**
 * Title for the film that is actually playing.
 * Disney+ keeps the browse page's Open Graph title after a client-side
 * navigation, so the player chrome and the playback id outrank it.
 */
export function resolveDisneyTitle(input: {
  playId: string | null;
  previousPlayId: string | null;
  title: string | null;
  source: DisneyTitleSource | null;
  playerChrome: unknown;
  playbackTitle: unknown;
  documentTitle: unknown;
  openGraphTitle: unknown;
}): { title: string | null; source: DisneyTitleSource | null; changed: boolean } {
  let title = input.playId === input.previousPlayId ? input.title : null;
  let source = input.playId === input.previousPlayId ? input.source : null;
  const consider = (value: unknown, nextSource: DisneyTitleSource) => {
    const cleaned = stripDisneySiteTitle(value);
    if (!cleaned) return;
    const currentRank = source ? DISNEY_TITLE_RANK[source] : 0;
    if (DISNEY_TITLE_RANK[nextSource] < currentRank) return;
    if (DISNEY_TITLE_RANK[nextSource] === currentRank && title) return;
    title = cleaned;
    source = nextSource;
  };
  consider(input.playerChrome, 'chrome');
  consider(input.playbackTitle, 'playback');
  consider(input.documentTitle, 'page');
  consider(input.openGraphTitle, 'page');
  return { title, source, changed: title !== input.title };
}

function disneyNodeId(record: Record<string, unknown>): string | null {
  for (const key of ['contentId', 'mediaId', 'entityId', 'playbackId', 'id']) {
    const value = record[key];
    if (typeof value !== 'string') continue;
    const match = value.match(DISNEY_UUID_RE);
    if (match) return match[0].toLowerCase();
  }
  return null;
}

export function disneyRecordTitle(record: Record<string, unknown>): string | null {
  const text = record.text;
  if (text && typeof text === 'object') {
    const title = (text as { title?: unknown }).title;
    if (title && typeof title === 'object') {
      const full = sanitizeContentTitle((title as { full?: unknown }).full);
      if (full) return full;
    }
  }
  const visuals = record.visuals;
  if (visuals && typeof visuals === 'object') {
    const visualTitle = sanitizeContentTitle((visuals as { title?: unknown }).title);
    if (visualTitle) return visualTitle;
  }
  return null;
}

/**
 * Catalog title for the playing item.
 * Without a play id, the first title is enough. With one, a collection
 * payload must not contribute a sibling film's name.
 */
export function findDisneyContentTitle(raw: unknown, mediaId?: string | null): string | null {
  const wanted = mediaId?.match(DISNEY_UUID_RE)?.[0].toLowerCase() || null;
  let matched: string | null = null;
  let fallback: string | null = null;
  let budget = 5000;
  const walk = (node: unknown, depth: number, inheritedId: string | null) => {
    if (matched || budget <= 0 || node == null || depth > 14) return;
    budget -= 1;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1, inheritedId);
      return;
    }
    if (typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const id = disneyNodeId(record) || inheritedId;
    const title = disneyRecordTitle(record);
    if (title) {
      if (wanted && id === wanted) {
        matched = title;
        return;
      }
      if (!wanted && !fallback) fallback = title;
    }
    for (const value of Object.values(record)) walk(value, depth + 1, id);
  };
  walk(raw, 0, null);
  return matched || fallback;
}
