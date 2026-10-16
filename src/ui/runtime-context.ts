import type { AudioBlock } from '../audio-settings';
import type { CaptionLanguagePreference } from '../media-features/caption-preference';
import type { CaptionStyle } from '../media-features/caption-style';
import type { CaptionHudPayload } from '../media-features/controller';
import type { ContentTitle } from '../media-features/content-title';
import { defaultMediaProviderFlags, type MediaProviderFlags } from '../media-features/provider-flags';
import type { FrameCoordinator } from '../core/frame-coordinator';
import type { ExitFrom, ExitOrigin, PlayerCommand, PlayerSession } from '../core/player-session';
import type { VideoFitMode } from './appearance';
import { t as translate } from './messages';
import {
  destroyPlayerUi,
  eventPathIncludes,
  eventPathMatches,
  mountPlayerUi,
  queryPlayerUi,
  queryPlayerUiAll
} from './root';
import type { PlayerUiState, PlayerUiStore } from './store';
import {
  mediaHasSource,
  requestVideoPlay
} from '../host-play';
import type { PlaylistDirection, PlaylistNavState } from '../playlist-nav';
import type { PlaybackSurface } from '../playback-surface';

export interface BoostedVideoElement extends HTMLVideoElement {
  _audioCtx?: AudioContext;
  _gainNode?: GainNode;
  _sourceNode?: MediaElementAudioSourceNode;
  _logicalVolume?: number;
  _lastAudibleVolume?: number;
}

export type ChromeRefs = {
  activeVideo: HTMLVideoElement | null;
  ancestorsList: HTMLElement[];
  isInitialized: boolean;
  isTransitioning: boolean;
  toolbarTimer: ReturnType<typeof setTimeout> | null;
  toolbarKeyboardInteractionActive: boolean;
  toolbarActivityBlockedUntil: number;
  currentToggleFullscreen: (() => void) | null;
  onVolumeAdjustedCallback: (() => void) | null;
  captionPreferenceMap: Record<string, CaptionLanguagePreference>;
  subtitlesOn: boolean;
  playbackDecisionRevision: number;
  providerFlags: MediaProviderFlags;
  helpOverlay: HTMLElement | null;
  parentPlaylistNav: PlaylistNavState;
  childPlaylistNav: PlaylistNavState;
};

export type PlayerChromeActions = {
  applyTheaterElementInlineStyles(element: HTMLElement): void;
  restoreTheaterElementInlineStyles(element: HTMLElement): void;
  injectStylesIntoShadowRoot(shadowRoot: ShadowRoot): void;
  preventDoubleToggle(event: Event): void;
  createCustomControls(video: HTMLVideoElement | PlaybackSurface): void;
  destroyCustomControls(): void;
  showToolbar(event?: Event): void;
  suppressToolbarActivity(): void;
  hideToolbar(): void;
  scheduleToolbarHide(): void;
  updateCaptionDock(immediate?: boolean): void;
  closeTheaterPopovers(): void;
  blurMouseToggle(event: MouseEvent, button: HTMLElement): void;
  hideHelpOverlay(restoreFocus?: boolean): void;
  showHelpOverlay(): void;
  toggleHelpOverlay(): void;
  applyVolumeAndBoost(video: PlaybackSurface, sliderValue: number): void;
  rememberAudibleVolume(video: PlaybackSurface, volume: number): void;
  restoreAudibleVolume(video: PlaybackSurface): number;
  isVideoSilent(video: PlaybackSurface): boolean;
  toggleVideoMute(video: PlaybackSurface): void;
  persistCaptionPreference(pref: CaptionLanguagePreference): void;
  persistCaptionStyle(style: CaptionStyle): void;
  persistVideoFitMode(mode: VideoFitMode): void;
  applyTheaterVideoFit(mode?: VideoFitMode): void;
  applySubtitleLayout(on: boolean): void;
  showCaptionHud(payload: CaptionHudPayload): void;
  syncContentTitle(title: ContentTitle | null): void;
  createPlayerHeader(): HTMLElement;
  executeCommand(command: PlayerCommand): void;
  findBestVideo(): HTMLVideoElement | null;
  findAllVideosDeep(root?: Document | ShadowRoot): HTMLVideoElement[];
  cycleTheaterVideo(direction?: 'next' | 'prev'): void;
  exitTheaterMode(origin?: ExitOrigin, sessionId?: string, from?: ExitFrom): void;
  enterTheaterMode(element: HTMLElement, sessionId?: string, nonce?: string): void;
  focusTheaterPage(): void;
  syncAudioSettings(): void;
  audioBlock(video: HTMLVideoElement): AudioBlock | null;
  refreshHostPlayerLayout(): void;
  setIcon(element: HTMLElement, svg: string): void;
  setTooltipContent(element: HTMLElement, rawText: string): void;
  escapeHtml(value: string): string;
  triggerSeekIndicator(direction: 'left' | 'right'): void;
  triggerVolumeIndicator(logicalVolume: number, muted: boolean, action: 'up' | 'down'): void;
  triggerStatusIndicator(text: string, icon: string): void;
  triggerPlaybackIndicator(action: 'play' | 'pause'): void;
  dismissPlaybackIndicator(): void;
  /** The action a PLAY_PAUSE command would perform now, or null without a playable surface. */
  nextPlaybackAction(): 'play' | 'pause' | null;
  seekHostTime(video: PlaybackSurface, time: number): void;
  playlistNavigationAvailable(): PlaylistNavState;
  subscribePlaylistNavigation(listener: (state: PlaylistNavState) => void): () => void;
  requestParentPlaylistNav(snapshot?: PlaylistNavState): void;
  activatePlaylistStep(direction: PlaylistDirection): void;
};

