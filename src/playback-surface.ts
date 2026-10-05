export type PlaybackRangeList = {
  readonly length: number;
  start(index: number): number;
  end(index: number): number;
};

export type PlaybackCapabilities = {
  /** Real HTMLMediaElement operations: text tracks, CORS reload, load(), Web Audio. */
  nativeMedia: boolean;
  textTracks: boolean;
  volumeBoost: boolean;
  pictureInPicture: boolean;
  objectFit: boolean;
};

/**
 * Playback, pause, and seek share this contract. Native-only operations stay behind
 * `nativeMedia` and the capability flags.
 */
export interface PlaybackSurface {
  readonly element: HTMLElement;
  readonly nativeMedia: HTMLMediaElement | null;
  readonly capabilities: PlaybackCapabilities;
  logicalVolume?: number;
  lastAudibleVolume?: number;
  paused: boolean;
  ended: boolean;
  seeking: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  readyState: number;
  readonly buffered: PlaybackRangeList;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: EventListener, options?: boolean | EventListenerOptions): void;
  requestPictureInPicture(): Promise<unknown>;
  dispose?(): void;
}

type BoostFields = {
  _logicalVolume?: number;
  _lastAudibleVolume?: number;
};

export function isPlaybackSurface(value: object | null | undefined): value is PlaybackSurface {
  if (!value) return false;
  const candidate = value as Partial<PlaybackSurface>;
  return Boolean(candidate.capabilities && 'nativeMedia' in candidate && candidate.element);
}

export function volumeCeiling(surface: PlaybackSurface, boostEnabled: boolean): number {
  return surface.capabilities.volumeBoost && boostEnabled ? 1.5 : 1;
}

export function rangesFromPairs(pairs: Array<{ start: number; end: number }>): PlaybackRangeList {
  const ranges = pairs.filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end));
  return {
    length: ranges.length,
    start(index: number) {
      return ranges[index]?.start ?? 0;
    },
    end(index: number) {
      return ranges[index]?.end ?? 0;
    }
  };
}

function pictureInPictureEnabled(): boolean {
  try {
    return typeof document !== 'undefined' && document.pictureInPictureEnabled === true;
  } catch {
    return false;
  }
}

export function nativePlaybackSurface(video: HTMLVideoElement): PlaybackSurface {
  const boosted = video as HTMLVideoElement & BoostFields;
  const canPip = typeof video.requestPictureInPicture === 'function' && pictureInPictureEnabled();
  const listeners = video.addEventListener?.bind(video);
  const remove = video.removeEventListener?.bind(video);
  return {
    element: video,
    nativeMedia: video,
    capabilities: {
      nativeMedia: true,
      textTracks: typeof video.textTracks !== 'undefined',
      volumeBoost: true,
      pictureInPicture: canPip,
      objectFit: true
    },
    get logicalVolume() {
      return boosted._logicalVolume;
    },
    set logicalVolume(value: number | undefined) {
      boosted._logicalVolume = value;
    },
    get lastAudibleVolume() {
      return boosted._lastAudibleVolume;
    },
    set lastAudibleVolume(value: number | undefined) {
      boosted._lastAudibleVolume = value;
    },
    get paused() {
      return Boolean(video.paused);
    },
    get ended() {
      return Boolean(video.ended);
    },
    get seeking() {
      return Boolean(video.seeking);
    },
    get currentTime() {
      return Number(video.currentTime) || 0;
    },
    set currentTime(value: number) {
      video.currentTime = value;
    },
    get duration() {
      return Number(video.duration);
    },
    get volume() {
      return Number(video.volume) || 0;
    },
    set volume(value: number) {
      video.volume = value;
    },
    get muted() {
      return Boolean(video.muted);
    },
    set muted(value: boolean) {
      video.muted = value;
    },
    get playbackRate() {
      return Number(video.playbackRate) || 1;
    },
    set playbackRate(value: number) {
      video.playbackRate = value;
    },
    get readyState() {
      return Number(video.readyState) || 0;
    },
    get buffered() {
      return video.buffered;
    },
    play() {
      if (typeof video.play !== 'function') return Promise.resolve();
      return video.play();
    },
    pause() {
      video.pause?.();
    },
    addEventListener(type, listener, options) {
      listeners?.(type, listener, options);
    },
    removeEventListener(type, listener, options) {
      remove?.(type, listener, options);
    },
    requestPictureInPicture() {
      if (typeof video.requestPictureInPicture !== 'function') {
        return Promise.reject(new Error('picture-in-picture-unavailable'));
      }
      try {
        return video.requestPictureInPicture();
      } catch (error) {
        return Promise.reject(error);
      }
    }
  };
}

export function coercePlaybackSurface(value: HTMLVideoElement | PlaybackSurface): PlaybackSurface {
  return isPlaybackSurface(value) ? value : nativePlaybackSurface(value);
}

export function nativeVideoOf(value: HTMLVideoElement | PlaybackSurface | null | undefined): HTMLVideoElement | null {
  if (!value) return null;
  if (isPlaybackSurface(value)) {
    return value.capabilities.nativeMedia && value.nativeMedia ? value.nativeMedia as HTMLVideoElement : null;
  }
  return value;
}
