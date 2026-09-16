import { parseCaptionPayload } from './parsers/captions';
import { parseYoutubeDescriptionChapters, parseYoutubeMarkerChapters } from './parsers/youtube-chapters';
import { heatmapSvgPath, readRenderedYoutubeHeatmapPath } from './parsers/youtube-heatmap-path';
import { getStoryboardFrame, parseStoryboardSpec, type StoryboardSet } from './parsers/youtube-storyboard';
import { PREVIEW_DISPLAY_WIDTH } from './preview-display';
import { isAllowedMediaFetchUrl, type MediaFetchRequest } from './fetch-allowlist';
import {
  normalizeYoutubePlayerResponse,
  readYoutubeSnapshotFromDom,
  requestMediaProbe,
  requestPageFetch,
  requestYoutubePlayerCaptions,
  type YoutubeCaptionMeta,
  type YoutubePlayerSnapshot
} from './probe';
import { firstMatchingYoutubeSnapshot, readPublishedYoutubeCaptionAuthUrls, readPublishedYoutubeSnapshot } from './youtube-snapshot';
import type {
  CaptionCue,
  CaptionTrack,
  Chapter,
  MediaCapabilities,
  MediaFeaturesAdapter,
  PreviewFrame,
  PreviewSource,
  TimelineHeatmap
} from './types';

const cueCache = new Map<string, CaptionCue[]>();

// Duplicated from youtube-caption-url.ts so content.js does not share that
// module with MAIN-world (Vite would emit an ESM chunk MV3 cannot import).
function youtubePageVideoId(href: string): string | null {
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

function youtubeSnapshotMatchesPage(snapshotVideoId: string | undefined, pageVideoId: string | null): boolean {
  if (!snapshotVideoId || !pageVideoId) return true;
  return snapshotVideoId === pageVideoId;
}

const CAPTION_AUTH_KEYS = [
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

function timedtextVideoId(url: string): string | null {
  try {
    return new URL(url, 'https://www.youtube.com').searchParams.get('v');
  } catch {
    return null;
  }
}

function timedtextHasPot(url: string): boolean {
  try {
    return Boolean(new URL(url, 'https://www.youtube.com').searchParams.get('pot'));
  } catch {
    return false;
  }
}

function mergeYoutubeCaptionAuth(targetUrl: string, sourceUrl: string): string {
  try {
    const target = new URL(targetUrl, 'https://www.youtube.com');
    const source = new URL(sourceUrl, 'https://www.youtube.com');
    for (const key of CAPTION_AUTH_KEYS) {
      const value = source.searchParams.get(key);
      if (value) target.searchParams.set(key, value);
    }
    return target.toString();
  } catch {
    return targetUrl;
  }
}

function signYoutubeCaptionUrl(targetUrl: string, sourceUrls: string[]): string {
  const targetId = timedtextVideoId(targetUrl);
  for (const source of sourceUrls) {
    if (!timedtextHasPot(source)) continue;
    const sourceId = timedtextVideoId(source);
    if (targetId) {
      if (sourceId !== targetId) continue;
    } else if (sourceId) {
      continue;
    }
    return mergeYoutubeCaptionAuth(targetUrl, source);
  }
  return targetUrl;
}

function looksLikeHtmlError(body: string): boolean {
  const start = body.trim().slice(0, 80).toLowerCase();
  return start.startsWith('<!doctype') || start.startsWith('<html');
}

function usableCaptionBody(body: string | null | undefined): string | null {
  if (!body || !body.trim() || looksLikeHtmlError(body)) return null;
  return body;
}

function withFmt(url: string, fmt: string | null): string {
  try {
    const parsed = new URL(url, window.location.href);
    if (fmt) parsed.searchParams.set('fmt', fmt);
    else parsed.searchParams.delete('fmt');
    return parsed.toString();
  } catch {
    return url;
  }
}

function captionUrlVariants(baseUrl: string): string[] {
  const variants: string[] = [];
  const seen = new Set<string>();
  const add = (url: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    variants.push(url);
  };
  add(withFmt(baseUrl, 'json3'));
  add(baseUrl);
  add(withFmt(baseUrl, 'vtt'));
  add(withFmt(baseUrl, 'srv3'));
  add(withFmt(baseUrl, null));
  return variants;
}

async function fetchCaptionTrack(url: string): Promise<string | null> {
  let absolute = url;
  try {
    absolute = new URL(url, window.location.href).toString();
  } catch {
    return null;
  }
  absolute = signYoutubeCaptionUrl(absolute, readPublishedYoutubeCaptionAuthUrls());
  const request: MediaFetchRequest = {
    provider: 'youtube',
    kind: 'caption-track',
    url: absolute
  };
  if (!isAllowedMediaFetchUrl(request)) return null;

  const fromPage = usableCaptionBody(await requestPageFetch(absolute, 15000));
  if (fromPage) return fromPage;

  try {
    const response = await fetch(absolute, { credentials: 'include' });
    if (response.ok) {
      const text = usableCaptionBody(await response.text());
      if (text) return text;
    }
  } catch {
    // Fall through to the extension broker when page CORS blocks the request.
  }

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'theater-fetch-media',
      ...request
    });
    const body = typeof result?.body === 'string' ? usableCaptionBody(result.body) : null;
    if (result?.ok && body) return body;
  } catch {
    return null;
  }
  return null;
}

export class YouTubeAdapter implements MediaFeaturesAdapter {
  private snapshot: YoutubePlayerSnapshot | null = null;
  private storyboards: StoryboardSet | null = null;
  private tracks: YoutubeCaptionMeta[] = [];
  private lastVideoId: string | null = null;

