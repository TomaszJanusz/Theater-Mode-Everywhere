import type { PlaylistAction } from '../../playlist-nav';
import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import {
  disneyPlayNextPublished,
  findDisneyPlayNextButton,
  requestDisneyPlayNext
} from '../disney/play-next';
import { isDisneyHost } from '../hosts';

const PLAY_ID = /\/play\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/**
 * Disney's control-bar next episode. The host unmounts that control whenever
 * its own bar hides, and keeps a second copy for the narrow layout. The step
 * stays up from the control Disney last offered, and the click asks that
 * control to play the next episode. End-of-title countdown and the end card
 * stay on the player-surface CTA.
 */
export function findDisneyPlaylistActions(root: ParentNode, href: () => string): PlaylistAction[] {
  if (!disneyNavEnabled()) return [];
  const doc = pageDocument(root);
  const playId = disneyPlayId(href());
  if (!doc || !playId) return [];
  const published = disneyPlayNextPublished(doc, playId);
  if (!findDisneyPlayNextButton(doc) && !published) return [];
  return [{
    direction: 'next',
    preview: null,
    restarts: false,
    activate() {
      if (!disneyNavEnabled() || disneyPlayId(href()) !== playId) return;
      if (requestDisneyPlayNext(playId)) return;
      findDisneyPlayNextButton(doc)?.click();
    }
  }];
}

function disneyNavEnabled(): boolean {
  try {
    return isDisneyHost() === true && mediaProviderIntegrationEnabled('disney') === true;
  } catch {
    return false;
  }
}

function disneyPlayId(href: string): string | null {
  try {
    const match = new URL(href, 'https://www.disneyplus.com').pathname.match(PLAY_ID);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

function pageDocument(root: ParentNode): Document | null {
  if ((root as Node).nodeType === 9) return root as Document;
  return (root as Node).ownerDocument || null;
}
