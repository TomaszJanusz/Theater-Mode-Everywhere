import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import {
  parseYouTubeAudioSelect,
  YOUTUBE_AUDIO_CHANGE,
  YOUTUBE_AUDIO_PLAYER_ID,
  YOUTUBE_AUDIO_QUERY,
  YOUTUBE_AUDIO_RESULT,
  YOUTUBE_AUDIO_SELECT,
  YOUTUBE_AUDIO_SNAPSHOT,
  youtubeAudioTrackKey,
  type YouTubeAudioRecord
} from '../../media-features/youtube-audio-tracks';
import { publishHiddenJson } from '../../platform/hidden-json';
import { isYouTubeHost } from '../hosts';

type HostTrack = {
  id?: unknown;
  toString(): string;
  getLanguageInfo?: () => { id?: unknown } | null | undefined;
  isAutoDubbed?: () => unknown;
};
type AudioPlayer = HTMLElement & {
  getVideoData?: () => { video_id?: unknown } | null | undefined;
  getAvailableAudioTracks?: () => unknown;
  getAudioTrack?: () => HostTrack | null | undefined;
  setAudioTrack?: (track: HostTrack) => unknown;
  addEventListener(type: string, listener: () => void): void;
};

/** Events the player emits when its tracks, its selection or its ad state may have changed. */
const PLAYER_EVENTS = ['onPlaybackAudioChange', 'onStateChange', 'videodatachange'];

const listened = new WeakSet<Element>();
let installed = false;

function player(): AudioPlayer | null {
  const element = document.getElementById(YOUTUBE_AUDIO_PLAYER_ID) as AudioPlayer | null;
  return element && typeof element.getAvailableAudioTracks === 'function' ? element : null;
}

/** Ads play in the same player and list no tracks or the content's, whose selection they discard. */
const showingAd = (element: Element) => element.matches('.ad-showing, .ad-interrupting');

function hostTracks(element: AudioPlayer): HostTrack[] {
  const tracks = element.getAvailableAudioTracks?.();
  return Array.isArray(tracks) ? tracks.filter((track): track is HostTrack => Boolean(track) && typeof track === 'object') : [];
}

function record(track: HostTrack, selectedId: unknown): YouTubeAudioRecord | null {
  const id = track.id;
  if (typeof id !== 'string' || !id) return null;
  const languageId = track.getLanguageInfo?.()?.id;
  return {
    id,
    label: String(track).slice(0, 200),
    languageId: typeof languageId === 'string' ? languageId.slice(0, 40) : '',
    autoDubbed: track.isAutoDubbed?.() === true,
    selected: id === selectedId
  };
}

function videoId(element: AudioPlayer): string | null {
  const id = element.getVideoData?.()?.video_id;
  return typeof id === 'string' && /^[\w-]{11}$/.test(id) ? id : null;
}

/** The player is long-lived across SPA navigation; listen once per element, ping only while enabled. */
function listen(element: AudioPlayer): void {
  if (listened.has(element)) return;
  listened.add(element);
  const ping = () => {
    if (mediaProviderIntegrationEnabled('youtube')) window.dispatchEvent(new CustomEvent(YOUTUBE_AUDIO_CHANGE));
  };
  for (const type of PLAYER_EVENTS) {
    try { element.addEventListener(type, ping); } catch { /* An older player lacks the event. */ }
  }
}

function snapshot(requestId: string): Record<string, unknown> | null {
  if (!mediaProviderIntegrationEnabled('youtube')) return null;
  const element = player();
  const id = element && videoId(element);
  if (!element || !id) return null;
  listen(element);
  const selectedId = element.getAudioTrack?.()?.id;
  const tracks = hostTracks(element).flatMap(track => record(track, selectedId) ?? []);
  return { requestId, pageHref: window.location.href, videoId: id, ad: showingAd(element), tracks };
}

function select(raw: unknown): void {
  const request = parseYouTubeAudioSelect(raw);
  if (!request) return;
  let ok = false;
  const element = player();
  // Revalidate everything the isolated world saw: integration, content identity, no ad, same track.
  if (mediaProviderIntegrationEnabled('youtube') && element && videoId(element) === request.videoId && !showingAd(element)) {
    const selectedId = element.getAudioTrack?.()?.id;
    const track = hostTracks(element).find(candidate => {
      const fields = record(candidate, selectedId);
      return fields !== null && youtubeAudioTrackKey(fields) === request.trackId;
    });
    if (track) {
      element.setAudioTrack?.(track);
      ok = element.getAudioTrack?.()?.id === track.id;
    }
  }
  publishHiddenJson(YOUTUBE_AUDIO_RESULT, { requestId: request.requestId, ok });
}

export function installYouTubeAudio(): void {
  if (installed || !isYouTubeHost()) return;
  installed = true;
  window.addEventListener(YOUTUBE_AUDIO_QUERY, (event: Event) => {
    const requestId = (event as CustomEvent<unknown>).detail;
    if (typeof requestId !== 'string' || !/^[\w:-]{1,80}$/.test(requestId)) return;
    let payload: Record<string, unknown> | null = null;
    try { payload = snapshot(requestId); } catch { payload = null; /* Host APIs can throw mid-navigation. */ }
    publishHiddenJson(YOUTUBE_AUDIO_SNAPSHOT, payload);
  });
  window.addEventListener(YOUTUBE_AUDIO_SELECT, (event: Event) => {
    try { select((event as CustomEvent<unknown>).detail); } catch { /* Fail closed; the caller sees no result. */ }
  });
}
