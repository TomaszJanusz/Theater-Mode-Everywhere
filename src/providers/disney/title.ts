import { sanitizeContentTitle } from '../../media-features/content-title';

const DISNEY_SITE_SUFFIX = /\s*[|–—-]\s*Disney\+$/i;
const GENERIC_DISNEY_TITLE = /^(?:disney\+?|home|watch|search|hulu)$/i;
const DISNEY_UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function stripDisneySiteTitle(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.replace(DISNEY_SITE_SUFFIX, '').replace(/^watch\s+/i, '') : value;
  const cleaned = sanitizeContentTitle(raw);
  if (!cleaned || GENERIC_DISNEY_TITLE.test(cleaned)) return null;
  return cleaned;
}

export type DisneyTitleSource = 'player' | 'chrome' | 'playback' | 'page';

const DISNEY_TITLE_RANK: Record<DisneyTitleSource, number> = {
  page: 1,
  playback: 2,
  chrome: 3,
  player: 4
};

export type DisneyPlayerHeader = { title: string; subtitle: string | null };

/**
 * Header the Disney+ player draws from `playerExperience`. The episode label
 * stays opaque host text: its season/episode notation is localized.
 */
export function readDisneyPlayerHeader(raw: unknown): DisneyPlayerHeader | null {
  const data = raw && typeof raw === 'object' ? (raw as { data?: unknown }).data : null;
  const experience = data && typeof data === 'object' ? (data as { playerExperience?: unknown }).playerExperience : null;
  if (!experience || typeof experience !== 'object') return null;
  const record = experience as { title?: unknown; subtitle?: unknown };
  const title = stripDisneySiteTitle(record.title);
  return title ? { title, subtitle: sanitizeContentTitle(record.subtitle) } : null;
}

/**
 * Title for the film that is actually playing.
 * Disney+ keeps the browse page's Open Graph title after a client-side
 * navigation, so the player header, chrome and the playback id outrank it.
 */
export function resolveDisneyTitle(input: {
  playId: string | null;
  previousPlayId: string | null;
  title: string | null;
  source: DisneyTitleSource | null;
  playerHeader?: unknown;
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
    // The newest player header replaces an older one; weaker equals keep the first title.
    if (DISNEY_TITLE_RANK[nextSource] === currentRank && title && nextSource !== 'player') return;
    title = cleaned;
    source = nextSource;
  };
  consider(input.playerHeader, 'player');
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
