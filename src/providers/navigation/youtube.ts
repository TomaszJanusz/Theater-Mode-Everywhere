import type { PlaylistAction, PlaylistDirection } from '../../playlist-nav';
import { isYouTubeHost } from '../hosts';
import { queryYouTubeQueue, requestYouTubeQueueStep } from '../youtube/queue-bridge';
import { namedControl, type CollectedControl, type PlaylistNavigationHelpers } from './observed';

export const YOUTUBE_PLAYER_SELECTOR = '#movie_player';

/** Queue actions claim each resolved direction, including a confirmed end. */
export function findYouTubeQueueNavigation(
  root: ParentNode,
  video: HTMLVideoElement | null | undefined,
  helpers: PlaylistNavigationHelpers
): { actions: PlaylistAction[]; claimed: Set<PlaylistDirection> } {
  const actions: PlaylistAction[] = [];
  const claimed = new Set<PlaylistDirection>();
  const doc = (root as Node).nodeType === 9 ? root as Document : (root as Node).ownerDocument;
  if (!doc?.defaultView || !isYouTubeHost(doc.defaultView.location.hostname)) return { actions, claimed };
  const player = doc.getElementById('movie_player');
  if (!player || (video && !player.contains(video)) || !(root as Node).contains(player)) return { actions, claimed };
  const queue = queryYouTubeQueue(doc);
  if (!queue) return { actions, claimed };
  for (const direction of ['previous', 'next'] as const) {
    const step = queue[direction];
    if (step.kind === 'unknown') continue;
    claimed.add(direction);
    if (step.kind !== 'item') continue;
    actions.push({
      direction,
      preview: helpers.sanitizePreview(step.title, step.imageUrl),
      restarts: false,
      activate() {
        if (!player.isConnected || (video && !player.contains(video))) return;
        // MAIN revalidates the exact queue occurrence and clicks its current link.
        requestYouTubeQueueStep(doc, step.key);
      }
    });
  }
  return { actions, claimed };
}

/** YouTube drops the previous-item preview when that button will restart the current video. */
export function youtubePreviousRestarts(element: { getAttribute(name: string): string | null }): boolean {
  const image = element.getAttribute('data-preview')?.trim() || '';
  const title = element.getAttribute('data-tooltip-text')?.trim() || '';
  return !image || !title;
}

export function readYouTubeControls(root: ParentNode): CollectedControl[] {
  return [
    ...namedControl(root, '.ytp-prev-button', 'youtube', 'previous', youtubeDescribe),
    ...namedControl(root, '.ytp-next-button', 'youtube', 'next', youtubeDescribe)
  ];
}

function youtubeDescribe(element: HTMLElement): CollectedControl['describe'] {
  return (context) => {
    const restarts = context.direction === 'previous' && youtubePreviousRestarts(element);
    const preview = context.helpers.sanitizePreview(
      element.getAttribute('data-tooltip-text') || '',
      element.getAttribute('data-preview') || ''
    );
    return { preview: restarts ? null : preview, restarts };
  };
}
