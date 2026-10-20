import { nativePlaybackSurface, type PlaybackSurface } from '../src/playback-surface';
import { setSvgIcon } from '../src/ui/svg-icon';
import type { VolumeControlOptions } from '../src/ui/volume-control';

export interface VolumeState {
  volume: number;
  muted: boolean;
  /** Slider position above 1 when volume boost is on. */
  logicalVolume?: number;
  boost: boolean;
}

/** A production surface over a detached `<video>`; no source, no session. */
export function volumeSurface(state: VolumeState): PlaybackSurface {
  const video = document.createElement('video');
  video.volume = state.volume;
  video.muted = state.muted;
  video.dataset.theaterBoostReady = String(state.boost);
  const surface = nativePlaybackSurface(video);
  surface.logicalVolume = state.logicalVolume;
  return surface;
}

/**
 * The player callbacks `controls.ts` binds from `player-runtime.ts`. That module boots the whole
 * runtime on import, so these small stand-ins mirror its volume rules at the edge instead.
 */
export function volumeHost(
  surface: PlaybackSurface,
  boost: boolean,
  labels: VolumeControlOptions['labels']
): Omit<VolumeControlOptions, 'scope'> {
  const silent = () => surface.muted || surface.volume === 0;
  return {
    video: surface,
    labels,
    ceiling: () => (boost ? 1.5 : 1),
    onCeilingChange: () => () => {},
    boostReady: () => surface.nativeMedia?.dataset.theaterBoostReady === 'true',
    isSilent: silent,
    rememberAudible: volume => { if (volume > 0) surface.lastAudibleVolume = volume; },
    applyLevel: level => { surface.volume = Math.min(1, Math.max(0, level)); },
    toggleMute: () => { surface.muted = !silent(); },
    stepVolume: () => {},
    setIcon: setSvgIcon,
    updateCaptionDock: () => {},
    blurMouseToggle: () => {}
  };
}
