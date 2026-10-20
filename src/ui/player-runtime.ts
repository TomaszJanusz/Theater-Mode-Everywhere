import { saveAutoTheaterEnabled } from './auto-theater-settings';
import { isMotionReduced } from '../appearance-runtime';
import { SPONSORBLOCK_STORAGE_KEY, resolveSponsorBlockMarkers } from './sponsorblock-settings';
import { HIGHLIGHT_NEW_FEATURES_STORAGE_KEY, resolveHighlightNewFeatures, withFeatureHighlightsLocal, FEATURE_HIGHLIGHTS_LOCAL_KEYS } from '../feature-highlights';
import { readFeatureHighlightsLocal } from '../feature-highlights-storage';
import { LANGUAGE_STORAGE_KEY } from '../language';
import { languageRuntime } from '../i18n-runtime';
import { subscribePlaylistNavigation as subscribeNavigation } from '../providers/navigation/watch';
import { AUTO_THEATER_STORAGE_KEY, AUTO_THEATER_SKIP_COUNTDOWN_STORAGE_KEY, resolveAutoEnterTheater, resolveAutoTheaterSkipCountdown, type AutoTheaterVisit } from './auto-theater';
import { showAutoTheaterNotice } from './auto-theater-notice';
import { createVideoActivator, VIDEO_ACTIVATOR_CLASS, type VideoActivator } from './video-activator';
import { resolveVideoActivator, VIDEO_ACTIVATOR_STORAGE_KEY } from './video-activator-settings';
import { autoTheaterAvailability } from '../providers/watch-playback';
import { createAutoTheaterRuntime, type AutoTheaterRuntime } from './auto-theater-runtime';
import { togglePictureInPicture } from './picture-in-picture';
import { VOLUME_BOOST_STORAGE_KEY, resolveVolumeBoostEnabled } from './volume-boost-settings';
import { probeMediaCors } from '../platform/media-cors-probe';
import { reloadForWebAudio } from '../platform/web-audio-reload';
import {
  CAPTION_STYLE_STORAGE_KEY,
  resolveCaptionStyle,
  stepCaptionFontScale,
  type CaptionStyle
} from '../media-features/caption-style';
import {
  CAPTION_PREF_STORAGE_KEY,
  captionPreferenceHost,
  resolveCaptionPreferenceMap,
  upsertCaptionPreference,
  type CaptionLanguagePreference
} from '../media-features/caption-preference';
import { type CaptionHudPayload } from '../media-features/controller';
import {
  applyMediaProviderFlagAttrs,
  mediaProviderFlagStorageKeys,
  mediaProviderFlagStorageUpdate,
  mediaProviderFlagsEqual,
  resolveMediaProviderFlags,
  type MediaProviderFlags
} from '../media-features/provider-flags';
import {
  mediaHasSource,
  toggleDirectPlayback,
  toggleVideoPlayback
} from '../host-play';
import { nativePlaybackSurface, volumeCeiling, type PlaybackSurface } from '../playback-surface';
import {
  emptyPlaylistNav,
  findPlaylistActions,
  playlistNavStateFromActions,
  sanitizePlaylistPreview,
  type PlaylistDirection,
  type PlaylistNavState,
  type PlaylistPreview
} from '../playlist-nav';
import {
  cancelPendingSeekResume,
  seekBy,
  seekToMediaTime
} from '../playback-window';
import { hasLeftPlaybackSurface, isInactiveStandbyVideo } from '../switchable-videos';
import { THEATER_VIDEO_ATTR } from '../platform/active-video';
import { providerSharesPlaybackHost, providerVideoAbandoned } from '../providers/discovery';
import {
  bindProviderPlayback,
  ensureProviderStages,
  mountProviderStages,
  onProviderStructuralMutation,
  pinProviderViewport,
  remountProviderStages,
  unmountProviderStages
} from '../providers/stage';
import {
  findProviderTheaterTarget,
  isProviderPlaybackFrameDocument,
  openProviderPlaybackSession,
  providerFullscreenTarget,
  readProviderHostToggle,
  type ProviderPlaybackSession
} from '../providers/playback-session';
import {
  applyTheaterViewportPin,
  markTheaterVideo,
  mountTheaterStage,
  theaterVideoNeedsRestyle,
  unmarkTheaterVideo,
  unmountTheaterStage
} from './theater-layout';
import {
  mountPlayerUi,
  getPlayerUiRoot,
  queryPlayerUi,
  queryPlayerUiAll,
  PLAYER_NATIVE_ACTIVATION_SELECTOR
} from './root';
import type { DisposableScope } from '../core/disposable-scope';
import { FrameCoordinator } from '../core/frame-coordinator';
import { PlayerSession, type PlayerCommand } from '../core/player-session';
import { resolveDomainPolicy } from '../platform/domain-policy';
import { ACCENT_COLOR_STORAGE_KEY } from '../accentTheme';
import { createSessionId } from '../protocol/frame-messages';
import {
  applyAccentColorPreset,
  resolveAccentColorPreset,
  horizontalLetterboxPx,
  objectPositionForPicture,
  PICTURE_ALIGN_STORAGE_KEY,
  RAISE_ONLY_WITH_SUBTITLES_STORAGE_KEY,
  raisedCaptionsUseBand,
  resolvePictureAlign,
  resolveRaiseOnlyWithSubtitles,
  resolveVideoFitMode,
  VIDEO_FIT_MODES,
  VIDEO_FIT_STORAGE_KEY,
  videoFitLabel,
  type PictureAlign,
  type VideoFitMode
} from './appearance';
import { applyUiDirection, t } from './messages';
import { AUDIO_SHORTCUTS, defaultShortcuts, matchesShortcut, withShortcutDefaults } from './shortcuts';
import { ENTRY_SHORTCUT_ATTRIBUTE, ENTRY_SHORTCUT_EVENT } from './entry-shortcuts';
import { PlayerUiStore, type PlayerUiState } from './store';
import { createButtonTooltip } from './button-tooltip';
import { createControls, type ExtendedHTMLDivElement } from './controls';
import { createDiscovery, isElementInDOMDeep } from './discovery';
import { createHelp } from './help';
import {
  createHud,
  TITLE_HUD_CLASS,
  STATUS_HUD_FIT_ICON,
  STATUS_HUD_LAYOUT_ICON,
  STATUS_HUD_MUTE_ICON,
  STATUS_HUD_UNMUTE_ICON,
  audioHudIcon,
  VOLUME_BOOST_ICONS
} from './hud';
import {
  AUDIO_BLOCK_KEYS,
  AUDIO_HUD_KEYS,
  AUDIO_SETTING_NAMES,
  AUDIO_SETTINGS_EVENT,
  AUDIO_STORAGE_KEYS,
  audioLevelLabelKey,
  cycleAudioSetting,
  DEFAULT_AUDIO_SETTINGS,
  isNeutralAudio,
  resolveAudioSettings,
  resolveStoredAudioSettings,
  sameAudioSettings,
  writeAudioDataset,
  type AudioBlock,
  type AudioSettingName,
  type AudioSettings
} from '../audio-settings';
import { mediaAudioAccess } from '../platform/media-audio-access';
import {
  bindRootHelpers,
  createChromeRefs,
  createPlayerChromeContext
} from './runtime-context';
import { createToolbar } from './toolbar';
import { CONTROLS_VISIBILITY_ICON, KEEP_CONTROLS_VISIBLE_STORAGE_KEY, resolveKeepControlsVisible } from './controls-visibility';
import { closeMenuPopover } from './menu-popover';
import { installChatShortcutRelay, isChatDocument, isChatShortcutMessage, isNativeChatEvent } from '../chat';
import { CHAT_PREFERENCES_STORAGE_KEY, hydrateChatPreferences, nativeChatState, startNativeChatSession, stopNativeChatSession, toggleNativeChat } from './chat';

const session = new PlayerSession();
const frames = new FrameCoordinator(() => session.ensureNonce());
const uiStore = new PlayerUiStore();
const refs = createChromeRefs();

function ui(): PlayerUiState {
  return uiStore.getState();
}

function paintOverlay(element: HTMLElement): void {
  applyUiDirection(element);
  applyAccentColorPreset(element, ui().accentColor);
}

const ctx = createPlayerChromeContext({
  session,
  uiStore,
  frames,
  refs,
  ui,
  t,
  paintOverlay,
  ...bindRootHelpers()
});

const buttonTooltip = createButtonTooltip(ctx);
const hud = createHud(ctx, buttonTooltip.bind);
const toolbar = createToolbar(ctx, applyTheaterPictureLayout);
const help = createHelp(ctx);
const discovery = createDiscovery(ctx);
const controls = createControls(ctx, buttonTooltip.bind, () => {
  hud.removeCaptionHud();
  hud.removeCenteredHud();
  toolbar.resetCaptionDock();
});

const {
  triggerSeekIndicator,
  triggerVolumeIndicator,
  triggerStatusIndicator,
  triggerPlaybackIndicator,
  dismissPlaybackIndicator,
  triggerCaptionHud,
  syncContentTitle
} = hud;
const {
  showToolbar,
  hideToolbar,
  updateCaptionDock,
  closeTheaterPopovers,
  preventDoubleToggle,
  cancelPictureClick,
  bindWasmCatcher
} = toolbar;
const { toggleHelpOverlay, showHelpOverlay, hideHelpOverlay } = help;
const {
  findAllVideosDeep,
  findBestVideo: discoverBestVideo,
  switchTheaterVideo,
  cycleTheaterVideo,
  injectStylesIntoShadowRoot
} = discovery;
const { createCustomControls, destroyCustomControls } = controls;

let pendingVideoPointer: { path: WeakRef<Node>[]; href: string } | null = null;

function refreshPointerVideo(): void {
  const pointer = pendingVideoPointer;
  pendingVideoPointer = null;
  // Reject the whole path if its origin disappeared; surviving body/html
  // ancestors must not turn an old overlay into a new player selection.
  if (!pointer || pointer.href !== window.location.href) return;
  const origin = pointer.path[0]?.deref();
  if (!origin?.isConnected || origin.ownerDocument !== document) return;
  for (const ref of pointer.path) {
    const target = ref.deref();
    if (!(target instanceof HTMLElement) || !target.isConnected) continue;
    const video = target instanceof HTMLVideoElement ? target
      : target.shadowRoot?.querySelector('video') || target.querySelector('video');
    if (video) {
      refs.activeVideo = video;
      return;
    }
  }
  // A miss preserves the last video selected by playback or discovery.
}

function findBestVideo(): HTMLVideoElement | null {
  refreshPointerVideo();
  return discoverBestVideo();
}

let cancelAudioReload: (() => void) | null = null;

let providerPlayback: ProviderPlaybackSession | null = null;
let removeWasmCatcher: (() => void) | null = null;

function sessionSurface(): PlaybackSurface | null {
  if (providerPlayback && session.element === providerPlayback.surface.element) return providerPlayback.surface;
  if (session.element instanceof HTMLVideoElement) return nativePlaybackSurface(session.element);
  return null;
}

function sessionNativeVideo(): HTMLVideoElement | null {
  const surface = sessionSurface();
  if (!surface?.capabilities.nativeMedia) return null;
  return surface.nativeMedia instanceof HTMLVideoElement ? surface.nativeMedia : null;
}

const webAudioCorsTried = new WeakSet<HTMLVideoElement>();
/** Probe still running: the host element is untouched, so a refusal is not yet known. */
const webAudioCorsProbing = new WeakSet<HTMLVideoElement>();

/**
 * Reload once with CORS so Web Audio can hear cross-origin media. The CORS request is probed on a
 * detached element first: a refused load on the host's own element reaches the host player as a
 * fatal source error, so a refusing server leaves it untouched.
 */
