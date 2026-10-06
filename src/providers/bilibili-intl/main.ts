import { isBilibiliIntlHost } from '../hosts';
import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import {
  bilibiliIntlEpisodeId,
  bilibiliIntlShotBinUrl,
  bilibiliIntlTitle,
  normalizeBilibiliIntlSnapshot,
  parseBilibiliIntlShotIndex,
  parseBilibiliIntlSkipChapters,
  parseBilibiliIntlStoryboard,
  unwrapBilibiliIntlValue,
  type BilibiliIntlKind,
  type BilibiliIntlSnapshot,
  type BilibiliIntlStoryboard
} from '../../media-features/parsers/bilibili-intl';

export type { BilibiliIntlSnapshot } from '../../media-features/parsers/bilibili-intl';

const EPISODE_ATTR = 'data-te-bilibili-intl-episode';
const KIND_ATTR = 'data-te-bilibili-intl-kind';

export function bilibiliIntlIntegrationEnabled(): boolean {
  return isBilibiliIntlHost() && mediaProviderIntegrationEnabled('bilibiliIntl');
}

type PageWindow = Window & { __initialState?: unknown };

function pageState(): unknown {
  return (window as PageWindow).__initialState;
}

function locationPath(): string {
  try {
    return window.location?.pathname || '';
  } catch {
    return '';
  }
}

/** OGV episode pages (`/{locale}/play/{season}`). `/video/` is a different identity and is not an episode id. */
export function bilibiliIntlOgvEpisodePath(pathname = locationPath()): boolean {
  if (!pathname || /\/video(?:\/|$)/i.test(pathname)) return false;
  return /^\/(?:[a-z]{2}(?:-[A-Za-z0-9]{2,8})?\/)?play\/\d{1,20}(?:\/|$)/.test(pathname);
}

/** Public user uploads (`/{locale}/video/{aid}`). `videosimple` and `video-rules` do not match. */
export function bilibiliIntlUgcPath(pathname = locationPath()): boolean {
  return /^\/(?:[a-z]{2}(?:-[A-Za-z0-9]{2,8})?\/)?video\/\d{1,20}(?:\/|$)/.test(pathname || '');
}

export function bilibiliIntlPathKind(pathname = locationPath()): BilibiliIntlKind | null {
  if (bilibiliIntlUgcPath(pathname)) return 'ugc';
  if (bilibiliIntlOgvEpisodePath(pathname)) return 'ogv';
  return null;
}

export function bilibiliIntlRouteEpisodeId(pathname = locationPath()): string | null {
  const match = /^\/(?:[a-z]{2}(?:-[A-Za-z0-9]{2,8})?\/)?play\/\d{1,20}\/(\d{1,20})(?:\/|$)/.exec(pathname);
  return match ? bilibiliIntlEpisodeId(match[1]) : null;
}

export function bilibiliIntlRouteAid(pathname = locationPath()): string | null {
  const match = /^\/(?:[a-z]{2}(?:-[A-Za-z0-9]{2,8})?\/)?video\/(\d{1,20})(?:\/|$)/.exec(pathname);
  return match ? bilibiliIntlEpisodeId(match[1]) : null;
}

export type BilibiliIntlLoadScope = {
  supported: boolean;
  path: string;
  kind: BilibiliIntlKind | null;
  /** Episode segment on `/play/`, or the upload id on `/video/`. */
  routeEpisodeId: string | null;
};

/** Identity the content script can see before MAIN publishes an id. */
export function bilibiliIntlLoadScope(): BilibiliIntlLoadScope {
  const path = locationPath();
  const kind = bilibiliIntlPathKind(path);
  return {
    supported: kind !== null && bilibiliIntlIntegrationEnabled(),
    path,
    kind,
    routeEpisodeId: kind === 'ugc' ? bilibiliIntlRouteAid(path) : bilibiliIntlRouteEpisodeId(path)
  };
}

function stateEpisodeId(): string | null {
  const root = unwrapBilibiliIntlValue(pageState());
  const ogv = unwrapBilibiliIntlValue(root && typeof root === 'object' ? (root as { ogv?: unknown }).ogv : undefined);
  const epId = ogv && typeof ogv === 'object' ? (ogv as { epId?: unknown }).epId : undefined;
  return bilibiliIntlEpisodeId(unwrapBilibiliIntlValue(epId));
}

function stateAid(): string | null {
  const root = unwrapBilibiliIntlValue(pageState());
  const ugc = unwrapBilibiliIntlValue(root && typeof root === 'object' ? (root as { ugc?: unknown }).ugc : undefined);
  const direct = ugc && typeof ugc === 'object' ? (ugc as { aid?: unknown }).aid : undefined;
  const fromStore = bilibiliIntlEpisodeId(unwrapBilibiliIntlValue(direct));
  if (fromStore) return fromStore;
  const archive = unwrapBilibiliIntlValue(ugc && typeof ugc === 'object' ? (ugc as { archive?: unknown }).archive : undefined);
  const archived = archive && typeof archive === 'object' ? (archive as { aid?: unknown }).aid : undefined;
  return bilibiliIntlEpisodeId(unwrapBilibiliIntlValue(archived));
}

