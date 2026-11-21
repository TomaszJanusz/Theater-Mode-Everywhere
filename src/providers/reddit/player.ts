/** Reddit's web-component player (`shreddit-player`): the video and its controls live in its open shadow root. */
export const REDDIT_PLAYER = 'shreddit-player';
const MEDIA_UI = 'shreddit-media-ui';
const CAPTION_OVERLAY = 'shreddit-caption-overlay';
/** Present on the controls while Reddit's own captions are on; Reddit keeps the choice in its local storage. */
const CAPTIONS_ENABLED = 'captions-enabled';
/** Every attribute that names the post a player shows; a client navigation can rewrite them in place. */
export const REDDIT_POST_ATTRIBUTES = ['post-id', 'post-title', 'caption-url'] as const;

export type RedditPost = {
  /** Reddit's fullname of the post (`t3_…`), also for promoted posts. */
  postId: string;
  title: string | null;
  captionUrl: string | null;
};

/** The player whose shadow root holds `video`, or null for any other video on the page. */
export function redditPlayerOf(video: Element): HTMLElement | null {
  const root = video.getRootNode();
  const host = root instanceof ShadowRoot ? root.host : null;
  return host instanceof HTMLElement && host.localName === REDDIT_PLAYER ? host : null;
}

/** The post the player shows now, read from its attributes, with the enclosing post's as a fallback for the title. */
export function readRedditPost(player: Element): RedditPost | null {
  const postId = player.getAttribute('post-id')?.trim() ?? '';
  if (!/^t3_[a-z0-9]+$/i.test(postId)) return null;
  const post = player.closest('shreddit-post');
  const title = player.getAttribute('post-title') || (post?.id === postId ? post.getAttribute('post-title') : null);
  return { postId, title, captionUrl: player.getAttribute('caption-url') };
}

const mediaUi = (player: Element): Element | null => player.shadowRoot?.querySelector(MEDIA_UI) ?? null;

/** Whether Reddit's own caption toggle is on for this player. */
export function redditCaptionsEnabled(player: Element): boolean {
  return mediaUi(player)?.hasAttribute(CAPTIONS_ENABLED) ?? false;
}

/** Where Reddit draws its own captions, sized to the inline player box. */
export function redditCaptionOverlay(player: Element): HTMLElement | null {
  const overlay = mediaUi(player)?.shadowRoot?.querySelector(CAPTION_OVERLAY);
  return overlay instanceof HTMLElement ? overlay : null;
}