export type PlayerChromeContext = {
  session: PlayerSession;
  uiStore: PlayerUiStore;
  frames: FrameCoordinator;
  refs: ChromeRefs;
  ui: () => PlayerUiState;
  t: typeof translate;
  queryPlayerUi: typeof queryPlayerUi;
  queryPlayerUiAll: typeof queryPlayerUiAll;
  mountPlayerUi: typeof mountPlayerUi;
  destroyPlayerUi: typeof destroyPlayerUi;
  eventPathIncludes: typeof eventPathIncludes;
  eventPathMatches: typeof eventPathMatches;
  paintOverlay: (element: HTMLElement) => void;
  mediaHasSource: typeof mediaHasSource;
  requestVideoPlay: typeof requestVideoPlay;
  actions: PlayerChromeActions;
};

export function createPlayerChromeContext(
  parts: Omit<PlayerChromeContext, 'actions'>
): PlayerChromeContext {
  return { ...parts, actions: {} as PlayerChromeActions };
}

export function createChromeRefs(): ChromeRefs {
  // Discovery is a hint, not an owner of a player removed by the host.
  let activeVideo: WeakRef<HTMLVideoElement> | null = null;
  return {
    get activeVideo() {
      const video = activeVideo?.deref();
      if (video?.isConnected) return video;
      activeVideo = null;
      return null;
    },
    set activeVideo(video: HTMLVideoElement | null) {
      activeVideo = video ? new WeakRef(video) : null;
    },
    ancestorsList: [],
    isInitialized: false,
    isTransitioning: false,
    toolbarTimer: null,
    toolbarKeyboardInteractionActive: false,
    toolbarActivityBlockedUntil: 0,
    currentToggleFullscreen: null,
    onVolumeAdjustedCallback: null,
    captionPreferenceMap: {},
    subtitlesOn: false,
    playbackDecisionRevision: 0,
    providerFlags: defaultMediaProviderFlags(),
    helpOverlay: null,
    parentPlaylistNav: { previous: false, next: false, previousRestarts: false, previousPreview: null, nextPreview: null },
    childPlaylistNav: { previous: false, next: false, previousRestarts: false, previousPreview: null, nextPreview: null }
  };
}

export function bindRootHelpers(): Pick<
  PlayerChromeContext,
  | 'queryPlayerUi'
  | 'queryPlayerUiAll'
  | 'mountPlayerUi'
  | 'destroyPlayerUi'
  | 'eventPathIncludes'
  | 'eventPathMatches'
  | 'mediaHasSource'
  | 'requestVideoPlay'
> {
  return {
    queryPlayerUi,
    queryPlayerUiAll,
    mountPlayerUi,
    destroyPlayerUi,
    eventPathIncludes,
    eventPathMatches,
    mediaHasSource,
    requestVideoPlay
  };
}