function prepareWebAudio(video: HTMLVideoElement): void {
  if (webAudioCorsTried.has(video) || mediaAudioAccess(video, window.location.origin) !== 'needs-cors') return;
  webAudioCorsTried.add(video);
  cancelAudioReload?.();
  const url = video.currentSrc || video.src;
  if (!url) return;
  const epoch = session.currentEpoch;
  const revision = refs.playbackDecisionRevision;
  const isCurrent = () => sessionNativeVideo() === video && session.currentEpoch === epoch && !session.isExiting && !session.isIdle;
  const probing = new AbortController();
  const stopProbe = () => {
    probing.abort();
    webAudioCorsProbing.delete(video);
  };
  session.signal.addEventListener('abort', stopProbe, { once: true });
  let reload: (() => void) | null = null;
  cancelAudioReload = () => { stopProbe(); reload?.(); };
  webAudioCorsProbing.add(video);
  void probeMediaCors(url, probing.signal).then((ok) => {
    webAudioCorsProbing.delete(video);
    session.signal.removeEventListener('abort', stopProbe);
    if (!ok && !probing.signal.aborted && isCurrent()) {
      // The refusal is now known; let the controls show it.
      video.dispatchEvent(new CustomEvent(AUDIO_SETTINGS_EVENT, { bubbles: true, composed: true }));
    }
    // The source may have been replaced while probing; a new source gets its own preparation.
    if (!ok || probing.signal.aborted || !isCurrent() || (video.currentSrc || video.src) !== url) return;
    reload = reloadForWebAudio(video, {
      pageOrigin: window.location.origin,
      signal: session.signal,
      isCurrent,
      canResume: () => refs.playbackDecisionRevision === revision
    });
  });
}

function audioProcessingRequested(): boolean {
  return ui().volumeBoost || !isNeutralAudio(ui().audio);
}

/** Why Web Audio cannot process this video, or null when it can. */
function audioBlock(video: HTMLVideoElement): AudioBlock | null {
  const access = mediaAudioAccess(video, window.location.origin);
  if (access === 'protected') return 'protected';
  if (webAudioCorsProbing.has(video)) return null;
  // Loaded again without CORS: the server refused it.
  return access === 'needs-cors' && webAudioCorsTried.has(video) && video.readyState >= 1 ? 'refused' : null;
}

function audioBlockedMessage(video: HTMLVideoElement | null): string {
  const block = video && audioBlock(video);
  return block ? t(AUDIO_BLOCK_KEYS[block]) : t('audioUnavailableHud');
}

let audioVideo: HTMLVideoElement | null = null;

function pushAudioSettings(video: HTMLVideoElement, settings: AudioSettings): void {
  if (!writeAudioDataset(video.dataset, settings)) return;
  video.dispatchEvent(new CustomEvent(AUDIO_SETTINGS_EVENT, { bubbles: true, composed: true }));
}

function resetMediaAudio(video: HTMLVideoElement): void {
  video.dataset.theaterBoost = '1.0';
  delete video.dataset.theaterBoostActive;
  writeAudioDataset(video.dataset, DEFAULT_AUDIO_SETTINGS);
  // Gain also belongs to the session, even when the effects were neutral.
  video.dispatchEvent(new CustomEvent(AUDIO_SETTINGS_EVENT, { bubbles: true, composed: true }));
}

/** Settings follow the theater video; any other element returns to its own sound. */
function syncAudioSettings(): void {
  const video = sessionNativeVideo();
  if (audioVideo && audioVideo !== video) resetMediaAudio(audioVideo);
  audioVideo = video;
  if (!video) return;
  if (audioProcessingRequested()) prepareWebAudio(video);
  pushAudioSettings(video, ui().audio);
  const surface = sessionSurface();
  if (surface && ((surface.logicalVolume ?? 0) > 1 || video.dataset.theaterBoostActive === 'true')) {
    const value = Math.min(volumeCeiling(surface, ui().volumeBoost), surface.logicalVolume ?? surface.volume);
    surface.logicalVolume = value;
    applyVolumeAndBoost(surface, value);
  }
}

function releaseAudioSettings(): void {
  if (audioVideo) resetMediaAudio(audioVideo);
  audioVideo = null;
}

function applyAudioSettings(settings: AudioSettings): void {
  if (sameAudioSettings(settings, ui().audio)) return;
  uiStore.dispatch({ type: 'SET_AUDIO', value: settings });
  syncAudioSettings();
}

function cycleAudioSettingCommand(name: AudioSettingName): void {
  const video = sessionNativeVideo();
  const icon = audioHudIcon(name, ui().audio);
  if (!video || audioBlock(video)) {
    triggerStatusIndicator(audioBlockedMessage(video), icon);
    return;
  }
  const next = cycleAudioSetting(ui().audio, name);
  applyAudioSettings(next);
  triggerStatusIndicator(t(AUDIO_HUD_KEYS[name], t(audioLevelLabelKey(next, name))), audioHudIcon(name, next),
    name === 'bass' ? next.bass : undefined);
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
      void chrome.storage.sync.set({ [AUDIO_STORAGE_KEYS[name]]: next[name] }).catch(error => {
        console.error('[Theater Everywhere] Could not save audio setting:', error);
      });
    }
  } catch (error) {
    console.error('[Theater Everywhere] Could not save audio setting:', error);
  }
}

function applyVolumeBoost(enabled: boolean): void {
  if (ui().volumeBoost === enabled) return;
  uiStore.dispatch({ type: 'SET_VOLUME_BOOST', value: enabled });
  const surface = sessionSurface();
  if (!surface) return;
  if (!enabled && (surface.logicalVolume ?? 0) > 1) {
    surface.logicalVolume = 1;
    rememberAudibleVolume(surface, 1);
    applyVolumeAndBoost(surface, 1);
    refs.onVolumeAdjustedCallback?.();
  }
  syncAudioSettings();
}

function toggleVolumeBoostCommand(): void {
  const surface = sessionSurface();
  const video = sessionNativeVideo();
  if (!surface?.capabilities.volumeBoost || !video || audioBlock(video)) {
    triggerStatusIndicator(audioBlockedMessage(video), VOLUME_BOOST_ICONS.hud);
    return;
  }
  const next = !ui().volumeBoost;
  applyVolumeBoost(next);
  triggerStatusIndicator(t('volumeBoostHud', t(next ? 'volumeBoostOn' : 'volumeBoostOff')), VOLUME_BOOST_ICONS.hud);
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
      void chrome.storage.sync.set({ [VOLUME_BOOST_STORAGE_KEY]: next }).catch(error => {
        console.error('[Theater Everywhere] Could not save volume boost:', error);
      });
    }
  } catch (error) {
    console.error('[Theater Everywhere] Could not save volume boost:', error);
  }
}

function rememberAudibleVolume(video: PlaybackSurface, volume: number): void {
  if (volume > 0) video.lastAudibleVolume = volume;
}

function restoreAudibleVolume(video: PlaybackSurface): number {
  if (typeof video.lastAudibleVolume === 'number' && video.lastAudibleVolume > 0) {
    return video.lastAudibleVolume;
  }
  if (typeof video.logicalVolume === 'number' && video.logicalVolume > 0) {
    return video.logicalVolume;
  }
  if (video.volume > 0) return video.volume;
  return 1;
}

function isVideoSilent(video: PlaybackSurface): boolean {
  return video.muted || video.volume === 0;
}

function toggleVideoMute(video: PlaybackSurface): void {
  if (isVideoSilent(video)) {
    const restore = Math.min(volumeCeiling(video, ui().volumeBoost), restoreAudibleVolume(video));
    video.logicalVolume = restore;
    rememberAudibleVolume(video, restore);
    video.muted = false;
    applyVolumeAndBoost(video, restore);
    triggerStatusIndicator(t('unmuteHud'), STATUS_HUD_UNMUTE_ICON);
  } else {
    const volume = video.logicalVolume ?? video.volume;
    rememberAudibleVolume(video, volume);
    video.logicalVolume = volume;
    video.muted = true;
    triggerStatusIndicator(t('muteHud'), STATUS_HUD_MUTE_ICON);
  }
  refs.onVolumeAdjustedCallback?.();
}

function adjustVolume(video: PlaybackSurface, direction: 'up' | 'down'): void {
  const current = video.logicalVolume ?? (video.muted ? 0 : video.volume);
  video.logicalVolume = direction === 'up'
    ? Math.min(volumeCeiling(video, ui().volumeBoost), current + 0.05)
    : Math.max(0, current - 0.05);
  if (direction === 'up' && video.muted) video.muted = false;
  applyVolumeAndBoost(video, video.logicalVolume);
  rememberAudibleVolume(video, video.logicalVolume);
  triggerVolumeIndicator(video.logicalVolume, video.muted, direction);
  refs.onVolumeAdjustedCallback?.();
}

function applyVolumeAndBoost(video: PlaybackSurface, sliderValue: number): void {
  if (!video.element.hasAttribute(THEATER_VIDEO_ATTR)) {
    video.element.setAttribute(THEATER_VIDEO_ATTR, '');
  }
  const ceiling = volumeCeiling(video, ui().volumeBoost);
  const value = Math.min(ceiling, Math.max(0, sliderValue));
  const native = video.nativeMedia instanceof HTMLVideoElement ? video.nativeMedia : null;
  if (!video.capabilities.volumeBoost || value <= 1) {
    video.volume = Math.min(1, value);
    if (native?.dataset.theaterBoostActive === 'true') {
      native.dataset.theaterBoost = '1.0';
      window.dispatchEvent(new CustomEvent('theater-everywhere-boost-event'));
    }
    return;
  }
  video.volume = 1;
  if (!native) return;
  const multiplier = 1 + (value - 1) * 4;
  native.dataset.theaterBoost = multiplier.toFixed(4);
  native.dataset.theaterBoostActive = 'true';
  window.dispatchEvent(new CustomEvent('theater-everywhere-boost-event'));
}

function nextPlaybackAction(): 'play' | 'pause' | null {
  const surface = sessionSurface();
  if (!surface) return null;
  const native = surface.nativeMedia instanceof HTMLVideoElement ? surface.nativeMedia : null;
  const willPlay = native ? (!mediaHasSource(native) || native.paused) : surface.paused;
  return willPlay ? 'play' : 'pause';
}

function executeCommand(command: PlayerCommand): void {
  if (command.type === 'EXIT') {
    exitTheaterMode(command.origin, command.sessionId, command.from);
    return;
  }
  if (!session.dispatch(command)) return;
  switch (command.type) {
    case 'PLAY_PAUSE': {
      refs.playbackDecisionRevision += 1;
      const surface = sessionSurface();
      if (!surface) break;
      const native = surface.nativeMedia instanceof HTMLVideoElement ? surface.nativeMedia : null;
      const willPlay = nextPlaybackAction() === 'play';
      if (native) {
        cancelPendingSeekResume(native);
        toggleVideoPlayback(native);
      } else {
        toggleDirectPlayback(surface);
      }
      triggerPlaybackIndicator(willPlay ? 'play' : 'pause');
      break;
    }
    case 'SEEK_BY': {
      const surface = sessionSurface();
      if (!surface) break;
      if (seekBy(surface, command.delta) && Math.abs(command.delta) >= 5) {
        triggerSeekIndicator(command.delta < 0 ? 'left' : 'right');
      }
      break;
    }
    case 'TOGGLE_CAPTIONS':
      void toggleTheaterCaptions();
      break;
    case 'TOGGLE_CHAT':
      if (toggleNativeChat()) showToolbar();
      break;
    case 'STEP_CAPTION_SIZE':
      persistCaptionStyle({
        ...ui().captionStyle,
        fontScale: stepCaptionFontScale(ui().captionStyle.fontScale, command.direction)
      });
      break;
    case 'CYCLE_VIDEO':
      cycleTheaterVideo(command.direction);
      break;
    case 'CYCLE_LAYOUT':
      cyclePictureLayout();
      break;
    case 'CYCLE_FIT':
      cycleVideoFit();
      break;
    case 'TOGGLE_CONTROLS_PIN':
      toggleControlsPin();
      break;
    case 'CYCLE_AUDIO':
      cycleAudioSettingCommand(command.setting);
      break;
    case 'TOGGLE_VOLUME_BOOST':
      toggleVolumeBoostCommand();
      break;
    case 'TOGGLE_AUTO_THEATER':
      toggleAutoTheaterCommand();
      break;
    case 'TOGGLE_HELP':
      toggleHelpOverlay();
      break;
  }
}

function localPlaylistActions(): ReturnType<typeof findPlaylistActions> {
  const video = session.element?.tagName === 'VIDEO' ? session.element as HTMLVideoElement : null;
  const root = session.element ? playlistSearchRoot(session.element) : document;
  return findPlaylistActions(root, video);
}

function playlistSearchRoot(element: HTMLElement): ParentNode {
  // Document or shadow root, including a wasm host. findPlaylistActions narrows
  // to the player when a video is passed, then falls back here for controls and
  // previews that live outside that container.
  const root = element.getRootNode();
  if (root instanceof ShadowRoot || root instanceof Document) return root;
  return element.ownerDocument;
}

