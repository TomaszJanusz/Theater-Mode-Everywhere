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
  resolveMediaProviderFlags,
  type MediaProviderFlags
} from '../media-features/provider-flags';
import {
  mediaHasSource,
  toggleDirectPlayback,
  toggleVideoPlayback
} from '../host-play';
import { isInactiveThumbPlayerVideo, selectSwitchableVideos } from '../switchable-videos';
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
import { THEATER_VIDEO_ATTR } from '../platform/active-video';
import { isTencentHost } from '../providers/hosts';
import { providerSharesPlaybackHost } from '../providers/discovery';
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
  isTencentWasmFrameDocument,
  isTencentWasmPlayerElement,
  isUsableTencentWasmPlayer,
  readTencentWasmHostToggle,
  replacementTencentWasmHost,
  selectTencentTheaterTarget
} from '../providers/tencent/wasm-player';
import { openTencentWasmSurface } from '../providers/tencent/wasm-bridge';
import {
  applyTheaterViewportPin,
  markTheaterVideo,
  mountTheaterStage,
  theaterVideoNeedsRestyle,
  unmarkTheaterVideo,
  unmountTheaterStage
} from './theater-layout';
import {
  getPlayerUiRoot,
  queryPlayerUi,
  queryPlayerUiAll
} from './root';
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
import { defaultShortcuts, matchesShortcut, withShortcutDefaults } from './shortcuts';
import { ENTRY_SHORTCUT_ATTRIBUTE, ENTRY_SHORTCUT_EVENT } from './entry-shortcuts';
import { PlayerUiStore, type PlayerUiState } from './store';
import { createControls, type ExtendedHTMLDivElement } from './controls';
import { createDiscovery, isElementInDOMDeep } from './discovery';
import { createHelp } from './help';
import {
  createHud,
  STATUS_HUD_FIT_ICON,
  STATUS_HUD_MUTE_ICON,
  STATUS_HUD_UNMUTE_ICON
} from './hud';
import {
  bindRootHelpers,
  createChromeRefs,
  createPlayerChromeContext
} from './runtime-context';
import { createToolbar } from './toolbar';
import { CONTROLS_VISIBILITY_ICON, KEEP_CONTROLS_VISIBLE_STORAGE_KEY, resolveKeepControlsVisible } from './controls-visibility';
import { closeMenuPopover } from './menu-popover';
import { isChatDocument, isNativeChatEvent } from '../chat';
import { CHAT_PREFERENCES_STORAGE_KEY, hydrateChatPreferences, startNativeChatSession, stopNativeChatSession } from './chat';

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

const hud = createHud(ctx);
const toolbar = createToolbar(ctx);
const help = createHelp(ctx);
const discovery = createDiscovery(ctx);
const controls = createControls(ctx);

const {
  triggerSeekIndicator,
  triggerVolumeIndicator,
  triggerStatusIndicator,
  triggerPlaybackIndicator,
  triggerCaptionHud,
  syncContentTitle
} = hud;
const {
  showToolbar,
  hideToolbar,
  updateCaptionDock,
  closeTheaterPopovers,
  preventDoubleToggle,
  bindWasmCatcher
} = toolbar;
const { toggleHelpOverlay, showHelpOverlay, hideHelpOverlay } = help;
const {
  findAllVideosDeep,
  findBestVideo,
  switchTheaterVideo,
  cycleTheaterVideo,
  injectStylesIntoShadowRoot
} = discovery;
const { createCustomControls, destroyCustomControls } = controls;

let wasmSurface: PlaybackSurface | null = null;
let wasmWatch: { dispose(): void } | null = null;
let removeWasmCatcher: (() => void) | null = null;