  async load(): Promise<void> {
    const previousId = this.lastVideoId;
    const probed = await requestMediaProbe();
    const pageVideoId = youtubePageVideoId(window.location.href);
    const boot = (window as unknown as { ytInitialPlayerResponse?: unknown }).ytInitialPlayerResponse;
    this.snapshot = firstMatchingYoutubeSnapshot(pageVideoId, [
      probed.youtube,
      readPublishedYoutubeSnapshot(),
      readYoutubeSnapshotFromDom(),
      boot ? normalizeYoutubePlayerResponse(boot) : null
    ]);
    if (this.snapshot?.videoId) this.lastVideoId = this.snapshot.videoId;
    if (previousId && this.snapshot?.videoId && previousId !== this.snapshot.videoId) {
      cueCache.clear();
    }
    this.tracks = this.snapshot?.captionTracks || [];
    const spec = this.snapshot?.storyboardSpec;
    this.storyboards = spec
      ? parseStoryboardSpec(spec, this.snapshot?.duration || 0)
      : null;
  }

  async reload(): Promise<void> {
    this.snapshot = null;
    this.storyboards = null;
    this.tracks = [];
    const pageId = youtubePageVideoId(window.location.href);
    for (let attempt = 0; attempt < 6; attempt++) {
      await this.load();
      if (!pageId || this.mediaId() === pageId) return;
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 120 + attempt * 140);
      });
    }
  }

  invalidate(): void {
    this.snapshot = null;
    this.storyboards = null;
    this.tracks = [];
    cueCache.clear();
  }

  mediaId(): string | null {
    return this.snapshot?.videoId || null;
  }

  private snapshotMatchesPage(): boolean {
    return youtubeSnapshotMatchesPage(this.snapshot?.videoId, youtubePageVideoId(window.location.href));
  }

  async probe(): Promise<MediaCapabilities> {
    if (!this.snapshot) await this.load();
    const chapters = await this.getChapters();
    return {
      captions: this.tracks.length > 0,
      chapters: chapters.length > 0,
      previews: Boolean(this.storyboards)
    };
  }

  async listCaptionTracks(): Promise<CaptionTrack[]> {
    if (!this.snapshot) await this.load();
    return this.tracks.map((track) => ({
      id: track.id,
      language: track.language,
      label: track.label,
      kind: track.kind,
      source: 'youtube',
      autoGenerated: track.autoGenerated
    }));
  }

  async activateCaptionTrack(id: string | null): Promise<CaptionCue[] | null> {
    if (id === null) {
      await requestYoutubePlayerCaptions({ enabled: false });
      return null;
    }
    if (!this.snapshot) await this.load();
    if (!this.snapshotMatchesPage()) await this.reload();
    const track = this.tracks.find((item) => item.id === id);
    if (!track) return null;
    const fetchUrl = signYoutubeCaptionUrl(track.baseUrl, readPublishedYoutubeCaptionAuthUrls());
    const cached = cueCache.get(track.baseUrl) || cueCache.get(fetchUrl);
    if (cached && cached.length > 0 && this.snapshotMatchesPage()) {
      await requestYoutubePlayerCaptions({ enabled: false });
      return cached;
    }

    for (const url of captionUrlVariants(fetchUrl)) {
      const body = await fetchCaptionTrack(url);
      if (!body) continue;
      const cues = parseCaptionPayload(body);
      if (cues.length > 0) {
        cueCache.set(track.baseUrl, cues);
        cueCache.set(fetchUrl, cues);
        await requestYoutubePlayerCaptions({ enabled: false });
        return cues;
      }
    }
    return [];
  }

  async getChapters(): Promise<Chapter[]> {
    if (!this.snapshot) await this.load();
    const duration = this.snapshot?.duration;
    const fromDescription = parseYoutubeDescriptionChapters(this.snapshot?.description || '', duration);
    if (fromDescription.length > 0) return fromDescription;
    return parseYoutubeMarkerChapters(this.snapshot?.markers || [], duration);
  }

  getHeatmap(): TimelineHeatmap | null {
    if (this.snapshotMatchesPage()) {
      const stored = this.snapshot?.heatmap;
      if (stored?.segments && stored.segments.length > 0) {
        const durationMs = (this.snapshot?.duration || 0) * 1000;
        const svgPath = heatmapSvgPath(stored.segments, durationMs || undefined);
        if (svgPath) return { source: stored.source, segments: stored.segments, svgPath };
      }
      if (stored?.svgPath) return stored;
    }
    const svgPath = readRenderedYoutubeHeatmapPath();
    return svgPath ? { source: 'svg', svgPath } : null;
  }

  async getPreviewSource(): Promise<PreviewSource> {
    if (!this.snapshot) await this.load();
    return this.storyboards
      ? { kind: 'sprite', provider: 'youtube' }
      : { kind: 'none', reason: 'no-storyboard' };
  }

  getPreviewFrame(time: number, _duration: number): PreviewFrame | null {
    if (!this.storyboards || !this.snapshotMatchesPage()) return null;
    const targetWidth = Math.round(PREVIEW_DISPLAY_WIDTH * (window.devicePixelRatio || 1));
    return getStoryboardFrame(this.storyboards, time, targetWidth);
  }

  dispose(): void {
    this.snapshot = null;
    this.storyboards = null;
    this.tracks = [];
  }
}

export { isYouTubeHost } from '../providers/hosts';