function playlistNavigationAvailable(): PlaylistNavState {
  const local = playlistNavStateFromActions(localPlaylistActions());
  return {
    previous: local.previous || refs.parentPlaylistNav.previous,
    next: local.next || refs.parentPlaylistNav.next,
    previousRestarts: local.previous ? local.previousRestarts : refs.parentPlaylistNav.previousRestarts,
    previousPreview: local.previous ? local.previousPreview : refs.parentPlaylistNav.previousPreview,
    nextPreview: local.next ? local.nextPreview : refs.parentPlaylistNav.nextPreview
  };
}

function requestParentPlaylistNav(snapshot?: PlaylistNavState): void {
  if (window.parent === window || !session.id) return;
  // The existing controls refresh also reports child availability to its parent.
  const available = session.element?.tagName === 'IFRAME'
    ? refs.childPlaylistNav
    : snapshot ?? playlistNavigationAvailable();
  frames.postToParent('PLAYLIST_NAV_QUERY', session.id, available);
}

function requestEmbedderFullscreen(): boolean {
  if (window === window.top || !refs.embedderLinked || !session.id) return false;
  frames.postToParent('FRAME_FULLSCREEN', session.id);
  return true;
}

function activatePlaylistStep(direction: PlaylistDirection): void {
  const local = localPlaylistActions().find((action) => action.direction === direction);
  if (local) {
    local.activate();
    return;
  }
  if (window.parent !== window && session.id && refs.parentPlaylistNav[direction]) {
    frames.postToParent('PLAYLIST_NAV_GO', session.id, { direction });
  }
}

function playlistPreviewFromPayload(value: unknown): PlaylistPreview | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return sanitizePlaylistPreview(
    typeof record.title === 'string' ? record.title : '',
    typeof record.imageUrl === 'string' ? record.imageUrl : ''
  );
}

function playlistNavFromPayload(payload: Record<string, unknown>): PlaylistNavState {
  const previous = payload.previous === true;
  const next = payload.next === true;
  return {
    previous,
    next,
    previousRestarts: previous && payload.previousRestarts === true,
    previousPreview: previous && payload.previousRestarts !== true
      ? playlistPreviewFromPayload(payload.previousPreview)
      : null,
    nextPreview: next ? playlistPreviewFromPayload(payload.nextPreview) : null
  };
}

function bindChromeActions(): void {
  Object.assign(ctx.actions, {
    applyTheaterElementInlineStyles,
    restoreTheaterElementInlineStyles,
    injectStylesIntoShadowRoot,
    preventDoubleToggle,
    createCustomControls,
    destroyCustomControls,
    showToolbar,
    suppressToolbarActivity: toolbar.suppressToolbarActivity,
    hideToolbar,
    scheduleToolbarHide: toolbar.scheduleToolbarHide,
    updateCaptionDock,
    closeTheaterPopovers,
    blurMouseToggle: toolbar.blurMouseToggle,
    hideHelpOverlay,
    showHelpOverlay,
    toggleHelpOverlay,
    applyVolumeAndBoost,
    adjustVolume,
    rememberAudibleVolume,
    restoreAudibleVolume,
    isVideoSilent,
    toggleVideoMute,
    persistCaptionPreference,
    persistCaptionStyle,
    persistVideoFitMode,
    applyTheaterVideoFit,
    applySubtitleLayout,
    showCaptionHud,
    createPlayerHeader: hud.createPlayerHeader,
    syncContentTitle,
    executeCommand,
    findBestVideo,
    findAllVideosDeep,
    cycleTheaterVideo,
    exitTheaterMode,
    enterTheaterMode,
    focusTheaterPage,
    syncAudioSettings,
    audioBlock,
    refreshHostPlayerLayout,
    setIcon: toolbar.setIcon,
    setTooltipContent: toolbar.setTooltipContent,
    escapeHtml: toolbar.escapeHtml,
    triggerSeekIndicator,
    triggerVolumeIndicator,
    triggerStatusIndicator,
    triggerPlaybackIndicator,
    dismissPlaybackIndicator,
    nextPlaybackAction,
    seekHostTime: seekToMediaTime,
    playlistNavigationAvailable,
    subscribePlaylistNavigation(listener: (state: PlaylistNavState) => void) {
      const element = session.element;
      const root = element?.getRootNode();
      return subscribeNavigation(root instanceof ShadowRoot ? root : document, playlistNavigationAvailable, listener);
    },
    requestParentPlaylistNav,
    requestEmbedderFullscreen,
    activatePlaylistStep
  });
}

const THEATER_ELEMENT_INLINE_STYLES: Record<string, string> = {
  position: 'fixed',
  top: '0',
  left: '0',
  width: 'var(--theater-video-width, 100vw)',
  height: 'calc(var(--theater-video-height, 100vh) - var(--theater-controls-reserved-height, 0px))',
  'max-width': 'var(--theater-video-width, 100vw)',
  'max-height': 'calc(var(--theater-video-height, 100vh) - var(--theater-controls-reserved-height, 0px))',
  'min-width': 'var(--theater-video-width, 100vw)',
  'min-height': 'calc(var(--theater-video-height, 100vh) - var(--theater-controls-reserved-height, 0px))',
  'z-index': 'var(--theater-video-z, 2147483647)',
  opacity: '1',
  'pointer-events': 'auto',
  margin: '0',
  padding: '0',
  transform: 'none',
  translate: 'none',
  rotate: 'none',
  scale: 'none',
  'transform-style': 'flat',
  background: '#000000',
  'background-color': '#000000',
};

type SavedInlineStyle = {
  property: string;
  value: string;
  priority: string;
};

type SavedInlineStyleState = {
  hadStyleAttribute: boolean;
  styles: SavedInlineStyle[];
};

const theaterElementInlineStyleState = new WeakMap<HTMLElement, SavedInlineStyleState>();

function currentPictureFrame() {
  const element = session.element;
  const rect = element?.getBoundingClientRect();
  const video = element instanceof HTMLVideoElement ? element : null;
  return {
    videoWidth: video?.videoWidth ?? 0,
    videoHeight: video?.videoHeight ?? 0,
    viewportWidth: rect && rect.width > 0 ? rect.width : window.innerWidth,
    viewportHeight: rect && rect.height > 0 ? rect.height : window.innerHeight,
  };
}

const PICTURE_MOVE_MS = 320;
let pictureMoveTimer: number | undefined;

function picturePositionOptions() {
  return {
    raiseOnlyWithSubtitles: ui().raiseOnlyWithSubtitles,
    subtitlesOn: refs.subtitlesOn
  };
}

function pictureMoveTransition(): string {
  return isMotionReduced()
    ? 'none'
    : `object-position ${PICTURE_MOVE_MS}ms cubic-bezier(0.25, 1, 0.5, 1)`;
}

function currentObjectPosition(): string {
  return objectPositionForPicture(ui().videoFit, ui().pictureAlign, currentPictureFrame(), picturePositionOptions());
}

function beginPictureMove(): void {
  const root = document.documentElement;
  root.classList.add('theater-everywhere-picture-moving');
  void root.offsetWidth;
  const overlay = queryPlayerUi('.theater-caption-overlay') as HTMLElement | null;
  if (overlay) {
    overlay.style.setProperty(
      'transition',
      `bottom ${PICTURE_MOVE_MS}ms cubic-bezier(0.25, 1, 0.5, 1), opacity 0.15s ease`,
      'important'
    );
    void overlay.offsetWidth;
  }
  if (pictureMoveTimer !== undefined) window.clearTimeout(pictureMoveTimer);
  pictureMoveTimer = window.setTimeout(() => {
    pictureMoveTimer = undefined;
    root.classList.remove('theater-everywhere-picture-moving');
    updateCaptionDock();
  }, PICTURE_MOVE_MS);
}

function getTheaterElementInlineStyles(): Record<string, string> {
  return {
    ...THEATER_ELEMENT_INLINE_STYLES,
    transition: pictureMoveTransition(),
    'object-fit': ui().videoFit,
    'object-position': currentObjectPosition(),
  };
}

function applyTheaterElementInlineStyles(element: HTMLElement): void {
  const styles = getTheaterElementInlineStyles();
  if (!theaterElementInlineStyleState.has(element)) {
    theaterElementInlineStyleState.set(element, {
      hadStyleAttribute: element.hasAttribute('style'),
      styles: Object.keys(styles).map(property => ({
        property,
        value: element.style.getPropertyValue(property),
        priority: element.style.getPropertyPriority(property),
      })),
    });
  }

  Object.entries(styles).forEach(([property, value]) => {
    if (property === 'top' || property === 'left') return;
    if (element.style.getPropertyValue(property) === value && element.style.getPropertyPriority(property) === 'important') {
      return;
    }
    element.style.setProperty(property, value, 'important');
  });
  const objectPosition = currentObjectPosition();
  if (element.style.getPropertyValue('--theater-object-fit') !== ui().videoFit) {
    element.style.setProperty('--theater-object-fit', ui().videoFit);
  }
  if (element.style.getPropertyValue('--theater-object-position') !== objectPosition) {
    element.style.setProperty('--theater-object-position', objectPosition);
  }
  for (const property of ['top', 'left'] as const) {
    if (!element.style.getPropertyValue(property)) {
      element.style.setProperty(property, '0px', 'important');
    }
  }
  pinProviderViewport(element, applyTheaterViewportPin);
  applyTheaterPictureLayout();
}

function applyTheaterPictureLayout(): void {
  const fit = ui().videoFit;
  const frame = currentPictureFrame();
  const position = objectPositionForPicture(fit, ui().pictureAlign, frame, picturePositionOptions());
  const letterbox = horizontalLetterboxPx(frame);
  const root = document.documentElement;
  const previous = root.style.getPropertyValue('--theater-object-position');
  if (previous !== '' && previous !== position && !isMotionReduced()) beginPictureMove();
  root.classList.toggle(
    'theater-everywhere-picture-top',
    raisedCaptionsUseBand(position, letterbox)
  );
  document.documentElement.style.setProperty('--theater-object-fit', fit);
  document.documentElement.style.setProperty('--theater-object-position', position);
  root.style.setProperty('--theater-letterbox', `${Math.round(letterbox)}px`);
  // Raised playback puts the whole letterbox below the picture. Other fits
  // and unavailable media dimensions use the playback viewport's center.
  const pictureHeight = frame.viewportHeight - (position === 'center top' ? letterbox : 0);
  root.style.setProperty('--theater-hud-center-y', `${pictureHeight / 2}px`);
  if (session.element) {
    session.element.style.setProperty('object-fit', fit, 'important');
    session.element.style.setProperty('--theater-object-fit', fit);
    session.element.style.setProperty('object-position', position, 'important');
    session.element.style.setProperty('--theater-object-position', position);
  }
  updateCaptionDock();
}

function applyTheaterVideoFit(mode: VideoFitMode = ui().videoFit): void {
  uiStore.dispatch({ type: 'SET_VIDEO_FIT', value: mode });
  applyTheaterPictureLayout();
}

function applyPictureAlign(align: PictureAlign = ui().pictureAlign): void {
  uiStore.dispatch({ type: 'SET_PICTURE_ALIGN', value: align });
  applyTheaterPictureLayout();
}

function applyRaiseOnlyWithSubtitles(value: unknown): void {
  const next = resolveRaiseOnlyWithSubtitles(value);
  if (next === ui().raiseOnlyWithSubtitles) return;
  uiStore.dispatch({ type: 'SET_RAISE_ONLY_WITH_SUBTITLES', value: next });
  applyTheaterPictureLayout();
}

function applySubtitleLayout(on: boolean): void {
  if (refs.subtitlesOn === on) return;
  refs.subtitlesOn = on;
  if (ui().theaterActive) applyTheaterPictureLayout();
}

function applyProviderFlags(next: MediaProviderFlags): void {
  const changed = !mediaProviderFlagsEqual(refs.providerFlags, next);
  refs.providerFlags = next;
  applyMediaProviderFlagAttrs(document.documentElement, next);
  if (changed) {
    videoActivator?.dispose();
    videoActivator = null;
    syncVideoActivator();
  }
  const wrapper = queryPlayerUi('.theater-controls-wrapper') as ExtendedHTMLDivElement | null;
  wrapper?._mediaFeatures?.setProviderFlags(next);
  if (changed) wrapper?._syncAutoTheaterAvailability?.();
}

