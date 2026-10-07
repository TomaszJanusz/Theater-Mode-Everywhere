import type { PlaylistPreview } from '../../playlist-nav';
import { namedControl, type CollectedControl, type PlaylistNavigationHelpers } from './observed';

export const VIDEOJS_PLAYER_SELECTOR = '.video-js';

export function readVideoJsControls(root: ParentNode): CollectedControl[] {
  return [
    ...namedControl(root, 'button.vjs-previous-video', 'videojs', 'previous', () => videoJsDescribe),
    ...namedControl(root, 'button.vjs-next-video', 'videojs', 'next', () => videoJsDescribe)
  ];
}

function videoJsDescribe(context: Parameters<CollectedControl['describe']>[0]): ReturnType<CollectedControl['describe']> {
  return { preview: context.neighbors[context.direction], restarts: false };
}

export function peerTubeNeighborPreviews(
  root: ParentNode,
  pageHref: string,
  helpers: PlaylistNavigationHelpers
): { previous: PlaylistPreview | null; next: PlaylistPreview | null } {
  const current = playlistPosition(pageHref);
  if (current == null) return { previous: null, next: null };
  const items: Array<{ position: number; title: string; imageUrl: string }> = [];
  root.querySelectorAll('a.video-info-name').forEach((node) => {
    if (!(node instanceof HTMLAnchorElement)) return;
    const position = playlistPosition(node.getAttribute('href'));
    if (position == null) return;
    const imageUrl = thumbnailNear(node);
    if (!imageUrl) return;
    items.push({
      position,
      title: node.getAttribute('title') || node.textContent || '',
      imageUrl
    });
  });
  return helpers.neighborPreviews(items, current);
}

function playlistPosition(href: string | null | undefined): number | null {
  if (!href) return null;
  try {
    const value = Number(new URL(href, 'https://playlist.local').searchParams.get('playlistPosition'));
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function thumbnailNear(anchor: HTMLElement): string | null {
  let node: HTMLElement | null = anchor;
  for (let depth = 0; depth < 6 && node; depth += 1) {
    node = node.parentElement;
    if (!node) return null;
    if (node.querySelectorAll('a.video-info-name').length !== 1) continue;
    const image = [...node.querySelectorAll('img')].find((item) => (item.currentSrc || item.getAttribute('src') || '').trim());
    if (!image) continue;
    return image.currentSrc || image.getAttribute('src') || null;
  }
  return null;
}
