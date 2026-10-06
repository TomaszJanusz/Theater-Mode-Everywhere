import { findProviderPlaylistActions } from './providers/navigation/factory';

export type PlaylistDirection = 'previous' | 'next';

export type PlaylistPreview = {
  title: string;
  imageUrl: string;
};

export type PlaylistNavState = {
  previous: boolean;
  next: boolean;
  /** The previous control restarts the current item instead of stepping back. */
  previousRestarts: boolean;
  previousPreview: PlaylistPreview | null;
  nextPreview: PlaylistPreview | null;
};

export type PlaylistAction = {
  direction: PlaylistDirection;
  activate: () => void;
  preview: PlaylistPreview | null;
  /** The host previous control will restart the current item instead of stepping back. */
  restarts?: boolean;
};

export function emptyPlaylistNav(): PlaylistNavState {
  return { previous: false, next: false, previousRestarts: false, previousPreview: null, nextPreview: null };
}

export function sanitizePlaylistPreview(title: string, imageUrl: string): PlaylistPreview | null {
  const cleanTitle = title.replace(/\s+/g, ' ').trim();
  if (!cleanTitle || cleanTitle.length > 180) return null;
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.href.length > 2000) return null;
  return { title: cleanTitle, imageUrl: url.href };
}

export function neighborPreviews(
  items: Array<{ position: number; title: string; imageUrl: string }>,
  currentPosition: number
): { previous: PlaylistPreview | null; next: PlaylistPreview | null } {
  const byPosition = new Map<number, PlaylistPreview>();
  for (const item of items) {
    if (byPosition.has(item.position)) continue;
    const preview = sanitizePlaylistPreview(item.title, item.imageUrl);
    if (preview) byPosition.set(item.position, preview);
  }
  return {
    previous: byPosition.get(currentPosition - 1) ?? null,
    next: byPosition.get(currentPosition + 1) ?? null
  };
}

export function playlistNavStateFromActions(actions: PlaylistAction[]): PlaylistNavState {
  const previous = actions.find((action) => action.direction === 'previous');
  const next = actions.find((action) => action.direction === 'next');
  return {
    previous: Boolean(previous),
    next: Boolean(next),
    previousRestarts: Boolean(previous?.restarts),
    previousPreview: previous?.restarts ? null : (previous?.preview ?? null),
    nextPreview: next?.preview ?? null
  };
}

/** Site DOM, selectors, and preview rules live in the provider navigation factory. */
export function findPlaylistActions(root: ParentNode, video?: HTMLVideoElement | null): PlaylistAction[] {
  return findProviderPlaylistActions(root, video, {
    sanitizePreview: sanitizePlaylistPreview,
    neighborPreviews
  });
}