function persistCaptionPreference(pref: CaptionLanguagePreference): void {
  const host = captionPreferenceHost(window.location.hostname);
  if (!host) return;
  refs.captionPreferenceMap = upsertCaptionPreference(refs.captionPreferenceMap, host, pref);
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
      chrome.storage.sync.set({ [CAPTION_PREF_STORAGE_KEY]: refs.captionPreferenceMap });
    }
  } catch (_) {}
}

function persistCaptionStyle(style: CaptionStyle): void {
  applyCaptionStyleToTheater(style);
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
      chrome.storage.sync.set({ [CAPTION_STYLE_STORAGE_KEY]: style });
    }
  } catch (_) {}
}

function applyCaptionStyleToTheater(style: CaptionStyle): void {
  uiStore.dispatch({ type: 'SET_CAPTION_STYLE', value: style });
  const wrapper = queryPlayerUi('.theater-controls-wrapper') as ExtendedHTMLDivElement | null;
  wrapper?._mediaFeatures?.setCaptionStyle(ui().captionStyle);
}

function persistVideoFitMode(mode: VideoFitMode): void {
  applyTheaterVideoFit(mode);
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
      chrome.storage.sync.set({ [VIDEO_FIT_STORAGE_KEY]: mode });
    }
  } catch (_) {
    // Storage can be unavailable in local test pages.
  }
}

function applyKeepControlsVisible(value: unknown): void {
  const next = resolveKeepControlsVisible(value);
  if (next === ui().keepControlsVisible) return;
  uiStore.dispatch({ type: 'SET_KEEP_CONTROLS_VISIBLE', value: next });
  if (next) toolbar.refreshToolbarVisibility();
  else showToolbar();
}

function toggleControlsPin(): void {
  const next = !ui().keepControlsVisible;
  applyKeepControlsVisible(next);
  triggerStatusIndicator(t(next ? 'controlsPinnedHud' : 'controlsUnpinnedHud'), CONTROLS_VISIBILITY_ICON);
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
      void chrome.storage.sync.set({ [KEEP_CONTROLS_VISIBLE_STORAGE_KEY]: next }).catch((error) => {
        console.error('[Theater Everywhere] Could not save controls visibility:', error);
      });
    }
  } catch (error) {
    console.error('[Theater Everywhere] Could not save controls visibility:', error);
  }
}

function cyclePictureLayout(): void {
  const next: PictureAlign = ui().pictureAlign === 'center' ? 'top' : 'center';
  applyPictureAlign(next);
  triggerStatusIndicator(t(next === 'top' ? 'pictureAlignTop' : 'pictureAlignCenter'), STATUS_HUD_LAYOUT_ICON);
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
      void chrome.storage.sync.set({ [PICTURE_ALIGN_STORAGE_KEY]: next }).catch(error => {
        console.error('[Theater Everywhere] Could not save picture layout:', error);
      });
    }
  } catch (error) {
    console.error('[Theater Everywhere] Could not save picture layout:', error);
  }
}

function cycleVideoFit(): void {
  const surface = sessionSurface();
  if (surface && !surface.capabilities.objectFit) return;
  const currentIndex = VIDEO_FIT_MODES.indexOf(ui().videoFit);
  const nextMode = VIDEO_FIT_MODES[(currentIndex + 1) % VIDEO_FIT_MODES.length];
  persistVideoFitMode(nextMode);
  triggerStatusIndicator(videoFitLabel(nextMode), STATUS_HUD_FIT_ICON);
}

function showCaptionHud(payload: CaptionHudPayload): void {
  if (payload.result === 'loading') {
    triggerCaptionHud({ kind: 'loading', title: t('subtitlesLoadingHud') });
    return;
  }
  if (payload.result === 'dismiss') {
    triggerCaptionHud({ kind: 'dismiss' });
    return;
  }
  if (payload.result === 'none') {
    triggerCaptionHud({ kind: 'status', title: t('noSubtitlesAvailable') });
    return;
  }
  if (payload.result === 'failed') {
    triggerCaptionHud({ kind: 'status', title: t('subtitlesLoadFailedHud') });
    return;
  }
  if (payload.result === 'on') {
    triggerCaptionHud({
      kind: 'status',
      title: t('subtitlesOnHud'),
      ...(payload.label ? { detail: payload.label } : {}),
      duration: 4_000
    });
    return;
  }
  triggerCaptionHud({ kind: 'status', title: t('subtitlesOffHud') });
}

async function toggleTheaterCaptions(): Promise<void> {
  const wrapper = queryPlayerUi('.theater-controls-wrapper') as ExtendedHTMLDivElement | null;
  try {
    await wrapper?._mediaFeatures?.toggleCaptions();
  } catch (err) {
    console.error('[Theater Everywhere] Caption toggle failed:', err);
  }
}

function restoreTheaterElementInlineStyles(element: HTMLElement): void {
  const savedState = theaterElementInlineStyleState.get(element);
  if (!savedState) return;

  savedState.styles.forEach(({ property, value, priority }) => {
    if (value) {
      element.style.setProperty(property, value, priority);
    } else {
      element.style.removeProperty(property);
    }
  });

  element.style.removeProperty('--theater-object-fit');
  element.style.removeProperty('--theater-object-position');

  if (!savedState.hadStyleAttribute && element.getAttribute('style') === '') {
    element.removeAttribute('style');
  }

  theaterElementInlineStyleState.delete(element);
}

// Registered at document_start so this runs before host contextmenu blockers.
window.addEventListener('contextmenu', (event) => {
  if (!session.element || event.target !== session.element) return;
  event.stopImmediatePropagation();
}, true);

interface Listeners {
  keydown: ((event: KeyboardEvent) => void) | null;
  keyup: ((event: KeyboardEvent) => void) | null;
  mousemove: ((event: MouseEvent) => void) | null;
  play: ((event: Event) => void) | null;
  pause: ((event: Event) => void) | null;
  message: ((event: MessageEvent) => void) | null;
  navigate: (() => void) | null;
  playbackIntent: ((event: Event) => void) | null;
}

// Event listener references for clean removal
const listeners: Listeners = {
  keydown: null,
  keyup: null,
  mousemove: null,
  play: null,
  pause: null,
  message: null,
  navigate: null,
  playbackIntent: null
};

function applyConfiguredAccentColor(target: HTMLElement): void {
  applyAccentColorPreset(target, ui().accentColor);
}

function refreshExtensionAccentColor(): void {
  // Keep the value on both inheritance roots. Existing chrome nodes can have
  // their own inline value, so they are refreshed below as well.
  applyConfiguredAccentColor(document.documentElement);
  const playerUiHost = document.getElementById('theater-everywhere-ui');
  if (playerUiHost) applyConfiguredAccentColor(playerUiHost);

  const selector = [
    '.theater-controls-wrapper',
    '.theater-loading-indicator',
    '.theater-button-tooltip',
    '.theater-help-overlay',
    '.theater-everywhere-header-hud',
    '.theater-everywhere-title-hud',
    '.theater-cc-menu',
    '.theater-settings-menu',
    '.theater-everywhere-seek-overlay',
    '.theater-everywhere-volume-overlay',
    '.theater-everywhere-caption-hud',
    `.${VIDEO_ACTIVATOR_CLASS}`,
    '.te-dialog-overlay'
  ].join(',');
  for (const el of [
    ...document.querySelectorAll<HTMLElement>(selector),
    ...queryPlayerUiAll<HTMLElement>(selector)
  ]) {
    applyConfiguredAccentColor(el);
  }
}

let autoTheaterPolicyAllowed = false;
let settingsLoadEpoch = 0;
const autoTheaterVisit: { current: AutoTheaterVisit } = { current: { identity: null, entered: false } };
let autoTheaterRuntime: AutoTheaterRuntime | null = null;

function syncAutoTheaterRuntime(): void {
  if (!refs.isInitialized || !ui().autoEnterTheater || !autoTheaterPolicyAllowed || window !== window.top) {
    autoTheaterRuntime?.dispose();
    autoTheaterRuntime = null;
    return;
  }
  if (autoTheaterRuntime) {
    autoTheaterRuntime.refresh();
    return;
  }
  autoTheaterRuntime = createAutoTheaterRuntime({
    visit: autoTheaterVisit,
    enabled: () => ui().autoEnterTheater,
    skipCountdown: () => ui().autoTheaterSkipCountdown,
    policyAllowed: () => autoTheaterPolicyAllowed,
    providerFlags: () => refs.providerFlags,
    editableFocused: () => editableFieldFocused() || theaterDialogOpen(),
    theaterActive: () => session.hasUi,
    transitioning: () => refs.isTransitioning,
    findBestVideo,
    enter: enterTheaterMode,
    showNotice: (cancel, remainingMs, video) => showAutoTheaterNotice(paintOverlay, cancel, remainingMs, undefined,
      { video, theaterActive: () => session.hasUi })
  });
}

let videoActivator: VideoActivator | null = null;

/** Armed only where the toggle shortcut would work and nothing of ours is on screen. */
function syncVideoActivator(): void {
  const armed = refs.isInitialized && ui().videoActivator && autoTheaterPolicyAllowed
    && !ui().theaterActive && !isProviderPlaybackFrameDocument();
  if (!armed) {
    videoActivator?.dispose();
    videoActivator = null;
    return;
  }
  videoActivator ??= createVideoActivator({
    label: () => t('videoActivatorLabel'),
    shortcut: () => ui().shortcuts.toggle,
    paint: paintOverlay,
    activate: video => {
      // Same state the pointer path leaves behind, then the shortcut's own entry.
      pendingVideoPointer = null;
      refs.activeVideo = video;
      toggleTheaterMode();
    }
  });
  videoActivator.syncTitles();
}

function toggleAutoTheaterCommand(): void {
  if (autoTheaterAvailability(window.location.hostname, refs.providerFlags, window === window.top) !== 'available') return;
  const next = !ui().autoEnterTheater;
  uiStore.dispatch({ type: 'SET_AUTO_ENTER_THEATER', value: next });
  syncAutoTheaterRuntime();
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
      const player = refs.activeVideo;
      const controls = queryPlayerUi('.theater-controls-wrapper');
      void saveAutoTheaterEnabled(next, {
        mount: overlay => { mountPlayerUi(overlay); },
        isCurrent: () => refs.isInitialized && ui().theaterActive && refs.activeVideo === player && !!controls?.isConnected
      }).catch(error => {
        console.error('[Theater Everywhere] Could not save automatic theater entry:', error);
      });
    }
  } catch (error) {
    console.error('[Theater Everywhere] Could not save automatic theater entry:', error);
  }
}

let highlightSyncRevision = 0;
// Keep per-key live values until hydration settles: one key changing must not discard the other's snapshot.
const highlightLocalOverrides: Record<string, unknown> = {};

async function hydrateSeenThrough(): Promise<void> {
  const local = await readFeatureHighlightsLocal();
  uiStore.dispatch({ type: 'HYDRATE', value: { featureHighlights: withFeatureHighlightsLocal(ui().featureHighlights, { ...local, ...highlightLocalOverrides }, Date.now()) } });
}

