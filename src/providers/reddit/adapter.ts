import { sanitizeContentTitle } from '../../media-features/content-title';
import type { CaptionActivationResult, CaptionCue, CaptionTrack, MediaCapabilities, MediaFeaturesAdapter } from '../../media-features/types';
import type { ProviderServices } from '../provider-api';

import { mergeRedditCues, redditCaptionFile, type RedditCaptionFile } from './captions';
import { REDDIT_POST_ATTRIBUTES, readRedditPost, redditCaptionsEnabled, redditPlayerOf, type RedditPost } from './player';

type Services = Pick<ProviderServices['isolated'], 'requestPageFetch' | 'parseCaptionPayload'>;
type Current = { post: RedditPost; file: RedditCaptionFile; player: HTMLElement };

const FETCH_TIMEOUT_MS = 15_000;
const failed = (): CaptionActivationResult => ({ status: 'failed', delivery: 'none', cues: [] });

const trackId = ({ post, file }: Current): string => `reddit:${post.postId}:${file.url}`;

/**
 * Reddit's player (`shreddit-player`) names its post and caption file in attributes and draws the captions itself
 * from that file. The element's only text track is the empty subtitle rendition hls.js creates from the stream's
 * playlist, which never receives cues, so this adapter replaces the element's tracks with the caption file. Every
 * read goes to the live attributes: a client navigation can point the same player at another post, and a result
 * for a post the player no longer shows is dropped.
 *
 * Players name a caption file even for videos Reddit has no captions for (the file then answers 403), so the track
 * is listed only once its file has loaded. That one request per file also serves the activation.
 */
export class RedditAdapter implements MediaFeaturesAdapter {
  /** The current post's file: the request, then its cues (null when missing or empty). */
  private file: { url: string; request: Promise<CaptionCue[] | null>; cues?: CaptionCue[] | null } | null = null;
  private generation = 0;

  constructor(private readonly video: HTMLVideoElement | null, private readonly services: Services) {}

  private current(): Current | null {
    const player = this.video ? redditPlayerOf(this.video) : null;
    const post = player ? readRedditPost(player) : null;
    const file = redditCaptionFile(post?.captionUrl ?? null);
    return player && post && file ? { post, file, player } : null;
  }

  private load(url: string): Promise<CaptionCue[] | null> {
    if (this.file?.url === url) return this.file.request;
    const entry: NonNullable<RedditAdapter['file']> = {
      url,
      request: this.services.requestPageFetch(url, FETCH_TIMEOUT_MS).then(body => {
        const cues = body ? mergeRedditCues(this.services.parseCaptionPayload(body)) : [];
        entry.cues = cues.length > 0 ? cues : null;
        return entry.cues;
      }).catch(() => (entry.cues = null))
    };
    this.file = entry;
    return entry.request;
  }

  /** The current post's track, once its file has loaded with cues. */
  private track(current: Current | null): CaptionTrack | null {
    if (!current || this.file?.url !== current.file.url || !this.file.cues) return null;
    const { language } = current.file;
    // The empty hls.js rendition carries Reddit's own name for the language.
    const hostLabel = Array.from(this.video?.textTracks ?? []).find(track => track.language === language)?.label;
    return { id: trackId(current), language, label: hostLabel || language, kind: 'captions', source: 'reddit', delivery: 'overlay' };
  }

  replacesElementCaptions(): boolean {
    return Boolean(this.video && redditPlayerOf(this.video));
  }

  mediaId(): string | null {
    const player = this.video ? redditPlayerOf(this.video) : null;
    return (player && readRedditPost(player)?.postId) ?? null;
  }

  getTitle(): string | null {
    const player = this.video ? redditPlayerOf(this.video) : null;
    return sanitizeContentTitle(player ? readRedditPost(player)?.title : null);
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
    return { captions: (await this.listCaptionTracks()).length > 0, chapters: false, previews: false };
  }

  async listCaptionTracks(): Promise<CaptionTrack[]> {
    const current = this.current();
    if (!current) return [];
    await this.load(current.file.url);
    // Null when the player moved to another post meanwhile.
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
    if (!current || trackId(current) !== id) return failed();
    const cues = await this.load(current.file.url);
    // Another pick, or the player moving to another post, while the file loaded.
    const now = this.current();
    if (generation !== this.generation || !now || trackId(now) !== id || !cues) return failed();
    return { status: 'active', delivery: 'overlay', cues };
  }

  invalidate(): void {
    this.generation += 1;
    this.file = null;
  }

  dispose(): void {
    this.invalidate();
  }
}
