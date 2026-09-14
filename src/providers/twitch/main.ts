import { MAX_CAPTION_BYTES } from '../../platform/media-url-policy';
import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { isTwitchHost } from '../hosts';

export function twitchIntegrationEnabled(): boolean {
  return mediaProviderIntegrationEnabled('twitch');
}

type TwitchHarvest = {
  videoId?: string;
  duration?: number;
  seekPreviewsURL?: string;
  moments: Array<{ startTime: number; endTime?: number; title: string }>;
};

let twitchHarvest: TwitchHarvest = { moments: [] };
let twitchHarvestNotifyTimer = 0;

function twitchPageVideoId(href: string): string | null {
  try {
    const url = new URL(href, 'https://www.twitch.tv');
    if (!isTwitchHost(url.hostname)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const videoIndex = parts.findIndex((part) => part === 'videos' || part === 'video');
    if (videoIndex >= 0 && parts[videoIndex + 1]) {
      const id = parts[videoIndex + 1].replace(/^v/i, '').replace(/[^\d].*$/, '');
      return id || null;
    }
    const queryVideo = url.searchParams.get('video') || url.searchParams.get('vod');
    if (!queryVideo) return null;
    const id = queryVideo.replace(/^v/i, '').replace(/[^\d].*$/, '');
    return id || null;
  } catch {
    return null;
  }
}

export function isAllowedTwitchStoryboardUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const hostOk = host === 'vod-secure.twitch.tv'
      || host === 'vod-storyboards.twitch.tv'
      || host === 'static-cdn.jtvnw.net'
      || /^d[a-z0-9]{6,}\.cloudfront\.net$/i.test(host);
    return hostOk && /\/storyboards\/[^/?#]*info\.json$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function canonicalizeTwitchStoryboardUrl(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.href);
    parsed.hash = '';
    if (!isAllowedTwitchStoryboardUrl(parsed.toString())) return null;
    return parsed.toString().slice(0, 2000);
  } catch {
    return null;
  }
}

function publishTwitchHarvest(): void {
  const payload = JSON.stringify({
    videoId: twitchHarvest.videoId || '',
    duration: twitchHarvest.duration || '',
    seekPreviewsURL: twitchHarvest.seekPreviewsURL || '',
    moments: twitchHarvest.moments
  });
  let node = document.getElementById('theater-everywhere-twitch-harvest');
  if (!node) {
    node = document.createElement('div');
    node.id = 'theater-everywhere-twitch-harvest';
    node.hidden = true;
    document.documentElement.appendChild(node);
  }
  if (node.textContent !== payload) node.textContent = payload;
}

function notifyTwitchHarvest(): void {
  publishTwitchHarvest();
  if (twitchHarvestNotifyTimer) return;
  twitchHarvestNotifyTimer = window.setTimeout(() => {
    twitchHarvestNotifyTimer = 0;
    window.dispatchEvent(new CustomEvent('theater-everywhere-twitch-harvest'));
  }, 80);
}

export function rememberTwitchStoryboardUrl(url: string): void {
  const canonical = canonicalizeTwitchStoryboardUrl(url);
  if (!canonical) return;
  const videoId = twitchPageVideoId(window.location.href);
  if (videoId && twitchHarvest.videoId && twitchHarvest.videoId !== videoId) {
    twitchHarvest = { videoId, moments: [] };
  }
  const changed = twitchHarvest.seekPreviewsURL !== canonical;
  twitchHarvest.seekPreviewsURL = canonical;
  if (videoId) twitchHarvest.videoId = videoId;
  if (changed) notifyTwitchHarvest();
}

function readTwitchMoment(item: Record<string, unknown>): { startTime: number; endTime?: number; title: string } | null {
  const startMs = Number(item.positionMilliseconds);
  const details = item.details && typeof item.details === 'object' ? item.details as Record<string, unknown> : null;
  const game = details?.game && typeof details.game === 'object' ? details.game as Record<string, unknown> : null;
  const title = [
    item.description,
    item.subDescription,
    item.name,
    item.title,
    game?.displayName
  ].find((value) => typeof value === 'string' && String(value).trim());
  if (!Number.isFinite(startMs) || startMs < 0 || typeof title !== 'string' || !title.trim()) return null;
  const durationMs = Number(item.durationMilliseconds);
  return {
    startTime: startMs / 1000,
    endTime: Number.isFinite(durationMs) ? startMs / 1000 + durationMs / 1000 : undefined,
    title: title.trim().slice(0, 120)
  };
}

function addTwitchHarvestMoment(moment: { startTime: number; endTime?: number; title: string }): boolean {
  const key = `${moment.startTime}:${moment.title}`;
  if (twitchHarvest.moments.some((entry) => `${entry.startTime}:${entry.title}` === key)) return false;
  twitchHarvest.moments.push(moment);
  twitchHarvest.moments.sort((left, right) => left.startTime - right.startTime);
  return true;
}