async function checkBlacklistAndInit(): Promise<void> {
  const currentHostname = window.location.hostname;
  const epoch = ++settingsLoadEpoch;
  const languageRevision = languageRuntime.revision;
  // A pending policy read must never auto-enter under the previous blacklist.
  autoTheaterPolicyAllowed = false;

  if (typeof chrome === 'undefined' || !chrome.storage?.sync) {
    if (!refs.isInitialized) initialize();
    return;
  }

  try {
    const syncRevision = highlightSyncRevision;
    const data = await chrome.storage.sync.get([
      HIGHLIGHT_NEW_FEATURES_STORAGE_KEY,
      'blacklist',
      'shortcuts',
      LANGUAGE_STORAGE_KEY,
      AUTO_THEATER_STORAGE_KEY,
      AUTO_THEATER_SKIP_COUNTDOWN_STORAGE_KEY,
      VIDEO_ACTIVATOR_STORAGE_KEY,
      SPONSORBLOCK_STORAGE_KEY,
      VOLUME_BOOST_STORAGE_KEY,
      CHAT_PREFERENCES_STORAGE_KEY,
      KEEP_CONTROLS_VISIBLE_STORAGE_KEY,
      ...mediaProviderFlagStorageKeys(),
      ACCENT_COLOR_STORAGE_KEY,
      VIDEO_FIT_STORAGE_KEY,
      PICTURE_ALIGN_STORAGE_KEY,
      ...Object.values(AUDIO_STORAGE_KEYS),
      RAISE_ONLY_WITH_SUBTITLES_STORAGE_KEY,
      CAPTION_STYLE_STORAGE_KEY,
      CAPTION_PREF_STORAGE_KEY
    ]);
    if (epoch !== settingsLoadEpoch) return;
    await languageRuntime.set(data[LANGUAGE_STORAGE_KEY], languageRevision);
    if (epoch !== settingsLoadEpoch) return;
    const blacklist = (data.blacklist || []) as string[];
    hydrateChatPreferences(data[CHAT_PREFERENCES_STORAGE_KEY]);
    const saved = data.shortcuts || {};
    applyProviderFlags(resolveMediaProviderFlags(data as Record<string, unknown>));
    uiStore.dispatch({
      type: 'HYDRATE',
      value: {
        featureHighlights: { ...ui().featureHighlights, now: Date.now(),
          enabled: syncRevision === highlightSyncRevision
            ? resolveHighlightNewFeatures(data[HIGHLIGHT_NEW_FEATURES_STORAGE_KEY])
            : ui().featureHighlights.enabled },
        autoEnterTheater: resolveAutoEnterTheater(data[AUTO_THEATER_STORAGE_KEY]),
        autoTheaterSkipCountdown: resolveAutoTheaterSkipCountdown(data[AUTO_THEATER_SKIP_COUNTDOWN_STORAGE_KEY]),
        videoActivator: resolveVideoActivator(data[VIDEO_ACTIVATOR_STORAGE_KEY]),
        shortcuts: withShortcutDefaults(saved),
        videoFit: resolveVideoFitMode(data[VIDEO_FIT_STORAGE_KEY]),
        pictureAlign: resolvePictureAlign(data[PICTURE_ALIGN_STORAGE_KEY]),
        audio: resolveStoredAudioSettings(data),
        sponsorBlockMarkers: resolveSponsorBlockMarkers(data[SPONSORBLOCK_STORAGE_KEY]),
        volumeBoost: resolveVolumeBoostEnabled(data[VOLUME_BOOST_STORAGE_KEY]),
        raiseOnlyWithSubtitles: resolveRaiseOnlyWithSubtitles(data[RAISE_ONLY_WITH_SUBTITLES_STORAGE_KEY]),
        accentColor: resolveAccentColorPreset(data[ACCENT_COLOR_STORAGE_KEY]),
        captionStyle: resolveCaptionStyle(data[CAPTION_STYLE_STORAGE_KEY])
      }
    });
    applyKeepControlsVisible(data[KEEP_CONTROLS_VISIBLE_STORAGE_KEY]);
    applyTheaterVideoFit(ui().videoFit);
    applyCaptionStyleToTheater(ui().captionStyle);
    refs.captionPreferenceMap = resolveCaptionPreferenceMap(data[CAPTION_PREF_STORAGE_KEY]);
    
    const isBlacklisted = resolveDomainPolicy(currentHostname, blacklist).effective;
    autoTheaterPolicyAllowed = !isBlacklisted;

    // Nested provider frames stay active so YouTube/Vimeo embeds still work
    // when the provider hostname is excluded at the top-level site.
    let isTopFrame = true;
    try {
      isTopFrame = window === window.top;
    } catch {
      isTopFrame = false;
    }
    if (isBlacklisted && isTopFrame) {
      if (refs.isInitialized) {
        destroy();
      }
    } else {
      if (!refs.isInitialized) {
        initialize();
      }
    }
    syncAutoTheaterRuntime();
    syncVideoActivator();
    refreshExtensionAccentColor();
  } catch (err) {
    if (epoch !== settingsLoadEpoch) return;
    uiStore.dispatch({ type: 'SET_AUTO_ENTER_THEATER', value: false });
    syncAutoTheaterRuntime();
    console.error('[Theater Everywhere] Error loading settings:', err);
    // Safe fallback: initialize if storage fails
    if (!refs.isInitialized) {
      initialize();
    }
    refreshExtensionAccentColor();
  }
}

function getActiveElementDeep(): Element | null {
  let activeEl = document.activeElement;
  while (activeEl && activeEl.shadowRoot && activeEl.shadowRoot.activeElement) {
    activeEl = activeEl.shadowRoot.activeElement;
  }
  return activeEl;
}

function editableFieldFocused(activeEl = getActiveElementDeep() as HTMLElement | null): boolean {
  return Boolean(activeEl && (
    (activeEl.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'submit', 'image', 'file'].includes((activeEl as HTMLInputElement).type)) ||
    activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT' ||
    activeEl.isContentEditable || activeEl.getAttribute('role') === 'textbox'
  ));
}

function theaterDialogOpen(): boolean {
  return Boolean(queryPlayerUi('.te-dialog-overlay') || document.querySelector('.te-dialog-overlay'));
}

function handleVideoKey(e: KeyboardEvent, video: PlaybackSurface): boolean {
  const shortcuts = ui().shortcuts || defaultShortcuts;
  
  if (matchesShortcut(e, shortcuts.playPause)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    // Space is toggled in the page MAIN world so YouTube cannot steal the key.
    // That path announces the HUD through theater-everywhere-playback-intent.
    if (e.key === ' ' || e.code === 'Space') return true;
    executeCommand({ type: 'PLAY_PAUSE' });
  } else if (!e.repeat && matchesShortcut(e, shortcuts.previousVideo) && playlistNavigationAvailable().previous) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    activatePlaylistStep('previous');
  } else if (!e.repeat && matchesShortcut(e, shortcuts.nextVideo) && playlistNavigationAvailable().next) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    activatePlaylistStep('next');
  } else if (matchesShortcut(e, shortcuts.seekBack)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    executeCommand({ type: 'SEEK_BY', delta: -5 });
  } else if (matchesShortcut(e, shortcuts.seekForward)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    executeCommand({ type: 'SEEK_BY', delta: 5 });
  } else if (matchesShortcut(e, shortcuts.frameBack)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    executeCommand({ type: 'SEEK_BY', delta: -0.04 });
  } else if (matchesShortcut(e, shortcuts.frameForward)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    executeCommand({ type: 'SEEK_BY', delta: 0.04 });
  } else if (matchesShortcut(e, shortcuts.volumeUp)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    adjustVolume(video, 'up');
  } else if (matchesShortcut(e, shortcuts.volumeDown)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    adjustVolume(video, 'down');
  } else if (matchesShortcut(e, shortcuts.toggleMute)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    toggleVideoMute(video);
  } else if (matchesShortcut(e, shortcuts.togglePiP)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    togglePictureInPicture(video);
  } else if (matchesShortcut(e, shortcuts.toggleFullscreen)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (refs.currentToggleFullscreen) {
      refs.currentToggleFullscreen();
    }
  } else if (matchesShortcut(e, shortcuts.increaseCaptionSize)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    executeCommand({ type: 'STEP_CAPTION_SIZE', direction: 1 });
  } else if (matchesShortcut(e, shortcuts.decreaseCaptionSize)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    executeCommand({ type: 'STEP_CAPTION_SIZE', direction: -1 });
  } else {
    return false;
  }
  return true;
}

