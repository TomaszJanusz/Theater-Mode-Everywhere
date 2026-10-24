import type { PlaybackSurface } from '../playback-surface';
import { isInactiveStandbyVideo, isOnMiniplayerSurface, selectSwitchableVideos } from '../switchable-videos';
import { isTencentHost } from './hosts';
import { openTencentPlaybackSession } from './tencent/playback-session';
import {
  isTencentWasmFrameDocument,
  isTencentWasmPlayerElement,
  isUsableTencentWasmPlayer,
  readTencentWasmHostToggle,
  selectTencentTheaterTarget
} from './tencent/wasm-player';
import { readMiniplayerIdentity } from './watch-playback';

export type ProviderPlaybackSession = {
  surface: PlaybackSurface;
  needsPointerCatcher: boolean;
  dispose(): void;
};

export function isProviderPlaybackFrameDocument(): boolean {
  return isTencentWasmFrameDocument();
}

export const readProviderHostToggle = readTencentWasmHostToggle;

/** A parked miniplayer video whose identity the host player confirms; never a discovery candidate. */
export function isMiniplayerTarget(video: HTMLVideoElement): boolean {
  return window === window.top && isOnMiniplayerSurface(video) && readMiniplayerIdentity(video) !== null;
}

export function findProviderTheaterTarget(discovery: {
  findBestVideo(): HTMLVideoElement | null;
  findAllVideosDeep(): HTMLVideoElement[];
  /** The video under the pointer or chosen with the launcher, if any. */
  pointed?: HTMLVideoElement | null;
}): HTMLElement | null {
  if (isProviderPlaybackFrameDocument()) return null;
  if (!isTencentHost()) {
    // Manual entry only: the miniplayer stays out of discovery, Switch Video and AutoTheater.
    // It is the target when pointed at, or when nothing else on the page is one.
    if (discovery.pointed && isMiniplayerTarget(discovery.pointed)) return discovery.pointed;
    return discovery.findBestVideo() ?? discovery.findAllVideosDeep().find(isMiniplayerTarget) ?? null;
  }
  const pool = selectSwitchableVideos(discovery.findAllVideosDeep().filter(video => !isInactiveStandbyVideo(video)));
  const best = discovery.findBestVideo();
  const switchable = pool.length > 0 ? (best && pool.includes(best) ? best : pool[0]) : null;
  const wasm = Array.from(document.querySelectorAll('fake-iframe-video')).find(element => isUsableTencentWasmPlayer(element)) || null;
  return selectTencentTheaterTarget({ switchable, wasm, fallback: best, wasmFrameDocument: false });
}

export function providerFullscreenTarget(active: HTMLVideoElement | null, findTarget: () => HTMLElement | null): HTMLElement | null {
  if (!isTencentHost() && active?.isConnected) return active;
  return findTarget();
}

export function openProviderPlaybackSession(
  element: HTMLElement,
  options: { isCurrent(): boolean; onReplacement(element: HTMLElement): void }
): ProviderPlaybackSession | null {
  return isTencentWasmPlayerElement(element) ? openTencentPlaybackSession(element, options) : null;
}
