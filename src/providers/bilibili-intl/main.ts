import { isBilibiliIntlHost } from '../hosts';
import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import {
  bilibiliIntlEpisodeId,
  bilibiliIntlShotBinUrl,
  bilibiliIntlTitle,
  normalizeBilibiliIntlSnapshot,
  parseBilibiliIntlShotIndex,
  parseBilibiliIntlStoryboard,
  unwrapBilibiliIntlValue,
  type BilibiliIntlSnapshot,
  type BilibiliIntlStoryboard
} from '../../media-features/parsers/bilibili-intl';

export type { BilibiliIntlSnapshot } from '../../media-features/parsers/bilibili-intl';

const EPISODE_ATTR = 'data-te-bilibili-intl-episode';

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

/** OGV episode pages (`/{locale}/play/{season}`). User uploads live under `/video/` and are not implemented. */
export function bilibiliIntlOgvEpisodePath(pathname = locationPath()): boolean {
  if (!pathname || /\/video(?:\/|$)/i.test(pathname)) return false;
  return /^\/(?:[a-z]{2}(?:-[A-Za-z0-9]{2,8})?\/)?play\/\d{1,20}(?:\/|$)/.test(pathname);
}

export function bilibiliIntlRouteEpisodeId(pathname = locationPath()): string | null {
  const match = /^\/(?:[a-z]{2}(?:-[A-Za-z0-9]{2,8})?\/)?play\/\d{1,20}\/(\d{1,20})(?:\/|$)/.exec(pathname);
  return match ? bilibiliIntlEpisodeId(match[1]) : null;
}

export type BilibiliIntlLoadScope = {
  supported: boolean;
  path: string;
  routeEpisodeId: string | null;
};

/** Identity the content script can see before MAIN publishes an episode id. */
export function bilibiliIntlLoadScope(): BilibiliIntlLoadScope {
  const path = locationPath();
  return {
    supported: bilibiliIntlOgvEpisodePath(path) && bilibiliIntlIntegrationEnabled(),
    path,
    routeEpisodeId: bilibiliIntlRouteEpisodeId(path)
  };
}

function stateEpisodeId(): string | null {
  const root = unwrapBilibiliIntlValue(pageState());
  const ogv = unwrapBilibiliIntlValue(root && typeof root === 'object' ? (root as { ogv?: unknown }).ogv : undefined);
  const epId = ogv && typeof ogv === 'object' ? (ogv as { epId?: unknown }).epId : undefined;
  return bilibiliIntlEpisodeId(unwrapBilibiliIntlValue(epId));
}

export function bilibiliIntlPageId(): string | null {
  if (!bilibiliIntlOgvEpisodePath()) return null;
  // Page state wins in MAIN. The content script only sees the route and the attribute published below.
  const fromState = stateEpisodeId();
  if (fromState) return fromState;
  const fromRoute = bilibiliIntlRouteEpisodeId();
  const fromAttr = bilibiliIntlEpisodeId(document.documentElement?.getAttribute(EPISODE_ATTR));
  // A season URL has no episode segment. When the path names an episode, a different attribute is stale.
  if (fromRoute && fromAttr && fromRoute !== fromAttr) return fromRoute;
  return fromAttr || fromRoute;
}

function publishEpisode(id: string | null): void {
  const root = document.documentElement;
  if (!root) return;
  if (id) root.setAttribute(EPISODE_ATTR, id);
  else root.removeAttribute(EPISODE_ATTR);
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
 * Official metadata query. Subtitle matches the OGV player request
 * (`s_locale`, `platform`, `episode_id`, `spm_id`, `from_spm_id`).
 * Shot matches `ts().get("video/shot")` in `biliintl-player-dfb25af7.js`.
 */
function metadataUrl(path: 'subtitle' | 'video/shot', episodeId: string): string {
  const params = new URLSearchParams();
  params.set('s_locale', apiSLocale());
  params.set('platform', 'web');
  params.set('episode_id', episodeId);
  if (path === 'subtitle') {
    params.set('spm_id', OGV_SPM_ID);
    params.set('from_spm_id', fromSpmId());
  }
  return `https://api.bilibili.tv/intl/gateway/web/v2/${path}?${params.toString()}`;
}

async function apiData(path: 'subtitle' | 'video/shot', episodeId: string): Promise<unknown> {
  try {
    const response = await fetch(metadataUrl(path, episodeId), { credentials: 'omit', signal: AbortSignal.timeout(2500) });
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

export async function readBilibiliIntlSnapshot(): Promise<BilibiliIntlSnapshot | null> {
  if (!bilibiliIntlIntegrationEnabled() || !bilibiliIntlOgvEpisodePath()) {
    cached = null;
    publishEpisode(null);
    return null;
  }
  const episodeId = stateEpisodeId();
  if (!episodeId) {
    publishEpisode(null);
    return null;
  }
  publishEpisode(episodeId);
  const locale = apiSLocale();
  const cacheKey = `${episodeId}:${locale}`;
  if (cached?.key === cacheKey && cached.expires > Date.now()) return cached.pending;
  const title = bilibiliIntlTitle(pageState(), document.title);
  const duration = pageDuration();
  const pending = Promise.all([apiData('subtitle', episodeId), apiData('video/shot', episodeId)])
    .then(async ([subtitles, shot]) => {
      const storyboard = await readShot(shot);
      if (!bilibiliIntlIntegrationEnabled() || stateEpisodeId() !== episodeId || apiSLocale() !== locale) {
        if (cached?.pending === pending) cached = null;
        return null;
      }
      const snapshot = normalizeBilibiliIntlSnapshot(episodeId, title, duration, subtitles, storyboard);
      if (cached?.pending === pending && snapshot.captionTracks.length === 0) {
        cached = { key: cacheKey, expires: Date.now() + 2000, pending };
      }
      return snapshot;
    });
  cached = { key: cacheKey, expires: Date.now() + 15000, pending };
  return pending;
}