export function harvestTwitchGqlBody(body: string): void {
  if (!body || body.length > MAX_CAPTION_BYTES) return;
  if (!/"seekPreviewsURL"|"positionMilliseconds"|"lengthSeconds"|"moments"/.test(body.slice(0, 200000))) return;
  if (window !== window.top) {
    try {
      window.top!.postMessage({ type: 'theater-everywhere-twitch-harvest-body', body }, '*');
    } catch {
      // Cross-origin parent frames cannot receive harvest copies.
    }
  }
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return;
  }
  const videoId = twitchPageVideoId(window.location.href);
  if (videoId && twitchHarvest.videoId && twitchHarvest.videoId !== videoId) {
    twitchHarvest = { videoId, moments: [] };
  }
  if (videoId) twitchHarvest.videoId = videoId;
  let changed = false;
  let budget = 4000;
  const walk = (node: unknown, depth: number) => {
    if (budget <= 0 || node == null || depth > 12) return;
    budget -= 1;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const id = record.id != null ? String(record.id).replace(/^v/i, '') : '';
    const idMatchesVideo = !videoId || !id || id === videoId;
    if (idMatchesVideo && typeof record.seekPreviewsURL === 'string') {
      const before = twitchHarvest.seekPreviewsURL;
      rememberTwitchStoryboardUrl(record.seekPreviewsURL);
      if (twitchHarvest.seekPreviewsURL !== before) changed = true;
    }
    if (idMatchesVideo) {
      const length = Number(record.lengthSeconds ?? record.length);
      if (Number.isFinite(length) && length > 0) twitchHarvest.duration = length;
    }
    const moment = readTwitchMoment(record);
    if (moment && addTwitchHarvestMoment(moment)) changed = true;
    const momentSource = Array.isArray(record.moments)
      ? record.moments
      : Array.isArray((record.moments as { edges?: unknown[] } | undefined)?.edges)
        ? ((record.moments as { edges: Array<{ node?: Record<string, unknown> }> }).edges
            .map((edge) => edge?.node)
            .filter(Boolean) as Record<string, unknown>[])
        : [];
    for (const entry of momentSource) {
      if (!entry || typeof entry !== 'object') continue;
      const parsed = readTwitchMoment(entry as Record<string, unknown>);
      if (parsed && addTwitchHarvestMoment(parsed)) changed = true;
      if (twitchHarvest.moments.length >= 80) break;
    }
    for (const value of Object.values(record)) walk(value, depth + 1);
  };
  try {
    walk(data, 0);
  } catch {
    // Ignore malformed GraphQL trees.
  }
  publishTwitchHarvest();
  if (changed) notifyTwitchHarvest();
}

export function captureTwitchNetworkResponse(url: string, response: Response): void {
  if (!twitchIntegrationEnabled()) return;
  const finalUrl = (response && response.url) || url;
  if (response && response.ok && isAllowedTwitchStoryboardUrl(finalUrl)) {
    rememberTwitchStoryboardUrl(finalUrl);
  }
  if (!response || !response.ok) return;
  if (!/gql\.twitch\.tv/i.test(finalUrl) && !/gql\.twitch\.tv/i.test(url)) return;
  response.clone().text().then((text) => harvestTwitchGqlBody(text)).catch(() => {});
}

export function harvestTwitchResponseJson(url: string, data: unknown): void {
  if (!twitchIntegrationEnabled() || !/gql\.twitch\.tv/i.test(url)) return;
  harvestTwitchGqlBody(JSON.stringify(data));
}

export function harvestTwitchResponseText(url: string, text: string): void {
  if (!twitchIntegrationEnabled()) return;
  if (!(/gql\.twitch\.tv/i.test(url) || /"positionMilliseconds"|"seekPreviewsURL"/.test(text.slice(0, 4000)))) return;
  if (isTwitchHost(window.location.hostname) || /gql\.twitch\.tv/i.test(url)) {
    harvestTwitchGqlBody(text);
  }
}

export function harvestTwitchXhr(url: string, body: string | null, xhr: XMLHttpRequest): void {
  if (body && /gql\.twitch\.tv/i.test(url)) harvestTwitchGqlBody(body);
  if (isAllowedTwitchStoryboardUrl(url)) rememberTwitchStoryboardUrl(url);
  if (!body && /gql\.twitch\.tv/i.test(url) && xhr.responseType === 'blob' && xhr.response instanceof Blob) {
    xhr.response.text().then((text) => harvestTwitchGqlBody(text)).catch(() => {});
  }
}

export function readTwitchSnapshot(): Record<string, unknown> | null {
  try {
    if (!isTwitchHost(window.location.hostname)) return null;
    const videoId = twitchPageVideoId(window.location.href);
    if (!videoId) return { videoId: undefined };
    if (twitchHarvest.videoId && twitchHarvest.videoId !== videoId) {
      twitchHarvest = { videoId, moments: [] };
    }
    const urls: string[] = [];
    const seenUrls = new Set<string>();
    const addUrl = (raw?: string | null) => {
      if (!raw) return;
      const canonical = canonicalizeTwitchStoryboardUrl(raw);
      if (!canonical || seenUrls.has(canonical)) return;
      seenUrls.add(canonical);
      urls.push(canonical);
    };
    addUrl(twitchHarvest.seekPreviewsURL);
    try {
      for (const entry of performance.getEntriesByType('resource')) {
        addUrl((entry as PerformanceResourceTiming).name);
      }
    } catch {
      // performance timeline may be unavailable.
    }
    const seekPreviewsURL = urls.find((url) => url.includes(videoId)) || urls[0];
    return {
      videoId,
      duration: twitchHarvest.duration,
      seekPreviewsURL,
      moments: [...twitchHarvest.moments],
      captionTracks: []
    };
  } catch {
    return null;
  }
}

export function installTwitchMain(): void {
  window.addEventListener('message', (event: MessageEvent) => {
    if (window !== window.top) return;
    const data = event.data;
    if (data && data.type === 'theater-everywhere-twitch-harvest-body' && typeof data.body === 'string') {
      try {
        if (!isTwitchHost(new URL(event.origin).hostname)) return;
      } catch {
        return;
      }
      harvestTwitchGqlBody(data.body);
    }
  });
}