function sessionSurface(): PlaybackSurface | null {
  if (wasmSurface && session.element === wasmSurface.element) return wasmSurface;
  if (session.element instanceof HTMLVideoElement) return nativePlaybackSurface(session.element);
  return null;
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
    const restore = restoreAudibleVolume(video);
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

function applyVolumeAndBoost(video: PlaybackSurface, sliderValue: number): void {
  if (!video.element.hasAttribute(THEATER_VIDEO_ATTR)) {
    video.element.setAttribute(THEATER_VIDEO_ATTR, '');
  }
  const ceiling = volumeCeiling(video, refs.volumeBoostEnabled);
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

function executeCommand(command: PlayerCommand): void {
  if (command.type === 'EXIT') {
    exitTheaterMode(command.origin, command.sessionId, command.from);
    return;
  }
  if (!session.dispatch(command)) return;
  switch (command.type) {
    case 'PLAY_PAUSE': {
      const surface = sessionSurface();
      if (!surface) break;
      if (surface.nativeMedia instanceof HTMLVideoElement) {
        cancelPendingSeekResume(surface.nativeMedia);
        toggleVideoPlayback(surface.nativeMedia);
      } else {
        toggleDirectPlayback(surface);
      }
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

function requestParentPlaylistNav(): void {
  if (window.parent === window || !session.id) return;
  // The existing controls refresh also reports child availability to its parent.
  const available = session.element?.tagName === 'IFRAME'
    ? refs.childPlaylistNav
    : playlistNavigationAvailable();
  frames.postToParent('PLAYLIST_NAV_QUERY', session.id, available);
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
    hideToolbar,
    scheduleToolbarHide: toolbar.scheduleToolbarHide,
    updateCaptionDock,
    closeTheaterPopovers,
    blurMouseToggle: toolbar.blurMouseToggle,
    hideHelpOverlay,
    showHelpOverlay,
    toggleHelpOverlay,
    applyVolumeAndBoost,
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
    refreshHostPlayerLayout,
    setIcon: toolbar.setIcon,
    setTooltipContent: toolbar.setTooltipContent,
    escapeHtml: toolbar.escapeHtml,
    triggerSeekIndicator,
    triggerVolumeIndicator,
    triggerStatusIndicator,
    triggerPlaybackIndicator,
    seekHostTime: seekToMediaTime,
    playlistNavigationAvailable,
    requestParentPlaylistNav,
    activatePlaylistStep
  });
}

const THEATER_ELEMENT_INLINE_STYLES: Record<string, string> = {
  position: 'fixed',
  top: '0',
  left: '0',
  width: 'var(--theater-video-width, 100vw)',
  height: 'var(--theater-video-height, 100vh)',
  'max-width': 'var(--theater-video-width, 100vw)',
  'max-height': 'var(--theater-video-height, 100vh)',
  'min-width': 'var(--theater-video-width, 100vw)',
  'min-height': 'var(--theater-video-height, 100vh)',
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

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function pictureMoveTransition(): string {
  return prefersReducedMotion()
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
  const root = document.documentElement;
  const previous = root.style.getPropertyValue('--theater-object-position');
  if (previous !== '' && previous !== position && !prefersReducedMotion()) beginPictureMove();
  root.classList.toggle(
    'theater-everywhere-picture-top',
    raisedCaptionsUseBand(position, horizontalLetterboxPx(frame))
  );
  document.documentElement.style.setProperty('--theater-object-fit', fit);
  document.documentElement.style.setProperty('--theater-object-position', position);
  document.documentElement.style.setProperty('--theater-letterbox', `${Math.round(horizontalLetterboxPx(frame))}px`);
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
  refs.providerFlags = next;
  applyMediaProviderFlagAttrs(document.documentElement, next);
  const wrapper = queryPlayerUi('.theater-controls-wrapper') as ExtendedHTMLDivElement | null;
  wrapper?._mediaFeatures?.setProviderFlags(next);
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
  triggerStatusIndicator(t(next === 'top' ? 'pictureAlignTop' : 'pictureAlignCenter'), STATUS_HUD_FIT_ICON);
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
    '.te-dialog-overlay'
  ].join(',');
  for (const el of [
    ...document.querySelectorAll<HTMLElement>(selector),
    ...queryPlayerUiAll<HTMLElement>(selector)
  ]) {
    applyConfiguredAccentColor(el);
  }
}

async function checkBlacklistAndInit(): Promise<void> {
  const currentHostname = window.location.hostname;

  if (typeof chrome === 'undefined' || !chrome.storage?.sync) {
    if (!refs.isInitialized) initialize();
    return;
  }

  try {
    const data = await chrome.storage.sync.get([
      'blacklist',
      'shortcuts',
      'volumeBoostEnabled',
      CHAT_PREFERENCES_STORAGE_KEY,
      KEEP_CONTROLS_VISIBLE_STORAGE_KEY,
      ...mediaProviderFlagStorageKeys(),
      ACCENT_COLOR_STORAGE_KEY,
      VIDEO_FIT_STORAGE_KEY,
      PICTURE_ALIGN_STORAGE_KEY,
      RAISE_ONLY_WITH_SUBTITLES_STORAGE_KEY,
      CAPTION_STYLE_STORAGE_KEY,
      CAPTION_PREF_STORAGE_KEY
    ]);
    const blacklist = (data.blacklist || []) as string[];
    hydrateChatPreferences(data[CHAT_PREFERENCES_STORAGE_KEY]);
    const saved = data.shortcuts || {};
    refs.volumeBoostEnabled = data.volumeBoostEnabled !== undefined ? data.volumeBoostEnabled : false;
    applyProviderFlags(resolveMediaProviderFlags(data as Record<string, unknown>));
    uiStore.dispatch({
      type: 'HYDRATE',
      value: {
        shortcuts: withShortcutDefaults(saved),
        videoFit: resolveVideoFitMode(data[VIDEO_FIT_STORAGE_KEY]),
        pictureAlign: resolvePictureAlign(data[PICTURE_ALIGN_STORAGE_KEY]),
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
    refreshExtensionAccentColor();
  } catch (err) {
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
    if (e.key === ' ' || e.code === 'Space') return true;
    const native = video.nativeMedia instanceof HTMLVideoElement ? video.nativeMedia : null;
    const willPlay = native ? (!mediaHasSource(native) || native.paused) : video.paused;
    executeCommand({ type: 'PLAY_PAUSE' });
    triggerPlaybackIndicator(willPlay ? 'play' : 'pause');
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
    if (video.logicalVolume === undefined) {
      video.logicalVolume = video.muted ? 0 : video.volume;
    }
    const maxVol = volumeCeiling(video, refs.volumeBoostEnabled);
    video.logicalVolume = Math.min(maxVol, video.logicalVolume + 0.05);
    if (video.muted) {
      video.muted = false;
    }
    applyVolumeAndBoost(video, video.logicalVolume);
    rememberAudibleVolume(video, video.logicalVolume);
    triggerVolumeIndicator(video.logicalVolume, video.muted, 'up');
    if (refs.onVolumeAdjustedCallback) {
      refs.onVolumeAdjustedCallback();
    }
  } else if (matchesShortcut(e, shortcuts.volumeDown)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (video.logicalVolume === undefined) {
      video.logicalVolume = video.muted ? 0 : video.volume;
    }
    video.logicalVolume = Math.max(0, video.logicalVolume - 0.05);
    applyVolumeAndBoost(video, video.logicalVolume);
    rememberAudibleVolume(video, video.logicalVolume);
    triggerVolumeIndicator(video.logicalVolume, video.muted, 'down');
    if (refs.onVolumeAdjustedCallback) {
      refs.onVolumeAdjustedCallback();
    }
  } else if (matchesShortcut(e, shortcuts.toggleMute)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    toggleVideoMute(video);
  } else if (matchesShortcut(e, shortcuts.togglePiP)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (video.capabilities.pictureInPicture && document.pictureInPictureEnabled) {
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(err => {
          console.error('[Theater Everywhere] Exit PiP failed:', err);
        });
      } else {
        try {
          void Promise.resolve(video.requestPictureInPicture()).catch(err => {
            console.error('[Theater Everywhere] Request PiP failed:', err);
          });
        } catch (err) {
          console.error('[Theater Everywhere] Request PiP failed:', err);
        }
      }
    }
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

  const publishEntryShortcuts = () => {
    const shortcuts = ui().shortcuts;
    const config = JSON.stringify({
      toggle: shortcuts.toggle,
      fullscreen: shortcuts.toggleFullscreen,
      playPause: shortcuts.playPause,
      seekBack: shortcuts.seekBack,
      seekForward: shortcuts.seekForward
    });
    if (document.documentElement.getAttribute(ENTRY_SHORTCUT_ATTRIBUTE) !== config) {
      document.documentElement.setAttribute(ENTRY_SHORTCUT_ATTRIBUTE, config);
    }
  };
  session.runtimeScope.add(uiStore.subscribe(publishEntryShortcuts));
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
    const isEditable = activeEl && (
      (activeEl.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'submit', 'image', 'file'].includes((activeEl as HTMLInputElement).type)) ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.isContentEditable ||
      activeEl.getAttribute('role') === 'textbox'
    );
    if (isEditable) return false;
    if (theaterDialogOpen()) return false;

    const shortcuts = ui().shortcuts || defaultShortcuts;

    // Help owns keyboard focus; do not activate toolbar controls behind it.
    if (ui().helpOpen) {
      if (event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        queryPlayerUi<HTMLElement>('.theater-help-close-btn')?.focus();
        return true;
      }
      if ((event.key === ' ' || event.key === 'Enter')
          && activeEl?.closest('.theater-help-overlay, .theater-menu')) {
        if (!activeEl.closest('.theater-help-overlay')) event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return !activeEl.closest('.theater-help-overlay');
      }
    }

    // Let native menu buttons activate with Space/Enter instead of toggling playback.
    if (!ui().helpOpen && activeEl?.closest('.theater-menu, .theater-service-action-host')
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
        if (isTencentWasmFrameDocument()) {
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
        if (isTencentWasmFrameDocument()) {
          frames.postToParent('FRAME_HOST_TOGGLE', createSessionId(), { action: 'fullscreen' });
        } else {
          claimFullscreenShortcut();
        }
      }
      return true;
    } else if (matchesShortcut(event, shortcuts.exit) || event.key === 'Escape' || event.key === 'Esc') {
      // If help overlay is open, close it instead of exiting theater mode
      if (ui().helpOpen) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        hideHelpOverlay();
        return true;
      } else if (session.hasUi) {
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
      if (!matchesShortcut(key, ui().shortcuts.toggle) && !matchesShortcut(key, ui().shortcuts.toggleFullscreen)) return;
      listeners.keydown?.(key);
      if (key.defaultPrevented) event.preventDefault();
    } catch { /* Ignore malformed page events. */ }
  });
  listeners.playbackIntent = (event: Event) => {
    const action = (event as CustomEvent<{ action?: 'play' | 'pause' }>).detail?.action;
    if (action === 'play' || action === 'pause') triggerPlaybackIndicator(action);
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
    if (ui().helpOpen && (event.key === ' ' || event.key === 'Enter')
        && activeEl?.closest('.theater-help-overlay, .theater-menu')) {
      if (!activeEl.closest('.theater-help-overlay')) event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    if (!ui().helpOpen && activeEl?.closest('.theater-menu')
        && (event.key === ' ' || event.key === 'Enter')) {
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    const isEditable = activeEl && (
      (activeEl.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'submit', 'image', 'file'].includes((activeEl as HTMLInputElement).type)) ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.isContentEditable ||
      activeEl.getAttribute('role') === 'textbox'
    );
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

  // 2. Mouse Move Listener (Track video under cursor using composedPath)
  listeners.mousemove = (event: MouseEvent) => {
    try {
      const path = event.composedPath();
      for (const target of path) {
        if (!(target instanceof HTMLElement || target instanceof ShadowRoot)) continue;
        
        // If the element itself is a video
        if (target instanceof HTMLElement && target.tagName === 'VIDEO') {
          refs.activeVideo = target as HTMLVideoElement;
          return;
        }
        
        // If it's a shadow host containing a video
        if (target instanceof HTMLElement && target.shadowRoot) {
          const video = target.shadowRoot.querySelector('video');
          if (video) {
            refs.activeVideo = video;
            return;
          }
        }
        
        // If it's a container in light DOM containing a video
        if (target instanceof HTMLElement) {
          const video = target.querySelector('video');
          if (video) {
            refs.activeVideo = video;
            return;
          }
        }
      }
    } catch (e) {
      // Ignore errors
    }
  };
  session.runtimeScope.listen(document, 'mousemove', listeners.mousemove!, { passive: true });

  // 3. Play/Pause event tracking
  listeners.play = (event: Event) => {
    const path = event.composedPath();
    const video = path[0];
    if (video && video instanceof HTMLVideoElement) {
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
    const hostToggle = readTencentWasmHostToggle(event, {
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
      if (iframe) enterTheaterMode(iframe, envelope.sessionId, envelope.nonce);
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
      refs.parentPlaylistNav = playlistNavFromPayload(envelope.payload);
      window.dispatchEvent(new CustomEvent('theater-everywhere-playlist-nav'));
    } else if (envelope.type === 'PLAYLIST_NAV_GO' && fromChild) {
      const direction = envelope.payload.direction;
      if (direction === 'previous' || direction === 'next') {
        findPlaylistActions(document).find((action) => action.direction === direction)?.activate();
      }
    }
  };
  session.runtimeScope.listen(window, 'message', listeners.message!);

  // 5. SPA navigation listener — auto-exit theater mode when page navigates away
  listeners.navigate = () => {
    if ((session.element && !isElementInDOMDeep(session.element)) || (session.id && session.element && !isElementInDOMDeep(session.element))) {
      exitTheaterMode();
    }
    refs.activeVideo = null;
  };
  session.runtimeScope.listen(window, 'popstate', listeners.navigate!);

  refs.isInitialized = true;
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
  if (isTencentWasmFrameDocument()) return null;
  if (!isTencentHost()) return findBestVideo();
  const videos = findAllVideosDeep(document).filter((video) => !isInactiveThumbPlayerVideo(video));
  const pool = selectSwitchableVideos(videos);
  const best = findBestVideo();
  const switchable = pool.length > 0 ? (best && pool.includes(best) ? best : pool[0]) : null;
  const wasm = Array.from(document.querySelectorAll('fake-iframe-video')).find((element) => isUsableTencentWasmPlayer(element)) || null;
  return selectTencentTheaterTarget({
    switchable,
    wasm,
    fallback: best,
    wasmFrameDocument: false
  });
}

function releaseWasmSession(): void {
  wasmWatch?.dispose();
  wasmWatch = null;
  removeWasmCatcher?.();
  removeWasmCatcher = null;
  wasmSurface?.dispose?.();
  wasmSurface = null;
}

function mountWasmCatcher(): void {
  removeWasmCatcher?.();
  const root = getPlayerUiRoot();
  const catcher = document.createElement('div');
  catcher.className = 'theater-wasm-catcher';
  root.insertBefore(catcher, root.firstChild);
  removeWasmCatcher = bindWasmCatcher(catcher);
}

function attachWasmSession(element: HTMLElement): void {
  if (element.shadowRoot) injectStylesIntoShadowRoot(element.shadowRoot);
  wasmSurface = openTencentWasmSurface(element);
  createCustomControls(wasmSurface);
  mountWasmCatcher();
  watchTencentWasm(element);
}

function watchTencentWasm(element: HTMLElement): void {
  wasmWatch?.dispose();
  const scope = session.runtimeScope.child();
  wasmWatch = scope;
  const observer = new MutationObserver(() => {
    if (session.element !== element || isElementInDOMDeep(element)) return;
    const candidates = Array.from(document.querySelectorAll('fake-iframe-video')).filter((item) => isUsableTencentWasmPlayer(item));
    const next = replacementTencentWasmHost(element, candidates, isElementInDOMDeep);
    if (next) rebindTencentWasm(next);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scope.add(() => observer.disconnect());
}

function rebindTencentWasm(next: HTMLElement): void {
  const previous = session.element;
  wasmWatch?.dispose();
  wasmWatch = null;
  destroyCustomControls();
  removeWasmCatcher?.();
  removeWasmCatcher = null;
  wasmSurface?.dispose?.();
  wasmSurface = null;
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
  attachWasmSession(next);
}

function fullscreenTheaterTarget(): HTMLElement | null {
  if (!isTencentHost()) {
    const active = refs.activeVideo;
    if (active && isElementInDOMDeep(active)) return active;
  }
  return findTheaterTarget();
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
  setTimeout(() => { refs.isTransitioning = false; }, 200);

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

function keepTheaterVideoBound(video: HTMLVideoElement): void {
  const bindingScope = session.runtimeScope.child();
  const rebindIfReplaced = (candidate?: HTMLVideoElement): void => {
    if (bindingScope.isDisposed) return;
    const current = session.element;
    if (current?.tagName !== 'VIDEO') return;
    const connected = isElementInDOMDeep(current);
    if (connected && !isInactiveThumbPlayerVideo(current as HTMLVideoElement)) return;

    const replacement = candidate && candidate !== current && isElementInDOMDeep(candidate)
      ? candidate
      : findBestVideo();
    // ThumbPlayer swaps between connected video nodes while changing quality.
    // Wait for the visible replacement's metadata instead of loading its source ourselves.
    if (connected && (!replacement || replacement.readyState < 1 || isInactiveThumbPlayerVideo(replacement)
      || !providerSharesPlaybackHost(current as HTMLVideoElement, replacement))) return;
    if (replacement && replacement !== current) {
      bindingScope.dispose();
      switchTheaterVideo(replacement);
      keepTheaterVideoBound(replacement);
    }
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
  observer.observe(document.documentElement, { childList: true, subtree: true });
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

  markTheaterVideo(element);
  mountTheaterStage();
  mountProviderStages(window.location.hostname, element);
  startNativeChatSession(() => {
    if (session.element) applyTheaterElementInlineStyles(session.element);
    updateCaptionDock();
    window.dispatchEvent(new CustomEvent('theater-everywhere-chat-layout'));
  });
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

    // Preemptively enable CORS on the video so Web Audio (Volume Boost) can
    // access decoded audio later without a visible reload at boost time.
    // The theater mode visual transition masks any brief re-fetch.
    if (refs.volumeBoostEnabled && !video.crossOrigin) {
      video.crossOrigin = 'anonymous';
      const savedTime = video.currentTime;
      const wasPlaying = !video.paused;
      const src = video.currentSrc || video.src;
      if (src) {
        video.src = src;
        video.load();
        const onReady = () => {
          video.removeEventListener('canplay', onReady);
          video.currentTime = savedTime;
          if (wasPlaying) {
            video.play().catch(() => {});
          }
        };
        video.addEventListener('canplay', onReady, { once: true });
        // If CORS fails (server doesn't support it), remove the attribute
        // so the video can reload without CORS. Mark as boost-unavailable.
        const onError = () => {
          video.removeEventListener('error', onError);
          video.removeEventListener('canplay', onReady);
          video.crossOrigin = null as any;
          video.src = src;
          video.load();
          video.currentTime = savedTime;
          if (wasPlaying) {
            video.play().catch(() => {});
          }
        };
        video.addEventListener('error', onError, { once: true });
      }
    }

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
  } else if (isTencentWasmPlayerElement(element)) {
    attachWasmSession(element);
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
  try {
  hideHelpOverlay();
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

    video.classList.remove('controls-visible');
  }

  if (session.element && (session.element.tagName === 'VIDEO' || isTencentWasmPlayerElement(session.element))) {
    destroyCustomControls();
  }
  releaseWasmSession();

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
  if (isChatDocument(window.location.href)) return;
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.action === 'statusChanged') {
        checkBlacklistAndInit();
        sendResponse({ success: true });
      }
    });
  }

  checkBlacklistAndInit();

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync') return;

      if (changes.blacklist) {
        void checkBlacklistAndInit();
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
      if (changes[RAISE_ONLY_WITH_SUBTITLES_STORAGE_KEY]) {
        applyRaiseOnlyWithSubtitles(changes[RAISE_ONLY_WITH_SUBTITLES_STORAGE_KEY].newValue);
      }
      if (changes[CAPTION_STYLE_STORAGE_KEY]) {
        applyCaptionStyleToTheater(resolveCaptionStyle(changes[CAPTION_STYLE_STORAGE_KEY].newValue));
      }
      if (changes[CAPTION_PREF_STORAGE_KEY]) {
        refs.captionPreferenceMap = resolveCaptionPreferenceMap(changes[CAPTION_PREF_STORAGE_KEY].newValue);
      }
      if (mediaProviderFlagStorageKeys().some((key) => changes[key])) {
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
    });
  }
}

bindChromeActions();
