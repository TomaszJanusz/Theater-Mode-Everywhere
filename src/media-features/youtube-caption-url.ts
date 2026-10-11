const AUTH_KEYS = [
  'pot',
  'potc',
  'c',
  'cver',
  'cplayer',
  'cbr',
  'cbrver',
  'cos',
  'cosver',
  'cplatform',
  'xorb',
  'xobt',
  'xovt'
] as const;

export function timedtextVideoId(url: string): string | null {
  try {
    return new URL(url, 'https://www.youtube.com').searchParams.get('v');
  } catch {
    return null;
  }
}

export function youtubePageVideoId(href: string): string | null {
  try {
    const url = new URL(href, 'https://www.youtube.com');
    const fromQuery = url.searchParams.get('v');
    if (fromQuery) return fromQuery;
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);
    if (host === 'youtu.be') return parts[0] || null;
    if (parts[0] && ['shorts', 'embed', 'live', 'v'].includes(parts[0])) return parts[1] || null;
    return null;
  } catch {
    return null;
  }
}

export function youtubeSnapshotMatchesPage(snapshotVideoId: string | undefined, pageVideoId: string | null): boolean {
  if (!snapshotVideoId || !pageVideoId) return true;
  return snapshotVideoId === pageVideoId;
}

export function timedtextHasPot(url: string): boolean {
  try {
    return Boolean(new URL(url, 'https://www.youtube.com').searchParams.get('pot'));
  } catch {
    return false;
  }
}

export function mergeYoutubeCaptionAuth(targetUrl: string, sourceUrl: string): string {
  const target = new URL(targetUrl, 'https://www.youtube.com');
  const source = new URL(sourceUrl, 'https://www.youtube.com');
  for (const key of AUTH_KEYS) {
    const value = source.searchParams.get(key);
    if (value) target.searchParams.set(key, value);
  }
  return target.toString();
}

function captionLanguageTag(code: string): string {
  return code.trim().toLowerCase().replace(/_/g, '-').split('-')[0] || '';
}

/** Primary subtag only. Empty codes are not a match for a named language. */
function captionLanguagesCompatible(left: string, right: string): boolean {
  const a = captionLanguageTag(left);
  const b = captionLanguageTag(right);
  return Boolean(a) && a === b;
}

function explicitCaptionLang(url: string): string {
  try {
    return new URL(url, 'https://www.youtube.com').searchParams.get('lang')?.toLowerCase() || '';
  } catch {
    return '';
  }
}

function explicitCaptionTranslation(url: string): string {
  try {
    return new URL(url, 'https://www.youtube.com').searchParams.get('tlang')?.toLowerCase() || '';
  } catch {
    return '';
  }
}

function explicitCaptionKind(url: string): string {
  try {
    return new URL(url, 'https://www.youtube.com').searchParams.get('kind') || '';
  } catch {
    return '';
  }
}

/**
 * A pot minted for another language still authenticates the session, but a
 * same-track token has to win. Track-scoped tokens otherwise return the
 * player’s current captions for every menu choice.
 */
function sameCaptionRequest(targetUrl: string, sourceUrl: string): boolean {
  const targetLang = explicitCaptionLang(targetUrl);
  const sourceLang = explicitCaptionLang(sourceUrl);
  if ((targetLang || sourceLang) && !captionLanguagesCompatible(targetLang, sourceLang)) return false;
  const targetTranslation = explicitCaptionTranslation(targetUrl);
  const sourceTranslation = explicitCaptionTranslation(sourceUrl);
  if ((targetTranslation || sourceTranslation) && !captionLanguagesCompatible(targetTranslation, sourceTranslation)) return false;
  const targetKind = explicitCaptionKind(targetUrl);
  const sourceKind = explicitCaptionKind(sourceUrl);
  if (targetKind && sourceKind && targetKind !== sourceKind) return false;
  return true;
}

export function signYoutubeCaptionUrl(targetUrl: string, sourceUrls: string[]): string {
  const targetId = timedtextVideoId(targetUrl);
  const eligible: string[] = [];
  for (const source of sourceUrls) {
    if (!timedtextHasPot(source)) continue;
    const sourceId = timedtextVideoId(source);
    if (targetId) {
      if (sourceId !== targetId) continue;
    } else if (sourceId) {
      continue;
    }
    eligible.push(source);
  }
  const matched = eligible.find((source) => sameCaptionRequest(targetUrl, source)) || eligible[0];
  return matched ? mergeYoutubeCaptionAuth(targetUrl, matched) : targetUrl;
}