/** An attribute without a kind is an older OGV publication. A ugc id must not satisfy an episode page, or the reverse. */
function publishedId(kind: BilibiliIntlKind): string | null {
  const id = bilibiliIntlEpisodeId(document.documentElement?.getAttribute(EPISODE_ATTR));
  if (!id) return null;
  const published = document.documentElement?.getAttribute(KIND_ATTR);
  if (published === 'ogv' || published === 'ugc') return published === kind ? id : null;
  return kind === 'ogv' ? id : null;
}

export function bilibiliIntlPageId(): string | null {
  const kind = bilibiliIntlPathKind();
  if (kind === 'ogv') return ogvPageId();
  if (kind === 'ugc') return ugcPageId();
  return null;
}

function ogvPageId(): string | null {
  // Page state wins in MAIN. The content script only sees the route and the attribute published below.
  const fromState = stateEpisodeId();
  if (fromState) return fromState;
  const fromRoute = bilibiliIntlRouteEpisodeId();
  const fromAttr = publishedId('ogv');
  // A season URL has no episode segment. When the path names an episode, a different attribute is stale.
  if (fromRoute && fromAttr && fromRoute !== fromAttr) return fromRoute;
  return fromAttr || fromRoute;
}

function ugcPageId(): string | null {
  const fromRoute = bilibiliIntlRouteAid();
  const fromState = stateAid();
  if (fromState && (!fromRoute || fromState === fromRoute)) return fromState;
  const fromAttr = publishedId('ugc');
  if (fromRoute && fromAttr && fromRoute !== fromAttr) return fromRoute;
  return fromAttr || fromRoute;
}

type MediaRef = { kind: BilibiliIntlKind; id: string };

function currentMedia(): MediaRef | null {
  const kind = bilibiliIntlPathKind();
  if (!kind) return null;
  if (kind === 'ogv') {
    const id = stateEpisodeId();
    if (!id) return null;
    const route = bilibiliIntlRouteEpisodeId();
    if (route && route !== id) return null;
    return { kind, id };
  }
  const id = stateAid();
  if (!id) return null;
  const route = bilibiliIntlRouteAid();
  if (route && route !== id) return null;
  return { kind, id };
}

function publishMedia(media: MediaRef | null): void {
  const root = document.documentElement;
  if (!root) return;
  if (!media) {
    root.removeAttribute(EPISODE_ATTR);
    root.removeAttribute(KIND_ATTR);
    return;
  }
  root.setAttribute(EPISODE_ATTR, media.id);
  root.setAttribute(KIND_ATTR, media.kind);
}

function pageDuration(): number | undefined {
  const video = document.querySelector('video') as { duration?: unknown } | null;
  const duration = Number(video?.duration);
  return Number.isFinite(duration) && duration > 0 && duration < 24 * 60 * 60 ? duration : undefined;
}

let cached: { key: string; expires: number; pending: Promise<BilibiliIntlSnapshot | null> } | null = null;

/**
 * Page locale keys from `vendor-bc097aa0.js` (`$s` / `nU`).
 * `Qt()` in `index-f905d25c.js` sends `le.get(sLocale)` as `s_locale` with `platform=web`.
 * Unknown keys fall back to `en`, the same default as the page router.
 */
const S_LOCALE_BY_PAGE: Record<string, string> = {
  en: 'en_US',
  zh: 'zh-Hant_HK',
  id: 'id_ID',
  th: 'th_TH',
  ms: 'en_MY',
  vi: 'vi_VN',
  ar: 'ar_SA'
};

const OGV_SPM_ID = 'bstar-web.pgc-video-detail.0.0';
const UGC_SPM_ID = 'bstar-web.ugc-video-detail.0.0';

function knownPageLocale(value: unknown): string | null {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(S_LOCALE_BY_PAGE, value) ? value : null;
}

/** `global.sLocale` after hydration, otherwise the locale segment of the route. */
function pageLocale(): string {
  const root = unwrapBilibiliIntlValue(pageState());
  const globalState = unwrapBilibiliIntlValue(root && typeof root === 'object' ? (root as { global?: unknown }).global : undefined);
  const fromState = knownPageLocale(unwrapBilibiliIntlValue(
    globalState && typeof globalState === 'object' ? (globalState as { sLocale?: unknown }).sLocale : undefined
  ));
  if (fromState) return fromState;
  const match = /^\/([a-z]{2})(?:-[A-Za-z0-9]{2,8})?(?:\/|$)/.exec(locationPath());
  return knownPageLocale(match?.[1]) || 'en';
}

