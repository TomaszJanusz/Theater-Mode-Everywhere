import { sanitizeContentTitle } from '../../media-features/content-title';
import type { CaptionActivationResult, CaptionCue, CaptionTrack, MediaCapabilities, MediaFeaturesAdapter } from '../../media-features/types';
import type { ProviderServices } from '../provider-api';

import { mergeRedditCues, redditCaptionFile, type RedditCaptionFile } from './captions';
import { REDDIT_POST_ATTRIBUTES, readRedditPost, redditCaptionsEnabled, redditPlayerOf, type RedditPost } from './player';

type Services = Pick<ProviderServices['isolated'], 'requestPageFetch' | 'parseCaptionPayload'>;
type Current = { post: RedditPost; file: RedditCaptionFile | null; player: HTMLElement };

const FETCH_TIMEOUT_MS = 15_000;
const failed = (): CaptionActivationResult => ({ status: 'failed', delivery: 'none', cues: [] });

const trackId = (post: RedditPost, file: RedditCaptionFile): string => `reddit:${post.postId}:${file.url}`;

/**
 * Reddit's player (`shreddit-player`) names its post and caption file in attributes and draws the captions itself
 * from that file. The element's only text track is the empty subtitle rendition hls.js creates from the stream's
 * playlist, which never receives cues, so this adapter replaces the element's tracks with the caption file. Every
 * read goes to the live attributes: a client navigation can point the same player at another post, and a result
 * for a post the player no longer shows is dropped.
 */
export class RedditAdapter implements MediaFeaturesAdapter {
  private cues: { url: string; cues: CaptionCue[] } | null = null;
  private generation = 0;

  constructor(private readonly video: HTMLVideoElement | null, private readonly services: Services) {}

  private current(): Current | null {
    const player = this.video ? redditPlayerOf(this.video) : null;
    const post = player ? readRedditPost(player) : null;
    return player && post ? { post, file: redditCaptionFile(post.captionUrl), player } : null;
  }

  private track(current: Current | null): CaptionTrack | null {
    if (!current?.file) return null;
    const { language } = current.file;
    // The empty hls.js rendition carries Reddit's own name for the language.
    const hostLabel = Array.from(this.video?.textTracks ?? []).find(track => track.language === language)?.label;
    return {
      id: trackId(current.post, current.file), language, label: hostLabel || language,
      kind: 'captions', source: 'reddit', delivery: 'overlay'
    };
  }

  replacesElementCaptions(): boolean {
    return Boolean(this.video && redditPlayerOf(this.video));
  }

  mediaId(): string | null {
    return this.current()?.post.postId ?? null;
  }

  getTitle(): string | null {
    return sanitizeContentTitle(this.current()?.post.title);
  }

  /** Reports the player being pointed at another post, or its title changing. */
  observeTitle(onChange: () => void): () => void {
    const player = this.video ? redditPlayerOf(this.video) : null;
    if (!player) return () => {};
    const observer = new MutationObserver(onChange);
    observer.observe(player, { attributes: true, attributeFilter: [...REDDIT_POST_ATTRIBUTES] });
    return () => observer.disconnect();
  }

  async probe(): Promise<MediaCapabilities> {
    return { captions: Boolean(this.track(this.current())), chapters: false, previews: false };
  }

  async listCaptionTracks(): Promise<CaptionTrack[]> {
    const track = this.track(this.current());
    return track ? [track] : [];
  }

  /** Reddit's own caption toggle, carried into the theater when no saved language applies. */
  hostCaptionTrack(): string | null {
    const current = this.current();
    return current && redditCaptionsEnabled(current.player) ? this.track(current)?.id ?? null : null;
  }

  async activateCaptionTrack(id: string | null): Promise<CaptionActivationResult> {
    const generation = ++this.generation;
    if (id === null) return { status: 'off', delivery: 'none', cues: [] };
    const current = this.current();
    if (!current?.file || this.track(current)?.id !== id) return failed();
    const { url } = current.file;
    if (this.cues?.url === url) return { status: 'active', delivery: 'overlay', cues: this.cues.cues };
    const body = await this.services.requestPageFetch(url, FETCH_TIMEOUT_MS);
    // Another pick, or the player moving to another post, while the file loaded.
    if (generation !== this.generation || this.track(this.current())?.id !== id) return failed();
    const cues = body ? mergeRedditCues(this.services.parseCaptionPayload(body)) : [];
    if (cues.length === 0) return failed();
    this.cues = { url, cues };
    return { status: 'active', delivery: 'overlay', cues };
  }

  invalidate(): void {
    this.generation += 1;
    this.cues = null;
  }

  dispose(): void {
    this.invalidate();
  }
}