// Setup event listeners
function initialize(): void {
  if (refs.isInitialized) return;

  session.resetRuntimeScope();
  session.runtimeScope.add(() => {
    autoTheaterRuntime?.dispose();
    autoTheaterRuntime = null;
    videoActivator?.dispose();
    videoActivator = null;
    pendingVideoPointer = null;
    refs.activeVideo = null;
  });

  const publishEntryShortcuts = () => {
    const shortcuts = ui().shortcuts;
    const config = JSON.stringify({
      toggle: shortcuts.toggle,
      fullscreen: shortcuts.toggleFullscreen,
      exit: shortcuts.exit,
      playPause: shortcuts.playPause,
      seekBack: shortcuts.seekBack,
      seekForward: shortcuts.seekForward
    });
    if (document.documentElement.getAttribute(ENTRY_SHORTCUT_ATTRIBUTE) !== config) {
      document.documentElement.setAttribute(ENTRY_SHORTCUT_ATTRIBUTE, config);
    }
  };
  session.runtimeScope.add(uiStore.subscribe(publishEntryShortcuts));
  session.runtimeScope.add(uiStore.subscribe(syncVideoActivator));
  publishEntryShortcuts();

  // 1. Keyboard Listener (T and Escape)
  const claimedKeyReleases = new Set<string>();
  const handleKeydown = (event: KeyboardEvent): boolean => {
    if (event.isComposing || isChatDocument(window.location.href) || isNativeChatEvent(event)) return false;
    if (ui().helpOpen && !refs.helpOverlay?.isConnected) {
      hideHelpOverlay(false);
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return true;
      }
    }
    // Ignore key presses in inputs/textareas/editable elements (including inside Shadow DOM)
    const activeEl = getActiveElementDeep() as HTMLElement | null;
    const isEditable = editableFieldFocused(activeEl);
    if (isEditable) return false;
    if (activeEl?.matches('.theater-cc-menu-item') && ['ArrowUp', 'ArrowDown', 'Escape'].includes(event.key)) return false;
    if (activeEl?.matches('input[type=range]')
        && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return false;
    if (event.key === 'Escape') {
      // The slider panel consumes Escape only while it is open (see bindSliderPopover).
      const sliderPanel = activeEl?.closest('.theater-volume-container, .theater-speed-container')
        ?.querySelector<HTMLElement>('.theater-volume-panel, .theater-speed-panel');
      if (sliderPanel && !sliderPanel.inert) return false;
      // A keyboard-revealed title consumes the first Escape (see dismissTitleReveal in hud.ts).
      if (activeEl?.matches(`.${TITLE_HUD_CLASS}:focus-visible`)) return false;
    }
    if (activeEl?.matches('.theater-scrubber-container')
        && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return false;
    if (theaterDialogOpen()) return false;

    // The announced automatic entry is cancelled by Escape like by a click, and the
    // key then belongs to the notice: it neither reaches the host nor exits anything.
    if ((event.key === 'Escape' || event.key === 'Esc') && autoTheaterRuntime?.cancelPending()) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return true;
    }

    const shortcuts = ui().shortcuts || defaultShortcuts;

    // Let native menu buttons and the duration toggle activate with Space/Enter.
    if (!ui().helpOpen && activeEl?.closest(PLAYER_NATIVE_ACTIVATION_SELECTOR)
        && (event.key === ' ' || event.key === 'Enter')) {
      event.stopPropagation();
      event.stopImmediatePropagation();
      return false;
    }

    if (event.key === 'Escape' || event.key === 'Esc') {
      const openMenu = queryPlayerUi<HTMLElement>('.theater-menu.is-open');
      if (closeMenuPopover(openMenu, true)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        updateCaptionDock();
        return true;
      }
    }

    if (session.element && matchesShortcut(event, shortcuts.toggleControlsPin)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (!ui().helpOpen && !event.repeat) executeCommand({ type: 'TOGGLE_CONTROLS_PIN' });
      return true;
    }

    if (session.element && matchesShortcut(event, shortcuts.cycle)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      executeCommand({ type: 'CYCLE_VIDEO', direction: 'next' });
      return true;
    }

    if (session.element && matchesShortcut(event, shortcuts.cycleLayout)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (!ui().helpOpen && !event.repeat) executeCommand({ type: 'CYCLE_LAYOUT' });
      return true;
    }

    if (session.element && matchesShortcut(event, shortcuts.cycleFit)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      executeCommand({ type: 'CYCLE_FIT' });
      return true;
    }

    const audioSetting = AUDIO_SETTING_NAMES.find((name) => matchesShortcut(event, shortcuts[AUDIO_SHORTCUTS[name]]));
    const volumeBoostKey = matchesShortcut(event, shortcuts.toggleVolumeBoost);
    if (session.element && (audioSetting || volumeBoostKey)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (!ui().helpOpen && !event.repeat) {
        executeCommand(audioSetting ? { type: 'CYCLE_AUDIO', setting: audioSetting } : { type: 'TOGGLE_VOLUME_BOOST' });
      }
      return true;
    }

    if (session.element && nativeChatState()?.available && matchesShortcut(event, shortcuts.toggleChat)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (!ui().helpOpen && !event.repeat) executeCommand({ type: 'TOGGLE_CHAT' });
      return true;
    }

    if (session.element && matchesShortcut(event, shortcuts.toggleCaptions)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      executeCommand({ type: 'TOGGLE_CAPTIONS' });
      return true;
    }

    if (session.element && matchesShortcut(event, shortcuts.increaseCaptionSize)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      executeCommand({ type: 'STEP_CAPTION_SIZE', direction: 1 });
      return true;
    }

    if (session.element && matchesShortcut(event, shortcuts.decreaseCaptionSize)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      executeCommand({ type: 'STEP_CAPTION_SIZE', direction: -1 });
      return true;
    }

    if (session.element && matchesShortcut(event, shortcuts.showHelp)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      executeCommand({ type: 'TOGGLE_HELP' });
      return true;
    }

    if (matchesShortcut(event, shortcuts.toggle)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (!event.repeat) {
        if (isProviderPlaybackFrameDocument()) {
          frames.postToParent('FRAME_HOST_TOGGLE', createSessionId(), { action: 'toggle' });
        } else {
          toggleTheaterMode();
        }
      }
      return true;
    } else if (matchesShortcut(event, shortcuts.toggleFullscreen)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (!event.repeat) {
        if (isProviderPlaybackFrameDocument()) {
          frames.postToParent('FRAME_HOST_TOGGLE', createSessionId(), { action: 'fullscreen' });
        } else {
          claimFullscreenShortcut();
        }
      }
      return true;
    } else if (matchesShortcut(event, shortcuts.exit) || event.key === 'Escape' || event.key === 'Esc') {
      if (session.hasUi) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        exitTheaterMode();
        return true;
      }
    } else if (session.element) {
      const surface = sessionSurface();
      if (surface) {
        return handleVideoKey(event, surface);
      } else if (session.element.tagName === 'IFRAME') {
        const iframe = session.element as HTMLIFrameElement;
        if (iframe.contentWindow) {
          const previous = matchesShortcut(event, shortcuts.previousVideo);
          const next = matchesShortcut(event, shortcuts.nextVideo);
          const claimed = matchesShortcut(event, shortcuts.playPause) ||
            (!event.repeat && previous && refs.childPlaylistNav.previous) ||
            (!event.repeat && next && refs.childPlaylistNav.next) ||
            matchesShortcut(event, shortcuts.seekBack) ||
            matchesShortcut(event, shortcuts.seekForward) ||
            matchesShortcut(event, shortcuts.frameBack) ||
            matchesShortcut(event, shortcuts.frameForward) ||
            matchesShortcut(event, shortcuts.toggleMute) ||
            matchesShortcut(event, shortcuts.increaseCaptionSize) ||
            matchesShortcut(event, shortcuts.decreaseCaptionSize);
          if ((previous || next) && !claimed) return false;
          frames.postToChildIframe(iframe, 'PLAYBACK_COMMAND', session.id || createSessionId(), {
            key: event.key,
            code: event.code,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
            metaKey: event.metaKey,
            repeat: event.repeat
          });
          if (claimed) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            return true;
          }
        }
      }
    }
    return false;
  };
  listeners.keydown = (event: KeyboardEvent) => {
    // defaultPrevented can belong to an earlier host listener, not this handler.
    if (handleKeydown(event)) claimedKeyReleases.add(event.code || event.key);
  };
  session.runtimeScope.listen(window, 'keydown', listeners.keydown!, true);
  session.runtimeScope.listen(window, 'blur', () => claimedKeyReleases.clear());
  session.runtimeScope.listen(window, ENTRY_SHORTCUT_EVENT, (event: Event) => {
    if (isChatDocument(window.location.href)) return;
    if (!refs.isInitialized || typeof (event as CustomEvent).detail !== 'string') return;
    try {
      const data = JSON.parse((event as CustomEvent<string>).detail);
      if (!data || typeof data.key !== 'string' || typeof data.code !== 'string'
          || !['ctrlKey', 'altKey', 'shiftKey', 'metaKey', 'repeat'].every(key => typeof data[key] === 'boolean')) return;
      const key = new KeyboardEvent('keydown', { ...data, cancelable: true });
      if (!matchesShortcut(key, ui().shortcuts.toggle) && !matchesShortcut(key, ui().shortcuts.toggleFullscreen)
          && !matchesShortcut(key, ui().shortcuts.exit)) return;
      listeners.keydown?.(key);
      if (key.defaultPrevented) event.preventDefault();
    } catch { /* Ignore malformed page events. */ }
  });
  listeners.playbackIntent = (event: Event) => {
    const action = (event as CustomEvent<{ action?: 'play' | 'pause' }>).detail?.action;
    if (action === 'play' || action === 'pause') {
      refs.playbackDecisionRevision += 1;
      triggerPlaybackIndicator(action);
    }
  };
  session.runtimeScope.listen(window, 'theater-everywhere-playback-intent', listeners.playbackIntent);
  listeners.keyup = (event: KeyboardEvent) => {
    if (event.isComposing || isChatDocument(window.location.href) || isNativeChatEvent(event)) return;
    const key = event.code || event.key;
    if (claimedKeyReleases.has(key)) {
      if (event.type === 'keyup') claimedKeyReleases.delete(key);
      // Tencent handles playback on release. Suppress only gestures claimed on
      // keydown, including Escape and T after they have exited the session.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    if (ui().helpOpen && !refs.helpOverlay?.isConnected) {
      hideHelpOverlay(false);
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }
    }
    const activeEl = getActiveElementDeep() as HTMLElement | null;
    if (!ui().helpOpen && activeEl?.closest(PLAYER_NATIVE_ACTIVATION_SELECTOR)
        && (event.key === ' ' || event.key === 'Enter')) {
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    const isEditable = editableFieldFocused(activeEl);
    if (isEditable) return;
    if (theaterDialogOpen()) return;
    const shortcuts = ui().shortcuts || defaultShortcuts;
    if (matchesShortcut(event, shortcuts.toggleFullscreen)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    if (!session.element) return;
    if (matchesShortcut(event, shortcuts.playPause)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  };
  session.runtimeScope.listen(window, 'keyup', listeners.keyup!, true);
  session.runtimeScope.listen(window, 'keypress', listeners.keyup!, true);

  // 2. Remember the composed path without scanning DOM or retaining the event.
  listeners.mousemove = (event: MouseEvent) => {
    pendingVideoPointer = {
      path: event.composedPath().filter((target): target is Node => target instanceof Node)
        .map(target => new WeakRef(target)),
      href: window.location.href
    };
  };
  session.runtimeScope.listen(document, 'mousemove', listeners.mousemove!, { passive: true });

  // 3. Play/Pause event tracking
  listeners.play = (event: Event) => {
    const path = event.composedPath();
    const video = path[0];
    if (video && video instanceof HTMLVideoElement) {
      // A later playback event wins over an unresolved earlier mousemove.
      pendingVideoPointer = null;
      refs.activeVideo = video;
    }
  };
  session.runtimeScope.listen(document, 'play', listeners.play!, true); // Use capture phase since 'play' does not bubble

  listeners.pause = (_event: Event) => {
    // Track pause events to keep refs.activeVideo reference fresh if needed
  };
  session.runtimeScope.listen(document, 'pause', listeners.pause!, true); // Use capture phase since 'pause' does not bubble

  // 4. Cross-iframe postMessage listener
  listeners.message = (event: MessageEvent) => {
    if (isChatShortcutMessage(event.data)) {
      // Only the chat frame this page embeds may drive the toggle, like its own key.
      const chat = nativeChatState();
      if (session.element && chat?.available && chat.surface?.iframe?.contentWindow === event.source
          && event.origin === window.location.origin && !ui().helpOpen && !theaterDialogOpen()) {
        executeCommand({ type: 'TOGGLE_CHAT' });
      }
      return;
    }
    const hostToggle = readProviderHostToggle(event, {
      hostname: window.location.hostname,
      href: window.location.href,
      root: document
    });
    if (hostToggle) {
      if (hostToggle.action === 'toggle') {
        if (session.element === hostToggle.host && session.hasUi) exitTheaterMode('local');
        else if (!session.hasUi) enterTheaterMode(hostToggle.host);
      } else if (!session.hasUi || session.element === hostToggle.host) {
        if (!session.hasUi) enterTheaterMode(hostToggle.host);
        if (session.element === hostToggle.host) {
          if (refs.currentToggleFullscreen) refs.currentToggleFullscreen();
          else toggleDocumentFullscreen();
        }
      }
      focusTheaterPage();
      return;
    }
    const trusted = frames.readTrusted(event, session.id, session.nonce);
    if (!trusted) return;
    const { envelope, fromParent, fromChild } = trusted;
    const iframes = Array.from(document.querySelectorAll('iframe'));

    if (envelope.type === 'FRAME_TOGGLE') {
      toggleTheaterMode();
    } else if (envelope.type === 'FRAME_FULLSCREEN') {
      claimFullscreenShortcut();
    } else if (envelope.type === 'FRAME_ENTER' && fromChild) {
      const iframe = iframes.find((item) => item.contentWindow === event.source);
      if (iframe) {
        enterTheaterMode(iframe, envelope.sessionId, envelope.nonce);
        // Tells the frame this page mirrors its session, so its fullscreen requests come here.
        if (session.element === iframe && session.id === envelope.sessionId) {
          frames.postToChildIframe(iframe, 'FRAME_ENTER', envelope.sessionId, {}, envelope.nonce);
        }
      }
    } else if (envelope.type === 'FRAME_ENTER' && fromParent) {
      if (session.hasUi && envelope.sessionId === session.id) refs.embedderLinked = true;
    } else if (envelope.type === 'FRAME_EXIT') {
      exitTheaterMode('network', envelope.sessionId, fromParent ? 'parent' : 'child');
    } else if (envelope.type === 'FRAME_EXITED') {
      return;
    } else if (envelope.type === 'PLAYBACK_COMMAND') {
      if (session.element && session.element.tagName === 'VIDEO') {
        const video = session.element as HTMLVideoElement;
        handleVideoKey({
          key: envelope.payload.key,
          code: envelope.payload.code,
          ctrlKey: envelope.payload.ctrlKey,
          altKey: envelope.payload.altKey,
          shiftKey: envelope.payload.shiftKey,
          metaKey: envelope.payload.metaKey,
          repeat: envelope.payload.repeat === true,
          preventDefault: () => {},
          stopPropagation: () => {},
          stopImmediatePropagation: () => {}
        } as KeyboardEvent, nativePlaybackSurface(video));
      }
    } else if (envelope.type === 'PLAYLIST_NAV_QUERY' && fromChild) {
      const actions = findPlaylistActions(document);
      const iframe = iframes.find((item) => item.contentWindow === event.source);
      if (iframe) {
        if (session.element === iframe) {
          refs.childPlaylistNav = playlistNavFromPayload(envelope.payload);
          requestParentPlaylistNav();
        }
        frames.postToChildIframe(
          iframe,
          'PLAYLIST_NAV_STATE',
          envelope.sessionId,
          playlistNavStateFromActions(actions),
          envelope.nonce
        );
      }
    } else if (envelope.type === 'PLAYLIST_NAV_STATE' && fromParent) {
      const next = playlistNavFromPayload(envelope.payload);
      if (JSON.stringify(next) !== JSON.stringify(refs.parentPlaylistNav)) {
        refs.parentPlaylistNav = next;
        window.dispatchEvent(new CustomEvent('theater-everywhere-playlist-nav'));
      }
    } else if (envelope.type === 'PLAYLIST_NAV_GO' && fromChild) {
      const direction = envelope.payload.direction;
      if (direction === 'previous' || direction === 'next') {
        findPlaylistActions(document).find((action) => action.direction === direction)?.activate();
      }
    }
  };
  session.runtimeScope.listen(window, 'message', listeners.message!);
  // A reloaded or navigated frame drops its session without telling the embedding page, which
  // would stay pinned in theater around a frame that no longer has our UI.
  session.runtimeScope.listen(window, 'pagehide', () => {
    if (window !== window.top && session.hasUi && session.id) frames.postToParent('FRAME_EXIT', session.id);
  });

  // 5. SPA navigation listener — auto-exit theater mode when page navigates away
  listeners.navigate = () => {
    if ((session.element && !isElementInDOMDeep(session.element)) || (session.id && session.element && !isElementInDOMDeep(session.element))) {
      exitTheaterMode();
    }
    refs.activeVideo = null;
    pendingVideoPointer = null;
  };
  session.runtimeScope.listen(window, 'popstate', listeners.navigate!);

  refs.isInitialized = true;
  syncAutoTheaterRuntime();
  syncVideoActivator();
}

// Cleanup and remove listeners
function destroy(): void {
  if (!refs.isInitialized) return;

  if (session.hasUi) {
    exitTheaterMode();
  }

  if (refs.toolbarTimer) {
    clearTimeout(refs.toolbarTimer);
    refs.toolbarTimer = null;
  }

  session.resetRuntimeScope();
  document.documentElement.removeAttribute(ENTRY_SHORTCUT_ATTRIBUTE);
  listeners.keydown = null;
  listeners.keyup = null;
  listeners.mousemove = null;
  listeners.play = null;
  listeners.pause = null;
  listeners.message = null;
  listeners.navigate = null;
  listeners.playbackIntent = null;

  refs.isInitialized = false;
}

function toggleDocumentFullscreen(): void {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
    return;
  }
  if (requestEmbedderFullscreen()) return;
  document.documentElement.requestFullscreen().catch(() => {});
}

