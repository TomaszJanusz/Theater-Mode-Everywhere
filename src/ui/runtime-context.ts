import type { CaptionLanguagePreference } from '../media-features/caption-preference';
import type { CaptionStyle } from '../media-features/caption-style';
import type { CaptionHudPayload } from '../media-features/controller';
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
  currentToggleFullscreen: (() => void) | null;
  onVolumeAdjustedCallback: (() => void) | null;
  captionPreferenceMap: Record<string, CaptionLanguagePreference>;
  volumeBoostEnabled: boolean;
  providerFlags: MediaProviderFlags;
  helpOverlay: HTMLElement | null;
};

export type PlayerChromeActions = {
  applyTheaterElementInlineStyles(element: HTMLElement): void;
  restoreTheaterElementInlineStyles(element: HTMLElement): void;
  injectStylesIntoShadowRoot(shadowRoot: ShadowRoot): void;
  preventDoubleToggle(event: Event): void;
  createCustomControls(video: HTMLVideoElement): void;
  destroyCustomControls(): void;
  showToolbar(event?: Event): void;
  hideToolbar(): void;
  scheduleToolbarHide(): void;
  updateCaptionDock(): void;
  closeTheaterPopovers(): void;
  blurMouseToggle(event: MouseEvent, button: HTMLElement): void;
  hideHelpOverlay(): void;
  showHelpOverlay(): void;
  toggleHelpOverlay(): void;
  applyVolumeAndBoost(video: HTMLVideoElement, sliderValue: number): void;
  rememberAudibleVolume(video: BoostedVideoElement, volume: number): void;
  restoreAudibleVolume(video: BoostedVideoElement): number;
  isVideoSilent(video: HTMLVideoElement): boolean;
  toggleVideoMute(video: HTMLVideoElement): void;
  persistCaptionPreference(pref: CaptionLanguagePreference): void;
  persistCaptionStyle(style: CaptionStyle): void;
  persistVideoFitMode(mode: VideoFitMode): void;
  applyTheaterVideoFit(mode?: VideoFitMode): void;
  showCaptionHud(payload: CaptionHudPayload): void;
  executeCommand(command: PlayerCommand): void;
  findBestVideo(): HTMLVideoElement | null;
  findAllVideosDeep(root?: Document | ShadowRoot): HTMLVideoElement[];
  cycleTheaterVideo(direction?: 'next' | 'prev'): void;
  exitTheaterMode(origin?: ExitOrigin, sessionId?: string, from?: ExitFrom): void;
  enterTheaterMode(element: HTMLElement, sessionId?: string, nonce?: string): void;
  refreshHostPlayerLayout(): void;
  setIcon(element: HTMLElement, svg: string): void;
  setTooltipContent(element: HTMLElement, rawText: string): void;
  escapeHtml(value: string): string;
  triggerSeekIndicator(direction: 'left' | 'right'): void;
  triggerVolumeIndicator(logicalVolume: number, muted: boolean, action: 'up' | 'down'): void;
  triggerStatusIndicator(text: string, icon: string): void;
  triggerPlaybackIndicator(action: 'play' | 'pause'): void;
  seekHostTime(video: HTMLVideoElement, time: number): void;
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
  return {
    activeVideo: null,
    ancestorsList: [],
    isInitialized: false,
    isTransitioning: false,
    toolbarTimer: null,
    toolbarKeyboardInteractionActive: false,
    currentToggleFullscreen: null,
    onVolumeAdjustedCallback: null,
    captionPreferenceMap: {},
    volumeBoostEnabled: false,
    providerFlags: defaultMediaProviderFlags(),
    helpOverlay: null
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
