import type { AudioTrack, AudioTrackList } from '../../media-features/types';
import { observeProviderDom } from '../dom-watch';

import { iqiyiPlayId } from './page';

/**
 * iq.com lists an episode's audio in the player's own "Audio" menu, one item per language, with
 * the host's numeric language id as `data-player-hook` and `selected` on the playing one. Choosing
 * a track presses its item; the host loads the new stream itself, so its `selected` mark follows
 * several seconds later and the list is always read back from it.
 */
const ITEMS = '.iqp-pop-multitrack [data-player-hook="menulist"] .iqp-langlist-pop-txt';
const AD_BAR = '.iqp-player .ad-bar';
const AD_VIDEO = '.iqp-player .iqp-google-adcontainer video';

/** The host's numeric audio language ids seen on iq.com. Others are left untagged: labels name them. */
const LANGUAGES: Record<string, string> = { 1: 'zh', 143: 'pt', 152: 'es', 157: 'th', 161: 'vi' };

const ORIGINAL = /\((?:original|原声|原聲|原音|원본|オリジナル|asli|ต้นฉบับ|gốc)\)/i;

function menuItems(doc: Document): HTMLElement[] {
  return [...doc.querySelectorAll(ITEMS)].filter((item): item is HTMLElement => item instanceof HTMLElement);
}

function languageId(item: HTMLElement): string | null {
  const id = item.getAttribute('data-player-hook') ?? '';
  return /^\d{1,4}$/.test(id) ? id : null;
}

/** An advertisement plays in the same player: it shows its bar or paints its own video. */
function adPlaying(doc: Document): boolean {
  return [...doc.querySelectorAll(`${AD_BAR}, ${AD_VIDEO}`)].some((element) => element.getBoundingClientRect().height > 1);
}

function toTrack(item: HTMLElement): AudioTrack | null {
  const id = languageId(item);
  const label = (item.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!id || !label) return null;
  return { id, languageTag: LANGUAGES[id] ?? '', label, kind: ORIGINAL.test(label) ? 'original' : 'unknown', selected: item.classList.contains('selected') };
}

/** Null without a menu, so a page that offers no audio choice offers none here either. */
export function readIqiyiAudioTracks(doc: Document, pathname: string): AudioTrackList | null {
  const items = menuItems(doc);
  const tracks = items.flatMap((item) => toTrack(item) ?? []);
  return items.length && tracks.length ? { mediaId: iqiyiPlayId(pathname), tracks, blocked: adPlaying(doc) } : null;
}

/** Presses the item only for the episode the list was read for, outside an ad, while it is still offered. */
export function selectIqiyiAudioTrack(doc: Document, pathname: string, id: string, mediaId: string | null): boolean {
  if (!mediaId || iqiyiPlayId(pathname) !== mediaId || adPlaying(doc)) return false;
  const item = menuItems(doc).find((candidate) => languageId(candidate) === id);
  if (!item?.isConnected) return false;
  item.click();
  return true;
}

/** The menu is rebuilt per episode and its `selected` mark flips when the host finishes switching. */
export function observeIqiyiAudioTracks(doc: Document, onChange: () => void): () => void {
  return observeProviderDom({ root: doc, selector: '.iqp-pop-multitrack, .iqp-player .ad-bar', changed: onChange });
}
