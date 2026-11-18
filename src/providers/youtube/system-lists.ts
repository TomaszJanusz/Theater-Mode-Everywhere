import { translateMessage } from '../../i18n-runtime';

/** Provider-only fallbacks: these bytes never join content.js. */
const FALLBACKS: Record<string, string> = {
  playlistQueue: 'Queue',
  playlistWatchLater: 'Watch later',
  playlistLikedVideos: 'Liked videos',
  playlistChannelUploads: 'Uploads',
  playlistChannelVideos: 'Videos'
};

/**
 * The message key for a list YouTube makes itself, recognised by its id: YouTube names these lists in its own interface
 * language ("Kolejka", "Do obejrzenia"), so the panel names them in ours instead. Ids are YouTube's fixed forms: the
 * session queue (`TL…`, as queue navigation treats it), Watch later, Liked videos, and a channel's uploads (`UU` and its
 * 22-character channel id) and its long-form videos (`UULF`). Playlists people make and mixes keep the title YouTube
 * gives them: that is their content.
 */
export function systemListTitleKey(listId: string): string | null {
  if (listId === 'WL') return 'playlistWatchLater';
  if (listId === 'LL') return 'playlistLikedVideos';
  if (/^TL[\w-]+$/.test(listId)) return 'playlistQueue';
  if (/^UULF[\w-]{22}$/.test(listId)) return 'playlistChannelVideos';
  if (/^UU[\w-]{22}$/.test(listId)) return 'playlistChannelUploads';
  return null;
}

export function systemListTitle(listId: string): string | null {
  const key = systemListTitleKey(listId);
  return key && translateMessage(FALLBACKS, key);
}
