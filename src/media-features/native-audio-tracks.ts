import type { AudioTrack, AudioTrackKind, AudioTrackList } from './types';

/**
 * `HTMLMediaElement.audioTracks` ships in Safari; Chromium and Firefox keep it behind a flag
 * (AudioVideoTracks, `media.track.enabled`), and MSE players keep their tracks in their own
 * objects. Without the list, or with one track, the generic player offers nothing; it never
 * guesses from an unknown player's own menus.
 */
type NativeAudioTrack = { id: string; kind: string; label: string; language: string; enabled: boolean };
type NativeAudioTrackList = EventTarget & { readonly length: number; [index: number]: NativeAudioTrack | undefined };

const NATIVE_KINDS: Record<string, AudioTrackKind> = {
  main: 'original',
  translation: 'dub',
  description: 'description',
  'main-desc': 'description',
  commentary: 'commentary'
};

function nativeList(media: HTMLMediaElement): NativeAudioTrackList | null {
  const list = (media as HTMLMediaElement & { audioTracks?: unknown }).audioTracks;
  return list && typeof list === 'object' && typeof (list as NativeAudioTrackList).length === 'number'
    && typeof (list as NativeAudioTrackList).addEventListener === 'function' ? list as NativeAudioTrackList : null;
}

function nativeTracks(list: NativeAudioTrackList): NativeAudioTrack[] {
  const tracks: NativeAudioTrack[] = [];
  for (let index = 0; index < list.length; index++) {
    const track = list[index];
    if (track && typeof track.enabled === 'boolean') tracks.push(track);
  }
  return tracks;
}

/** Track ids may be empty or repeated outside their container, so the position is part of the id. */
function trackId(track: NativeAudioTrack, index: number): string {
  return `${index}:${typeof track.id === 'string' ? track.id.slice(0, 64) : ''}`;
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export function readNativeAudioTracks(media: HTMLMediaElement): AudioTrackList | null {
  const list = nativeList(media);
  if (!list) return null;
  const tracks: AudioTrack[] = nativeTracks(list).map((track, index) => ({
    id: trackId(track, index),
    languageTag: text(track.language, 35),
    label: text(track.label, 200),
    kind: NATIVE_KINDS[text(track.kind, 20)] ?? 'unknown',
    selected: track.enabled
  }));
  return { mediaId: media.currentSrc || null, tracks, blocked: false };
}

/** Enables only `id`, provided the element still plays `mediaId` and still lists that track. */
export function selectNativeAudioTrack(media: HTMLMediaElement, id: string, mediaId: string | null): boolean {
  const list = nativeList(media);
  if (!list || (media.currentSrc || null) !== mediaId) return false;
  const tracks = nativeTracks(list);
  const chosen = tracks.find((track, index) => trackId(track, index) === id);
  if (!chosen) return false;
  try {
    // Enable first so the element never has a moment without audio.
    chosen.enabled = true;
    for (const track of tracks) if (track !== chosen) track.enabled = false;
  } catch {
    return false;
  }
  return chosen.enabled;
}

export function observeNativeAudioTracks(media: HTMLMediaElement, onChange: () => void): () => void {
  const list = nativeList(media);
  if (!list) return () => {};
  const events = ['change', 'addtrack', 'removetrack'];
  for (const type of events) list.addEventListener(type, onChange);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    for (const type of events) list.removeEventListener(type, onChange);
  };
}
