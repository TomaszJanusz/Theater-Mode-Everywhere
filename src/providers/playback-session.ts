import type { PlaybackSurface } from '../playback-surface';
import { isInactiveThumbPlayerVideo, selectSwitchableVideos } from '../switchable-videos';
import { isTencentHost } from './hosts';
import { openTencentPlaybackSession } from './tencent/playback-session';
import {
  isTencentWasmFrameDocument,
  isTencentWasmPlayerElement,
  isUsableTencentWasmPlayer,
  readTencentWasmHostToggle,
  selectTencentTheaterTarget
} from './tencent/wasm-player';

export type ProviderPlaybackSession = {
  surface: PlaybackSurface;
  needsPointerCatcher: boolean;
  dispose(): void;
};

export function isProviderPlaybackFrameDocument(): boolean {
  return isTencentWasmFrameDocument();
}

export const readProviderHostToggle = readTencentWasmHostToggle;

export function findProviderTheaterTarget(discovery: {
  findBestVideo(): HTMLVideoElement | null;
  findAllVideosDeep(): HTMLVideoElement[];
}): HTMLElement | null {
  if (isProviderPlaybackFrameDocument()) return null;
  if (!isTencentHost()) return discovery.findBestVideo();
  const pool = selectSwitchableVideos(discovery.findAllVideosDeep().filter(video => !isInactiveThumbPlayerVideo(video)));
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
