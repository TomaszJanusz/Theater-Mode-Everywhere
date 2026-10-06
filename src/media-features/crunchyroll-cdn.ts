/**
 * Crunchyroll file host observed in Chrome: vod-fy-mod.crunchyrollcdn.com.
 * Paths, without the signature query:
 * - ASS: /static/e00177755a00269347jajp/1/clean/subtitle-667360-en-US-1789593448.ass
 * - BIF: /static/e00177755a00269347jajp/1/clean/bif-1789659236.bif
 * - VTT: /static/majin/e00324920a00324921enus/enus/cenc/dash/captions/enus/20260814_191622/caption.vtt
 *
 * Live playback and Bitmovin track URLs add a single `t` query. The query is not
 * part of the asset identity. Host captions match origin, path, and asset and
 * then call the player's track id; they do not fetch the URL.
 * Fetching a BIF without `t` returns HTTP 400, so a MAIN-world BIF read must keep
 * that query. The public caption broker accepts only unsigned caption files.
 * The asset id is the path segment, not the watch-page media id.
 */

const CDN_HOST = 'vod-fy-mod.crunchyrollcdn.com';
const ASSET = '([A-Za-z0-9]{16,32})';
const LOCALE = '([A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8}){0,2})';
const ASS_PATH = new RegExp(`^/static/${ASSET}/1/clean/subtitle-\\d{1,12}-${LOCALE}-\\d{1,16}\\.ass$`, 'i');
const VTT_PATH = new RegExp(`^/static/majin/${ASSET}/${LOCALE}/cenc/dash/captions/\\2/\\d{8}_\\d{6}/caption\\.vtt$`, 'i');
const BIF_PATH = new RegExp(`^/static/${ASSET}/1/clean/bif-\\d{1,16}\\.bif$`, 'i');

export type CrunchyrollCdnQuery = 'none' | 't' | 'other';

export type CrunchyrollCdnFile = {
  assetId: string;
  kind: 'ass' | 'vtt' | 'bif';
  language?: string;
  query: CrunchyrollCdnQuery;
};

function unsafePath(value: string): boolean {
  return value.includes('..') || /%2e/i.test(value) || value.includes('\\');
}

function rawHttpsPath(value: string): string | null {
  const match = /^https:\/\/[^/?#]*([^?#]*)/i.exec(value.trim());
  if (!match?.[1]?.startsWith('/')) return null;
  return match[1];
}

function queryClass(url: URL): CrunchyrollCdnQuery | null {
  if (url.hash) return null;
  if (!url.search) return 'none';
  const keys = [...url.searchParams.keys()];
  const signed = keys.length === 1
    && keys[0] === 't'
    && url.searchParams.getAll('t').length === 1
    && /^\?t=[^&#\s]{1,2048}$/.test(url.search);
  return signed ? 't' : 'other';
}

export function crunchyrollCdnFile(value: string): CrunchyrollCdnFile | null {
  if (typeof value !== 'string' || !value || value.includes('\\')) return null;
  const rawPath = rawHttpsPath(value);
  if (!rawPath || unsafePath(rawPath)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/\.$/, '').toLowerCase();
  const query = queryClass(url);
  if (query == null) return null;
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (host !== CDN_HOST || rawPath !== url.pathname || unsafePath(url.pathname)) return null;
  const ass = rawPath.match(ASS_PATH);
  if (ass?.[1] && ass[2]) {
    return { assetId: ass[1].toLowerCase(), kind: 'ass', language: ass[2], query };
  }
  const vtt = rawPath.match(VTT_PATH);
  if (vtt?.[1] && vtt[2]) {
    return { assetId: vtt[1].toLowerCase(), kind: 'vtt', language: vtt[2], query };
  }
  const bif = rawPath.match(BIF_PATH);
  if (bif?.[1]) return { assetId: bif[1].toLowerCase(), kind: 'bif', query };
  return null;
}

/** Public caption broker. Signed and unknown queries stay out of this allowlist. */
export function isCrunchyrollCaptionFileUrl(value: string): boolean {
  const file = crunchyrollCdnFile(value);
  return (file?.kind === 'ass' || file?.kind === 'vtt') && file.query === 'none';
}

/** MAIN-world BIF read. The live file requires the `t` query and the bound asset. */
export function isCrunchyrollBifFileUrl(value: string, assetId?: string): boolean {
  const file = crunchyrollCdnFile(value);
  if (file?.kind !== 'bif' || file.query !== 't') return false;
  return assetId ? file.assetId === assetId.toLowerCase() : true;
}