function focusTheaterPage(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body && active !== document.documentElement) {
    active.blur();
  }
  window.focus();
}

function findTheaterTarget(): HTMLElement | null {
  return findProviderTheaterTarget({ findBestVideo, findAllVideosDeep });
}

function releaseProviderPlayback(): void {
  removeWasmCatcher?.();
  removeWasmCatcher = null;
  providerPlayback?.dispose();
  providerPlayback = null;
}

function mountWasmCatcher(): void {
  removeWasmCatcher?.();
  const root = getPlayerUiRoot();
  const catcher = document.createElement('div');
  catcher.className = 'theater-wasm-catcher';
  root.insertBefore(catcher, root.firstChild);
  removeWasmCatcher = bindWasmCatcher(catcher);
}

function attachProviderPlayback(element: HTMLElement): void {
  const epoch = session.currentEpoch;
  providerPlayback = openProviderPlaybackSession(element, {
    isCurrent: () => session.element === element && session.currentEpoch === epoch && !session.isExiting,
    onReplacement: rebindProviderPlayback
  });
  if (!providerPlayback) return;
  if (element.shadowRoot) injectStylesIntoShadowRoot(element.shadowRoot);
  createCustomControls(providerPlayback.surface);
  if (providerPlayback.needsPointerCatcher) mountWasmCatcher();
}

function rebindProviderPlayback(next: HTMLElement): void {
  const previous = session.element;
  destroyCustomControls();
  releaseProviderPlayback();
  if (previous) {
    unmarkTheaterVideo(previous);
    restoreTheaterElementInlineStyles(previous);
  }
  session.rebind(next);
  session.activate();
  markTheaterVideo(next);
  remountProviderStages(window.location.hostname, next);
  applyTheaterElementInlineStyles(next);
  refreshTheaterAncestors(next);
  attachProviderPlayback(next);
}

function fullscreenTheaterTarget(): HTMLElement | null {
  refreshPointerVideo();
  return providerFullscreenTarget(refs.activeVideo, findTheaterTarget);
}

function claimFullscreenShortcut(): void {
  if (session.hasUi) {
    if (refs.currentToggleFullscreen) refs.currentToggleFullscreen();
    else toggleDocumentFullscreen();
    return;
  }
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
    return;
  }
  const target = fullscreenTheaterTarget();
  if (target) {
    enterTheaterMode(target);
    if (refs.currentToggleFullscreen) refs.currentToggleFullscreen();
    else toggleDocumentFullscreen();
    return;
  }
  frames.postToAllChildren('FRAME_FULLSCREEN', createSessionId(), {}, createSessionId());
}

function toggleTheaterMode(): void {
  if (refs.isTransitioning) return;
  refs.isTransitioning = true;
  setTimeout(() => {
    refs.isTransitioning = false;
    autoTheaterRuntime?.refresh();
  }, 200);

  if (session.hasUi) {
    exitTheaterMode('local');
  } else {
    const target = findTheaterTarget();
    if (target) {
      enterTheaterMode(target);
    } else {
      frames.postToAllChildren('FRAME_TOGGLE', createSessionId(), {}, createSessionId());
    }
  }
}

/** How long a video may sit off its playback surface before theater ends. */
const LOST_SURFACE_GRACE_MS = 750;

