import type { MediaFetchRequest } from '../../media-features/fetch-allowlist';

/** JSON subtitle objects on hdslb. AI tracks often have no .json suffix. */
function isSubtitlePath(pathname: string): boolean {
  if (pathname.includes('\\') || pathname.includes('%') || pathname.split('/').includes('..')) return false;
  return /^\/bfs\/(?:ai_)?subtitle(?:\/[\w-]+)*\/[\w-]+(?:\.json)?$/i.test(pathname);
}

/** Path as written, before URL normalization drops ".." or decodes "%2e%2e". */
function rawHttpsPath(url: string): string | null {
  const match = /^https:\/\/[^/?#]*([^?#]*)/i.exec(url.trim());
  if (!match?.[1]?.startsWith('/')) return null;
  return match[1];
}

/** Bilibili's subtitle cue files, the only media this provider fetches through the page broker. */
export function isBilibiliSubtitleUrl(url: string, base?: string): boolean {
  let parsed: URL;
  try { parsed = base ? new URL(url, base) : new URL(url); } catch { return false; }
  const rawPath = rawHttpsPath(url);
  return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port
    && (parsed.hostname === 'hdslb.com' || parsed.hostname.endsWith('.hdslb.com'))
    && rawPath !== null
    && rawPath === parsed.pathname
    && isSubtitlePath(rawPath);
}

export function allowsBilibiliMediaFetch(request: MediaFetchRequest, base?: string): boolean {
  return request.provider === 'bilibili' && request.kind === 'caption-track' && isBilibiliSubtitleUrl(request.url, base);
}
