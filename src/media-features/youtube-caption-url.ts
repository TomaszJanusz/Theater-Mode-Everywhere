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

export type CachedTimedtext = {
  videoId: string;
  lang: string;
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
      kind: parsed.searchParams.get('kind') || '',
      fmt: parsed.searchParams.get('fmt') || '',
      url: parsed.toString(),
      body
    };
  } catch {
    return null;
  }
}

function langCompatible(query: string, cached: string): boolean {
  if (!query || !cached) return true;
  return query === cached || query.startsWith(`${cached}-`) || cached.startsWith(`${query}-`);
}

export function findCachedTimedtextBody(records: CachedTimedtext[], url: string): string | null {
  const query = createTimedtextCacheRecord(url, '');
  if (!query) return null;
  const matches = records.filter((item) => item.body && (!query.videoId || item.videoId === query.videoId));
  if (matches.length === 0) return null;
  const ranked = matches.map((item) => {
    let score = Math.min(item.body.length, 5_000_000);
    if (query.fmt && item.fmt === query.fmt) score += 1_000_000;
    if (query.kind && item.kind && item.kind === query.kind) score += 100_000;
    if (query.lang && item.lang && langCompatible(query.lang, item.lang)) score += 10_000;
    return { item, score };
  });
  ranked.sort((a, b) => b.score - a.score);
  return ranked[0]?.item.body || null;
}