function keepTheaterVideoBound(video: HTMLVideoElement): void {
  const bindingScope = session.runtimeScope.child();
  // Hosts flip the watch surface to `hidden` for a frame while switching videos, so a lost
  // surface must persist before it ends the session. Owned by the binding; one recheck at a time.
  let surfaceRecheck: DisposableScope | null = null;
  const cancelSurfaceRecheck = (): void => {
    surfaceRecheck?.dispose();
    surfaceRecheck = null;
  };
  bindingScope.add(cancelSurfaceRecheck);
  const followReplacement = (replacement: HTMLVideoElement): void => {
    bindingScope.dispose();
    switchTheaterVideo(replacement);
    keepTheaterVideoBound(replacement);
  };
  const rebindIfReplaced = (candidate?: HTMLVideoElement): void => {
    if (bindingScope.isDisposed) return;
    const current = session.element;
    if (current?.tagName !== 'VIDEO') return;
    const connected = isElementInDOMDeep(current);
    if (connected && hasLeftPlaybackSurface(current as HTMLVideoElement)) {
      // Navigating away leaves the video in a hidden watch page or the miniplayer, not a theater.
      const replacement = findBestVideo();
      if (replacement && replacement !== current) {
        followReplacement(replacement);
      } else if (!surfaceRecheck) {
        const recheck = bindingScope.child();
        surfaceRecheck = recheck;
        recheck.timeout(() => {
          surfaceRecheck = null;
          if (session.element !== current || !isElementInDOMDeep(current)) return;
          if (!hasLeftPlaybackSurface(current as HTMLVideoElement)) return;
          const next = findBestVideo();
          if (next && next !== current) followReplacement(next);
          else exitTheaterMode();
        }, LOST_SURFACE_GRACE_MS);
      }
      return;
    }
    cancelSurfaceRecheck();
    if (connected && !isInactiveStandbyVideo(current as HTMLVideoElement) && !providerVideoAbandoned(current as HTMLVideoElement)) return;

    const replacement = candidate && candidate !== current && isElementInDOMDeep(candidate)
      && !isInactiveStandbyVideo(candidate)
      ? candidate
      : findBestVideo();
    // Hosts can swap between connected video nodes while changing playback.
    // Wait for the visible replacement's metadata instead of loading its source ourselves.
    if (connected && (!replacement || replacement.readyState < 1
      || !providerSharesPlaybackHost(current as HTMLVideoElement, replacement))) return;
    if (replacement && replacement !== current) followReplacement(replacement);
  };

  let ignoreStyleMutations = 0;
  let stabilizeScheduled = false;
  let hostRelayoutQueued = false;
  const stabilizeLayout = (target: HTMLVideoElement, relayoutHost = false): void => {
    if (session.element !== target) return;
    ignoreStyleMutations += 1;
    try {
      if (!target.hasAttribute(THEATER_VIDEO_ATTR)) {
        target.setAttribute(THEATER_VIDEO_ATTR, '');
      }
      ensureProviderStages(window.location.hostname, target);
      applyTheaterElementInlineStyles(target);
      if (relayoutHost) hostRelayoutQueued = true;
    } finally {
      queueMicrotask(() => {
        ignoreStyleMutations -= 1;
      });
    }
    if (hostRelayoutQueued) {
      hostRelayoutQueued = false;
      refreshHostPlayerLayout();
    }
  };

  const scheduleStabilize = (relayoutHost = false): void => {
    if (relayoutHost) hostRelayoutQueued = true;
    if (stabilizeScheduled) return;
    stabilizeScheduled = true;
    bindingScope.raf(() => {
      stabilizeScheduled = false;
      const target = session.element;
      if (!(target instanceof HTMLVideoElement)) return;
      stabilizeLayout(target, false);
    });
  };

  let pictureLayoutScheduled = false;
  const schedulePictureLayout = (): void => {
    if (pictureLayoutScheduled) return;
    pictureLayoutScheduled = true;
    bindingScope.raf(() => {
      pictureLayoutScheduled = false;
      if (session.element?.tagName !== 'VIDEO') return;
      applyTheaterPictureLayout();
    });
  };
  bindingScope.listen(window, 'resize', schedulePictureLayout);
  bindingScope.listen(document, 'resize', (event: Event) => {
    if (event.target === session.element) schedulePictureLayout();
  }, true);
  bindingScope.listen(document, 'fullscreenchange', schedulePictureLayout);

  const holdViewport = (): void => {
    if (session.element !== video) return;
    refreshTheaterAncestors(video);
    stabilizeLayout(video, true);
  };
  bindingScope.listen(video, 'emptied', holdViewport);
  bindingScope.listen(document, 'yt-navigate-start', holdViewport);
  bindingScope.listen(video, 'loadedmetadata', () => scheduleStabilize(true));
  bindingScope.listen(document, 'loadedmetadata', (event: Event) => {
    const candidate = event.target;
    if (!(candidate instanceof HTMLVideoElement)) return;
    if (candidate === session.element) {
      scheduleStabilize(true);
      return;
    }
    rebindIfReplaced(candidate);
  }, true);

  let structuralPending = false;
  let rebindScheduled = false;
  const observer = new MutationObserver((records) => {
    if (records.some((record) => record.type === 'childList')) structuralPending = true;
    if (rebindScheduled) return;
    rebindScheduled = true;
    bindingScope.raf(() => {
      rebindScheduled = false;
      const structural = structuralPending;
      structuralPending = false;
      rebindIfReplaced();
      if (!structural || !session.element) return;
      onProviderStructuralMutation(session.element, {
        connected: isElementInDOMDeep,
        refreshAncestors: refreshTheaterAncestors
      });
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  bindingScope.add(() => observer.disconnect());

  const styleObserver = new MutationObserver(() => {
    if (ignoreStyleMutations > 0 || session.element !== video) return;
    rebindIfReplaced();
    if (session.element !== video) return;
    if (!theaterVideoNeedsRestyle(video)) return;
    scheduleStabilize(false);
  });
  styleObserver.observe(video, { attributes: true, attributeFilter: ['style', THEATER_VIDEO_ATTR] });
  bindingScope.add(() => styleObserver.disconnect());

  const stopProviderPlayback = bindProviderPlayback({
    root: document.documentElement,
    video,
    current: () => (
      session.element instanceof HTMLVideoElement && isElementInDOMDeep(session.element)
        ? session.element
        : null
    ),
    pick: () => findBestVideo(),
    onSwitch: (next) => {
      switchTheaterVideo(next);
      if (session.element !== next) return;
      bindingScope.dispose();
      keepTheaterVideoBound(next);
    },
    onStabilize: (target) => {
      if (session.element !== target || !theaterVideoNeedsRestyle(target)) return;
      scheduleStabilize(false);
    }
  });
  bindingScope.add(stopProviderPlayback);
}

function refreshTheaterAncestors(element: HTMLElement): void {
  const next: HTMLElement[] = [];
  let parent: Node | null = element.parentNode;
  while (parent && parent !== document.documentElement) {
    if (parent instanceof ShadowRoot) {
      injectStylesIntoShadowRoot(parent);
      parent = parent.host;
      continue;
    }
    if (parent instanceof HTMLElement) {
      parent.classList.add('theater-everywhere-parent-active');
      next.push(parent);
    }
    parent = parent.parentNode;
  }
  for (const previous of refs.ancestorsList) {
    if (previous?.classList && !next.includes(previous)) {
      previous.classList.remove('theater-everywhere-parent-active');
    }
  }
  refs.ancestorsList = next;
}

function enterTheaterMode(element: HTMLElement, sessionId?: string, nonce?: string): void {
  if (session.element) return;

  session.rebind(element, sessionId, nonce);
  refs.childPlaylistNav = emptyPlaylistNav();
  uiStore.dispatch({ type: 'SET_THEATER_ACTIVE', value: true });

  // If the active video is inside a Shadow DOM, inject styling into its root node
  const rootNode = element.getRootNode();
  if (rootNode instanceof ShadowRoot) {
    injectStylesIntoShadowRoot(rootNode);
  }

  // Sample native chat before provider presentation can hide the page's panels.
  startNativeChatSession(() => {
    if (session.element) applyTheaterElementInlineStyles(session.element);
    updateCaptionDock();
    window.dispatchEvent(new CustomEvent('theater-everywhere-chat-layout'));
  });
  markTheaterVideo(element);
  mountTheaterStage();
  mountProviderStages(window.location.hostname, element);
  applyTheaterElementInlineStyles(element);

  // Specific setup for HTML5 <video> elements
  if (element.tagName === 'VIDEO') {
    const video = element as HTMLVideoElement;
    // Save original controls attribute state
    const originalControls = video.hasAttribute('controls');
    video.dataset.originalControls = originalControls ? 'true' : 'false';
    
    // Hide browser native controls so we use our custom controls overlay instead
    video.removeAttribute('controls');

    // Force loading of paused/unloaded videos to display the initial frame instead of a gray/black screen.
    // Skip empty players (Vimeo before its own Play attaches DASH/HLS) — load() there fetches nothing
    // and a later video.play() can hide the host overlay without ever starting media.
    if (video.readyState === 0 && mediaHasSource(video)) {
      video.preload = 'auto';
      video.load();
    }

    // Prepare only cross-origin files that need CORS. Open sources keep
    // their decoded frame; saved audio settings share the same entry path.
    cancelAudioReload?.();
    cancelAudioReload = null;
    if (audioProcessingRequested()) prepareWebAudio(video);

    // Isolate pointer and mouse events to block double-toggles in custom players
    const eventTypes = ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'];
    eventTypes.forEach(type => {
      video.addEventListener(type, preventDoubleToggle, true);
    });
  }

  refreshTheaterAncestors(element);

  // Lock scrollbars on body/html
  document.body.classList.add('theater-everywhere-body-active');
  document.documentElement.classList.add('theater-everywhere-html-active');

  // If we are in an iframe, notify the parent document to expand the iframe itself
  if (window !== window.top && session.id) {
    frames.postToParent('FRAME_ENTER', session.id);
  }
  session.activate();

  if (element.tagName === 'VIDEO') {
    createCustomControls(element as HTMLVideoElement);
    keepTheaterVideoBound(element as HTMLVideoElement);
  } else {
    attachProviderPlayback(element);
    focusTheaterPage();
  }
}

// Exit theater mode
function exitTheaterMode(
  origin: 'local' | 'network' = 'local',
  sessionId?: string,
  from: 'parent' | 'child' | 'self' = 'self'
): void {
  if (!session.dispatch({ type: 'EXIT', origin, sessionId, from })) return;
  const closedSessionId = session.id;
  cancelAudioReload?.();
  cancelAudioReload = null;
  try {
  hideHelpOverlay(false);
  stopNativeChatSession();

  if (document.fullscreenElement) {
    document.exitFullscreen().catch(console.error);
  }

  // Restore HTML5 video attributes
  if (session.element && session.element.tagName === 'VIDEO') {
    const video = session.element as HTMLVideoElement;
    const originalControls = video.dataset.originalControls;
    if (originalControls === 'true') {
      video.setAttribute('controls', 'true');
    } else {
      video.removeAttribute('controls');
    }
    delete video.dataset.originalControls;

    // Clean up event isolation blockers
    const eventTypes = ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'];
    eventTypes.forEach(type => {
      video.removeEventListener(type, preventDoubleToggle, true);
    });
    cancelPictureClick();

    video.classList.remove('controls-visible');
  }

  releaseAudioSettings();
  if (session.element && (session.element.tagName === 'VIDEO' || providerPlayback)) {
    destroyCustomControls();
  }
  releaseProviderPlayback();

  if (session.element) {
    unmarkTheaterVideo(session.element);
    restoreTheaterElementInlineStyles(session.element);
  }

  // Restore ancestors styling
  refs.ancestorsList.forEach(parent => {
    if (parent && parent.classList) {
      parent.classList.remove('theater-everywhere-parent-active');
    }
  });
  refs.ancestorsList = [];

  // Restore scrollbars
  document.body.classList.remove('theater-everywhere-body-active');
  document.documentElement.classList.remove('theater-everywhere-html-active');
  if (pictureMoveTimer !== undefined) {
    window.clearTimeout(pictureMoveTimer);
    pictureMoveTimer = undefined;
  }
  refs.subtitlesOn = false;
  document.documentElement.classList.remove('theater-everywhere-picture-moving');
  document.documentElement.classList.remove('theater-everywhere-picture-top');
  unmountTheaterStage();
  unmountProviderStages();
  document.documentElement.style.removeProperty('--theater-letterbox');
  document.documentElement.style.removeProperty('--theater-hud-center-y');

  refreshHostPlayerLayout();

  if (closedSessionId) {
    if (origin === 'local') {
      if (session.element && session.element.tagName === 'IFRAME') {
        frames.postToChildIframe(session.element as HTMLIFrameElement, 'FRAME_EXIT', closedSessionId);
      } else {
        frames.postToAllChildren('FRAME_EXIT', closedSessionId);
      }
      frames.postToParent('FRAME_EXIT', closedSessionId);
    } else if (from === 'child') {
      frames.postToAllChildren('FRAME_EXITED', closedSessionId);
      frames.postToParent('FRAME_EXIT', closedSessionId);
    } else {
      frames.postToParent('FRAME_EXITED', closedSessionId);
      frames.postToAllChildren('FRAME_EXIT', closedSessionId);
    }
  }

  refs.parentPlaylistNav = emptyPlaylistNav();
  refs.childPlaylistNav = emptyPlaylistNav();
  refs.embedderLinked = false;
  session.finishExit();
  uiStore.dispatch({ type: 'SET_THEATER_ACTIVE', value: false });
  updateCaptionDock();
  } finally {
    if (session.isExiting) session.finishExit();
  }
}

let hostPlayerLayoutRefreshPending = false;

function refreshHostPlayerLayout(): void {
  if (hostPlayerLayoutRefreshPending) return;
  hostPlayerLayoutRefreshPending = true;
  const fire = () => {
    try {
      window.dispatchEvent(new Event('resize'));
    } catch {
      // Ignore hosts that reject synthetic resize events.
    }
    try {
      window.dispatchEvent(new CustomEvent('theater-everywhere-host-layout-refresh'));
    } catch {
      // Ignore.
    }
  };
  fire();
  requestAnimationFrame(() => {
    fire();
    window.setTimeout(() => {
      fire();
      hostPlayerLayoutRefreshPending = false;
    }, 120);
  });
}

export function bootstrapPlayerRuntime(): void {
  if (isChatDocument(window.location.href)) {
    installChatShortcutRelay();
    return;
  }
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.action === 'statusChanged') {
        checkBlacklistAndInit();
        sendResponse({ success: true });
      }
    });
  }

  // The acknowledged generation never gates the policy/settings read above; until it arrives badges stay hidden.
  void hydrateSeenThrough();
  checkBlacklistAndInit();

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === 'local' && FEATURE_HIGHLIGHTS_LOCAL_KEYS.some(key => changes[key])) {
        for (const key of FEATURE_HIGHLIGHTS_LOCAL_KEYS) {
          if (changes[key]) highlightLocalOverrides[key] = changes[key].newValue;
        }
        uiStore.dispatch({ type: 'HYDRATE', value: { featureHighlights: withFeatureHighlightsLocal(ui().featureHighlights,
          highlightLocalOverrides, Date.now()) } });
      }
      if (areaName !== 'sync') return;
      if (changes[HIGHLIGHT_NEW_FEATURES_STORAGE_KEY]) {
        highlightSyncRevision++;
        uiStore.dispatch({ type: 'HYDRATE', value: { featureHighlights: { ...ui().featureHighlights, now: Date.now(),
          enabled: resolveHighlightNewFeatures(changes[HIGHLIGHT_NEW_FEATURES_STORAGE_KEY].newValue) } } });
      }
      if (changes[LANGUAGE_STORAGE_KEY]) void languageRuntime.set(changes[LANGUAGE_STORAGE_KEY].newValue);

      if (changes[SPONSORBLOCK_STORAGE_KEY]) {
        const enabled = resolveSponsorBlockMarkers(changes[SPONSORBLOCK_STORAGE_KEY].newValue);
        uiStore.dispatch({ type: 'HYDRATE', value: { sponsorBlockMarkers: enabled } });
        const wrapper = queryPlayerUi('.theater-controls-wrapper') as ExtendedHTMLDivElement | null;
        wrapper?._mediaFeatures?.setTimelineMarkersEnabled(enabled);
      }

      if (changes[VOLUME_BOOST_STORAGE_KEY]) {
        applyVolumeBoost(resolveVolumeBoostEnabled(changes[VOLUME_BOOST_STORAGE_KEY].newValue));
      }

      const providerFlagsChanged = mediaProviderFlagStorageKeys().some((key) => changes[key]);
      // Refresh only preferences that affect automatic entry.
      const autoTheaterSettingsChanged = changes.blacklist || changes[AUTO_THEATER_STORAGE_KEY] || changes[AUTO_THEATER_SKIP_COUNTDOWN_STORAGE_KEY] || providerFlagsChanged;
      if (autoTheaterSettingsChanged) {
        void checkBlacklistAndInit();
      }

      if (changes[AUTO_THEATER_STORAGE_KEY]) {
        uiStore.dispatch({ type: 'SET_AUTO_ENTER_THEATER', value: resolveAutoEnterTheater(changes[AUTO_THEATER_STORAGE_KEY].newValue) });
      }

      if (changes[AUTO_THEATER_SKIP_COUNTDOWN_STORAGE_KEY]) {
        uiStore.dispatch({ type: 'HYDRATE', value: {
          autoTheaterSkipCountdown: resolveAutoTheaterSkipCountdown(changes[AUTO_THEATER_SKIP_COUNTDOWN_STORAGE_KEY].newValue)
        } });
      }

      if (changes[VIDEO_ACTIVATOR_STORAGE_KEY]) {
        uiStore.dispatch({ type: 'HYDRATE', value: { videoActivator: resolveVideoActivator(changes[VIDEO_ACTIVATOR_STORAGE_KEY].newValue) } });
      }

      if (changes[KEEP_CONTROLS_VISIBLE_STORAGE_KEY]) {
        applyKeepControlsVisible(changes[KEEP_CONTROLS_VISIBLE_STORAGE_KEY].newValue);
      }

      if (changes.shortcuts) {
        uiStore.dispatch({ type: 'SET_SHORTCUTS', value: withShortcutDefaults(changes.shortcuts.newValue || {}) });
      }
      if (changes[ACCENT_COLOR_STORAGE_KEY]) {
        uiStore.dispatch({ type: 'SET_ACCENT', value: resolveAccentColorPreset(changes[ACCENT_COLOR_STORAGE_KEY].newValue) });
        refreshExtensionAccentColor();
      }

      if (changes[VIDEO_FIT_STORAGE_KEY]) {
        applyTheaterVideoFit(resolveVideoFitMode(changes[VIDEO_FIT_STORAGE_KEY].newValue));
      }
      if (changes[PICTURE_ALIGN_STORAGE_KEY]) {
        applyPictureAlign(resolvePictureAlign(changes[PICTURE_ALIGN_STORAGE_KEY].newValue));
      }
      if (Object.values(AUDIO_STORAGE_KEYS).some((key) => changes[key])) {
        const current = ui().audio;
        applyAudioSettings(resolveAudioSettings((name) => {
          const change = changes[AUDIO_STORAGE_KEYS[name]];
          return change ? change.newValue : current[name];
        }));
      }
      if (changes[RAISE_ONLY_WITH_SUBTITLES_STORAGE_KEY]) {
        applyRaiseOnlyWithSubtitles(changes[RAISE_ONLY_WITH_SUBTITLES_STORAGE_KEY].newValue);
      }
      if (changes[CAPTION_STYLE_STORAGE_KEY]) {
        applyCaptionStyleToTheater(resolveCaptionStyle(changes[CAPTION_STYLE_STORAGE_KEY].newValue));
      }
      if (changes[CAPTION_PREF_STORAGE_KEY]) {
        refs.captionPreferenceMap = resolveCaptionPreferenceMap(changes[CAPTION_PREF_STORAGE_KEY].newValue);
      }
      if (providerFlagsChanged) {
        const merged: Record<string, unknown> = {
          ...mediaProviderFlagStorageUpdate(refs.providerFlags)
        };
        for (const key of mediaProviderFlagStorageKeys()) {
          if (Object.prototype.hasOwnProperty.call(changes, key)) {
            merged[key] = changes[key].newValue;
          }
        }
        applyProviderFlags(resolveMediaProviderFlags(merged));
      }
      if (autoTheaterSettingsChanged) syncAutoTheaterRuntime();
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    window.addEventListener('unload', () => chrome.storage.onChanged.removeListener(onStorageChanged), { once: true });
  }
}

bindChromeActions();
