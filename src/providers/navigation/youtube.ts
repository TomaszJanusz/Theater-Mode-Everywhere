import { namedControl, type CollectedControl } from './observed';

export const YOUTUBE_PLAYER_SELECTOR = '#movie_player';

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