function apiSLocale(): string {
  return S_LOCALE_BY_PAGE[pageLocale()];
}

/** `useSpm` reads `bstar_from`. Only a bounded token is forwarded; anything else stays empty. */
function fromSpmId(): string {
  let search = '';
  try {
    search = typeof window.location?.search === 'string' ? window.location.search : '';
  } catch {
    return '';
  }
  if (!search.startsWith('?')) return '';
  const value = new URLSearchParams(search).get('bstar_from') ?? '';
  return /^[A-Za-z0-9._~-]{1,200}$/.test(value) ? value : '';
}

/**
 * Official metadata query. Subtitles use `episode_id` on OGV and `aid` on uploads,
 * plus the page's `spm_id`. Shots use the same id field as `video/shot` in the player.
 * Intro/outro is `ogv/play/episode` and is not requested for an upload.
 */
function metadataUrl(media: MediaRef, resource: 'subtitle' | 'shot' | 'episode'): string {
  const params = new URLSearchParams();
  params.set('s_locale', apiSLocale());
  params.set('platform', 'web');
  if (resource === 'episode') {
    params.set('episode_id', media.id);
    return `https://api.bilibili.tv/intl/gateway/web/v2/ogv/play/episode?${params.toString()}`;
  }
  params.set(media.kind === 'ugc' ? 'aid' : 'episode_id', media.id);
  if (resource === 'subtitle') {
    params.set('spm_id', media.kind === 'ugc' ? UGC_SPM_ID : OGV_SPM_ID);
    params.set('from_spm_id', fromSpmId());
  }
  const path = resource === 'subtitle' ? 'subtitle' : 'video/shot';
  return `https://api.bilibili.tv/intl/gateway/web/v2/${path}?${params.toString()}`;
}

async function apiData(url: string): Promise<unknown> {
  try {
    const response = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(2500) });
    if (!response.ok || (response.url && new URL(response.url).origin !== 'https://api.bilibili.tv')) return null;
    const body = await response.text();
    if (body.length > 512 * 1024) return null;
    const json = JSON.parse(body) as { code?: unknown; data?: unknown };
    return json.code === 0 ? json.data ?? null : null;
  } catch {
    return null;
  }
}

async function readShot(payload: unknown): Promise<BilibiliIntlStoryboard | null> {
  const binUrl = bilibiliIntlShotBinUrl((payload as { pv_data?: unknown } | null)?.pv_data);
  if (!binUrl) return parseBilibiliIntlStoryboard(payload, null);
  try {
    const response = await fetch(binUrl, { credentials: 'omit', signal: AbortSignal.timeout(2500) });
    if (!response.ok || (response.url && new URL(response.url).hostname !== 'pic.bstarstatic.com')) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > 64 * 1024) return null;
    return parseBilibiliIntlStoryboard(payload, parseBilibiliIntlShotIndex(new Uint8Array(buffer)));
  } catch {
    return null;
  }
}

function mediaStill(media: MediaRef, locale: string, path: string): boolean {
  if (!bilibiliIntlIntegrationEnabled() || apiSLocale() !== locale || locationPath() !== path) return false;
  const now = currentMedia();
  return now?.kind === media.kind && now.id === media.id;
}

export async function readBilibiliIntlSnapshot(): Promise<BilibiliIntlSnapshot | null> {
  if (!bilibiliIntlIntegrationEnabled() || !bilibiliIntlPathKind()) {
    cached = null;
    publishMedia(null);
    return null;
  }
  const media = currentMedia();
  if (!media) {
    publishMedia(null);
    return null;
  }
  publishMedia(media);
  const locale = apiSLocale();
  const path = locationPath();
  const cacheKey = `${path}|${media.kind}:${media.id}:${locale}`;
  if (cached?.key === cacheKey && cached.expires > Date.now()) return cached.pending;
  const title = bilibiliIntlTitle(pageState(), document.title, media.kind);
  const duration = pageDuration();
  const pending = Promise.all([
    apiData(metadataUrl(media, 'subtitle')),
    apiData(metadataUrl(media, 'shot')),
    media.kind === 'ogv' ? apiData(metadataUrl(media, 'episode')) : Promise.resolve(null)
  ]).then(async ([subtitles, shot, episode]) => {
    const storyboard = await readShot(shot);
    if (!mediaStill(media, locale, path)) {
      if (cached?.pending === pending) cached = null;
      return null;
    }
    const chapters = media.kind === 'ogv' ? parseBilibiliIntlSkipChapters(episode, duration) : [];
    const snapshot = normalizeBilibiliIntlSnapshot(media.id, title, duration, subtitles, storyboard, chapters, media.kind);
    if (cached?.pending === pending && snapshot.captionTracks.length === 0) {
      cached = { key: cacheKey, expires: Date.now() + 2000, pending };
    }
    return snapshot;
  });
  cached = { key: cacheKey, expires: Date.now() + 15000, pending };
  return pending;
}