export type CachedTimedtext = {
  videoId: string;
  lang: string;
  tlang: string;
  kind: string;
  fmt: string;
  url: string;
  body: string;
};

export function createTimedtextCacheRecord(url: string, body: string): CachedTimedtext | null {
  try {
    const parsed = new URL(url, 'https://www.youtube.com');
    return {
      videoId: parsed.searchParams.get('v') || '',
      lang: (parsed.searchParams.get('lang') || parsed.searchParams.get('hl') || '').toLowerCase(),
      tlang: parsed.searchParams.get('tlang')?.toLowerCase() || '',
      kind: parsed.searchParams.get('kind') || '',
      fmt: parsed.searchParams.get('fmt') || '',
      url: parsed.toString(),
      body
    };
  } catch {
    return null;
  }
}

function namedCodesCompatible(query: string, cached: string): boolean {
  if (!query && !cached) return true;
  return captionLanguagesCompatible(query, cached);
}

/**
 * The player caches whichever track it last displayed. That body belongs to
 * one language and one translation target, even when the video id matches.
 */
function timedtextCacheCompatible(query: CachedTimedtext, item: CachedTimedtext): boolean {
  if (query.videoId && item.videoId !== query.videoId) return false;
  if (!namedCodesCompatible(query.lang, item.lang)) return false;
  if (!namedCodesCompatible(query.tlang, item.tlang)) return false;
  if (query.kind && item.kind && query.kind !== item.kind) return false;
  return true;
}

export function findCachedTimedtextBody(records: CachedTimedtext[], url: string): string | null {
  const query = createTimedtextCacheRecord(url, '');
  if (!query) return null;
  const matches = records.filter((item) => item.body && timedtextCacheCompatible(query, item));
  if (matches.length === 0) return null;
  const ranked = matches.map((item) => {
    let score = Math.min(item.body.length, 5_000_000);
    if (query.fmt && item.fmt === query.fmt) score += 1_000_000;
    if (query.kind && item.kind && item.kind === query.kind) score += 100_000;
    return { item, score };
  });
  ranked.sort((a, b) => b.score - a.score);
  return ranked[0]?.item.body || null;
}

function trackTranslationCode(track: Record<string, unknown>): string {
  const translation = track.translationLanguage;
  if (!translation || typeof translation !== 'object' || Array.isArray(translation)) return '';
  const code = (translation as Record<string, unknown>).languageCode;
  return typeof code === 'string' ? code : '';
}

/**
 * Picks the host track for a timedtext request.
 * An unspecified language must not fall through to whichever track is first:
 * that writes the player’s saved caption language. A source-track request
 * also drops a translation the player left on the track object.
 */
export function selectCaptionTrackOption(
  tracks: ReadonlyArray<Record<string, unknown>>,
  languageCode: string | null,
  kind: string | null,
  translationCode: string | null
): Record<string, unknown> | null {
  const usable = tracks.filter((track) => typeof track.languageCode === 'string');
  const languageMatches = languageCode
    ? usable.filter((track) => captionLanguagesCompatible(String(track.languageCode), languageCode))
    : [];
  const kindMatches = kind
    ? languageMatches.filter((track) => track.kind === kind)
    : languageMatches;
  const pool = kindMatches.length > 0 ? kindMatches : languageMatches;
  if (translationCode) {
    const translated = pool.find((track) => captionLanguagesCompatible(trackTranslationCode(track), translationCode));
    if (translated) return translated;
    if (!languageCode) return null;
    return {
      languageCode,
      ...(kind ? { kind } : {}),
      translationLanguage: { languageCode: translationCode }
    };
  }
  const source = pool.find((track) => !trackTranslationCode(track));
  if (source) return source;
  if (pool[0]) {
    const copy = { ...pool[0] };
    delete copy.translationLanguage;
    return copy;
  }
  if (!languageCode) return null;
  return { languageCode, ...(kind ? { kind } : {}) };
}
