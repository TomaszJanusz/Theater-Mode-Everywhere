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
  resolveMediaProviderFlags,
  type MediaProviderFlags
} from '../media-features/provider-flags';
import {
  mediaHasSource,
  toggleVideoPlayback
} from '../host-play';
import {
  cancelPendingSeekResume,
  seekBy,
  seekToMediaTime
} from '../playback-window';
import { THEATER_VIDEO_ATTR } from '../platform/active-video';
import { isTwitchHost } from '../providers/hosts';
import {
  applyTheaterViewportPin,
  markTheaterVideo,
  mountDisneyTheaterStage,
  mountTwitchTheaterStage,
  observeTwitchTheaterStage,
  theaterVideoNeedsRestyle,
  unmarkTheaterVideo,
  unmountDisneyTheaterStage,
  unmountTwitchTheaterStage
} from './theater-layout';
import {
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
  resolveVideoFitMode,
  VIDEO_FIT_MODES,
  VIDEO_FIT_STORAGE_KEY,
  videoFitLabel,
  type VideoFitMode
} from './appearance';
import { applyUiDirection, t } from './messages';
import { defaultShortcuts, matchesShortcut, withShortcutDefaults } from './shortcuts';
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
  createPlayerChromeContext,
  type BoostedVideoElement
} from './runtime-context';
import { createToolbar } from './toolbar';

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
  triggerCaptionHud
} = hud;
const {
  showToolbar,
  hideToolbar,
  updateCaptionDock,
  closeTheaterPopovers,
  preventDoubleToggle
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

function rememberAudibleVolume(video: BoostedVideoElement, volume: number): void {
  if (volume > 0) video._lastAudibleVolume = volume;
}

function restoreAudibleVolume(video: BoostedVideoElement): number {
  if (typeof video._lastAudibleVolume === 'number' && video._lastAudibleVolume > 0) {
    return video._lastAudibleVolume;
  }
  if (typeof video._logicalVolume === 'number' && video._logicalVolume > 0) {
    return video._logicalVolume;
  }
  if (video.volume > 0) return video.volume;
  return 1;
}

function isVideoSilent(video: HTMLVideoElement): boolean {
  return video.muted || video.volume === 0;
}

function toggleVideoMute(video: HTMLVideoElement): void {
  const boostedVideo = video as BoostedVideoElement;
  if (isVideoSilent(video)) {
    const restore = restoreAudibleVolume(boostedVideo);
    boostedVideo._logicalVolume = restore;
    rememberAudibleVolume(boostedVideo, restore);
    video.muted = false;
    applyVolumeAndBoost(boostedVideo, restore);
    triggerStatusIndicator(t('unmuteHud'), STATUS_HUD_UNMUTE_ICON);
  } else {
    const volume = boostedVideo._logicalVolume ?? video.volume;
    rememberAudibleVolume(boostedVideo, volume);
    boostedVideo._logicalVolume = volume;
    video.muted = true;
    triggerStatusIndicator(t('muteHud'), STATUS_HUD_MUTE_ICON);
  }
  refs.onVolumeAdjustedCallback?.();
}

function applyVolumeAndBoost(video: HTMLVideoElement, sliderValue: number): void {
  if (!video.hasAttribute(THEATER_VIDEO_ATTR)) {
    video.setAttribute(THEATER_VIDEO_ATTR, '');
  }

  if (!refs.volumeBoostEnabled || sliderValue <= 1.0) {
    video.volume = Math.min(1.0, sliderValue);
    if (video.dataset.theaterBoostActive === 'true') {
      video.dataset.theaterBoost = '1.0';
      window.dispatchEvent(new CustomEvent('theater-everywhere-boost-event'));
    }
  } else {
    video.volume = 1.0;
    const multiplier = 1.0 + (sliderValue - 1.0) * 4.0;
    video.dataset.theaterBoost = multiplier.toFixed(4);
    video.dataset.theaterBoostActive = 'true';
    window.dispatchEvent(new CustomEvent('theater-everywhere-boost-event'));
  }
}

function executeCommand(command: PlayerCommand): void {
  if (command.type === 'EXIT') {
    exitTheaterMode(command.origin, command.sessionId, command.from);
    return;
  }
  if (!session.dispatch(command)) return;
  switch (command.type) {
    case 'PLAY_PAUSE': {
      const host = session.element;
      if (host?.tagName === 'VIDEO') {
        const video = host as HTMLVideoElement;
        cancelPendingSeekResume(video);
        toggleVideoPlayback(video);
      }
      break;
    }
    case 'SEEK_BY': {
      const host = session.element;
      if (host?.tagName !== 'VIDEO') break;
      const video = host as HTMLVideoElement;
      if (seekBy(video, command.delta) && Math.abs(command.delta) >= 5) {
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
    case 'CYCLE_FIT':
      cycleVideoFit();
      break;
    case 'TOGGLE_HELP':
      toggleHelpOverlay();
      break;
  }
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
    showCaptionHud,
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
    seekHostTime: seekToMediaTime
  });
}

const THEATER_ELEMENT_INLINE_STYLES: Record<string, string> = {
  position: 'fixed',
  top: '0',
  left: '0',
  width: '100vw',
  height: '100vh',
  'max-width': '100vw',
  'max-height': '100vh',
  'min-width': '100vw',
  'min-height': '100vh',
  'z-index': '2147483647',
  opacity: '1',
  'pointer-events': 'auto',
  margin: '0',
  padding: '0',
  transform: 'none',
  translate: 'none',
  rotate: 'none',
  scale: 'none',
  'transform-style': 'flat',
  transition: 'none',
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

function getTheaterElementInlineStyles(): Record<string, string> {
  return {
    ...THEATER_ELEMENT_INLINE_STYLES,
    'object-fit': ui().videoFit,
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
  if (element.style.getPropertyValue('--theater-object-fit') !== ui().videoFit) {
    element.style.setProperty('--theater-object-fit', ui().videoFit);
  }
  for (const property of ['top', 'left'] as const) {
    if (!element.style.getPropertyValue(property)) {
      element.style.setProperty(property, '0px', 'important');
    }
  }
  applyTheaterViewportPin(element);
  if (isTwitchHost()) {
    element.style.setProperty('top', '0px', 'important');
    element.style.setProperty('left', '0px', 'important');
  }
}

function applyTheaterVideoFit(mode: VideoFitMode = ui().videoFit): void {
  uiStore.dispatch({ type: 'SET_VIDEO_FIT', value: mode });
  const fit = ui().videoFit;
  document.documentElement.style.setProperty('--theater-object-fit', fit);
  if (session.element) {
    session.element.style.setProperty('object-fit', fit, 'important');
    session.element.style.setProperty('--theater-object-fit', fit);
  }
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

function cycleVideoFit(): void {
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
      ...mediaProviderFlagStorageKeys(),
      ACCENT_COLOR_STORAGE_KEY,
      VIDEO_FIT_STORAGE_KEY,
      CAPTION_STYLE_STORAGE_KEY,
      CAPTION_PREF_STORAGE_KEY
    ]);
    const blacklist = (data.blacklist || []) as string[];
    const saved = data.shortcuts || {};
    refs.volumeBoostEnabled = data.volumeBoostEnabled !== undefined ? data.volumeBoostEnabled : false;
    applyProviderFlags(resolveMediaProviderFlags(data as Record<string, unknown>));
    uiStore.dispatch({
      type: 'HYDRATE',
      value: {
        shortcuts: withShortcutDefaults(saved),
        videoFit: resolveVideoFitMode(data[VIDEO_FIT_STORAGE_KEY]),
        accentColor: resolveAccentColorPreset(data[ACCENT_COLOR_STORAGE_KEY]),
        captionStyle: resolveCaptionStyle(data[CAPTION_STYLE_STORAGE_KEY])
      }
    });
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

function handleVideoKey(e: KeyboardEvent, video: HTMLVideoElement) {
  const shortcuts = ui().shortcuts || defaultShortcuts;
  
  if (matchesShortcut(e, shortcuts.playPause)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    // Space is toggled in the page MAIN world so YouTube cannot steal the key.
    if (e.key === ' ' || e.code === 'Space') return;
    const willPlay = !mediaHasSource(video) || video.paused;
    executeCommand({ type: 'PLAY_PAUSE' });
    triggerPlaybackIndicator(willPlay ? 'play' : 'pause');
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
    const boostedVideo = video as BoostedVideoElement;
    if (boostedVideo._logicalVolume === undefined) {
      boostedVideo._logicalVolume = video.muted ? 0 : video.volume;
    }
    const maxVol = refs.volumeBoostEnabled ? 1.5 : 1.0;
    boostedVideo._logicalVolume = Math.min(maxVol, boostedVideo._logicalVolume + 0.05);
    if (video.muted) {
      video.muted = false;
    }
    applyVolumeAndBoost(boostedVideo, boostedVideo._logicalVolume);
    rememberAudibleVolume(boostedVideo, boostedVideo._logicalVolume);
    triggerVolumeIndicator(boostedVideo._logicalVolume, video.muted, 'up');
    if (refs.onVolumeAdjustedCallback) {
      refs.onVolumeAdjustedCallback();
    }
  } else if (matchesShortcut(e, shortcuts.volumeDown)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const boostedVideo = video as BoostedVideoElement;
    if (boostedVideo._logicalVolume === undefined) {
      boostedVideo._logicalVolume = video.muted ? 0 : video.volume;
    }
    boostedVideo._logicalVolume = Math.max(0.0, boostedVideo._logicalVolume - 0.05);
    applyVolumeAndBoost(boostedVideo, boostedVideo._logicalVolume);
    rememberAudibleVolume(boostedVideo, boostedVideo._logicalVolume);
    triggerVolumeIndicator(boostedVideo._logicalVolume, video.muted, 'down');
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
    if (document.pictureInPictureEnabled) {
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(err => {
          console.error('[Theater Everywhere] Exit PiP failed:', err);
        });
      } else {
        video.requestPictureInPicture().catch(err => {
          console.error('[Theater Everywhere] Request PiP failed:', err);
        });
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
  }
}

// Setup event listeners
function initialize(): void {
  if (refs.isInitialized) return;

  session.resetRuntimeScope();

  // 1. Keyboard Listener (T and Escape)
  listeners.keydown = (event: KeyboardEvent) => {
    // Ignore key presses in inputs/textareas/editable elements (including inside Shadow DOM)
    const activeEl = getActiveElementDeep() as HTMLElement | null;
    const isEditable = activeEl && (
      (activeEl.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'submit', 'image', 'file'].includes((activeEl as HTMLInputElement).type)) ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.isContentEditable ||
      activeEl.getAttribute('role') === 'textbox'
    );
    if (isEditable) return;
    if (theaterDialogOpen()) return;

    const shortcuts = ui().shortcuts || defaultShortcuts;

    if (session.element && matchesShortcut(event, shortcuts.cycle)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      executeCommand({ type: 'CYCLE_VIDEO', direction: 'next' });
      return;
    }

    if (session.element && matchesShortcut(event, shortcuts.cycleFit)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      executeCommand({ type: 'CYCLE_FIT' });
      return;
    }

    if (session.element && matchesShortcut(event, shortcuts.toggleCaptions)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      executeCommand({ type: 'TOGGLE_CAPTIONS' });
      return;
    }

    if (session.element?.tagName === 'VIDEO' && matchesShortcut(event, shortcuts.increaseCaptionSize)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      executeCommand({ type: 'STEP_CAPTION_SIZE', direction: 1 });
      return;
    }

    if (session.element?.tagName === 'VIDEO' && matchesShortcut(event, shortcuts.decreaseCaptionSize)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      executeCommand({ type: 'STEP_CAPTION_SIZE', direction: -1 });
      return;
    }

    if (session.element && matchesShortcut(event, shortcuts.showHelp)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      executeCommand({ type: 'TOGGLE_HELP' });
      return;
    }

    if (matchesShortcut(event, shortcuts.toggle)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      toggleTheaterMode();
    } else if (matchesShortcut(event, shortcuts.exit) || event.key === 'Escape' || event.key === 'Esc') {
      // If help overlay is open, close it instead of exiting theater mode
      if (ui().helpOpen) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        hideHelpOverlay();
      } else if (session.hasUi) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        exitTheaterMode();
      }
    } else if (session.element) {
      if (session.element.tagName === 'VIDEO') {
        const video = session.element as HTMLVideoElement;
        handleVideoKey(event, video);
      } else if (session.element.tagName === 'IFRAME') {
        const iframe = session.element as HTMLIFrameElement;
        if (iframe.contentWindow) {
          frames.postToChildIframe(iframe, 'PLAYBACK_COMMAND', session.id || createSessionId(), {
            key: event.key,
            code: event.code,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
            metaKey: event.metaKey
          });
          if (matchesShortcut(event, shortcuts.playPause) ||
              matchesShortcut(event, shortcuts.seekBack) ||
              matchesShortcut(event, shortcuts.seekForward) ||
              matchesShortcut(event, shortcuts.frameBack) ||
              matchesShortcut(event, shortcuts.frameForward) ||
              matchesShortcut(event, shortcuts.toggleMute) ||
              matchesShortcut(event, shortcuts.increaseCaptionSize) ||
              matchesShortcut(event, shortcuts.decreaseCaptionSize)) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
          }
        }
      }
    }
  };
  session.runtimeScope.listen(window, 'keydown', listeners.keydown!, true);
  listeners.playbackIntent = (event: Event) => {
    const action = (event as CustomEvent<{ action?: 'play' | 'pause' }>).detail?.action;
    if (action === 'play' || action === 'pause') triggerPlaybackIndicator(action);
  };
  session.runtimeScope.listen(window, 'theater-everywhere-playback-intent', listeners.playbackIntent);
  listeners.keyup = (event: KeyboardEvent) => {
    if (!session.element) return;
    const activeEl = getActiveElementDeep() as HTMLElement | null;
    const isEditable = activeEl && (
      (activeEl.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'submit', 'image', 'file'].includes((activeEl as HTMLInputElement).type)) ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.isContentEditable ||
      activeEl.getAttribute('role') === 'textbox'
    );
    if (isEditable) return;
    if (theaterDialogOpen()) return;
    const shortcuts = ui().shortcuts || defaultShortcuts;
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
    const trusted = frames.readTrusted(event, session.id, session.nonce);
    if (!trusted) return;
    const { envelope, fromParent, fromChild } = trusted;
    const iframes = Array.from(document.querySelectorAll('iframe'));

    if (envelope.type === 'FRAME_TOGGLE') {
      toggleTheaterMode();
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
          preventDefault: () => {},
          stopPropagation: () => {},
          stopImmediatePropagation: () => {}
        } as KeyboardEvent, video);
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

function toggleTheaterMode(): void {
  if (refs.isTransitioning) return;
  refs.isTransitioning = true;
  setTimeout(() => { refs.isTransitioning = false; }, 200);

  if (session.hasUi) {
    exitTheaterMode('local');
  } else {
    const video = findBestVideo();
    if (video) {
      enterTheaterMode(video);
    } else {
      frames.postToAllChildren('FRAME_TOGGLE', createSessionId(), {}, createSessionId());
    }
  }
}

function keepTheaterVideoBound(video: HTMLVideoElement): void {
  const rebindIfReplaced = (candidate?: HTMLVideoElement): void => {
    const current = session.element;
    if (current?.tagName !== 'VIDEO' || isElementInDOMDeep(current)) return;

    const replacement = candidate && candidate !== current && isElementInDOMDeep(candidate)
      ? candidate
      : findBestVideo();
    if (replacement && replacement !== current) {
      switchTheaterVideo(replacement);
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
      mountTwitchTheaterStage(window.location.hostname);
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
    session.runtimeScope.raf(() => {
      stabilizeScheduled = false;
      stabilizeLayout(video, false);
    });
  };

  session.runtimeScope.listen(video, 'loadedmetadata', () => scheduleStabilize(true));
  session.runtimeScope.listen(document, 'loadedmetadata', (event: Event) => {
    const candidate = event.target;
    if (!(candidate instanceof HTMLVideoElement)) return;
    if (candidate === session.element) {
      scheduleStabilize(true);
      return;
    }
    rebindIfReplaced(candidate);
  }, true);

  let rebindScheduled = false;
  const observer = new MutationObserver(() => {
    if (rebindScheduled) return;
    rebindScheduled = true;
    session.runtimeScope.raf(() => {
      rebindScheduled = false;
      rebindIfReplaced();
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  session.runtimeScope.add(() => observer.disconnect());

  const styleObserver = new MutationObserver(() => {
    if (ignoreStyleMutations > 0 || session.element !== video) return;
    if (!theaterVideoNeedsRestyle(video)) return;
    scheduleStabilize(false);
  });
  styleObserver.observe(video, { attributes: true, attributeFilter: ['style', THEATER_VIDEO_ATTR] });
  session.runtimeScope.add(() => styleObserver.disconnect());
}

function enterTheaterMode(element: HTMLElement, sessionId?: string, nonce?: string): void {
  if (session.element) return;

  session.rebind(element, sessionId, nonce);
  uiStore.dispatch({ type: 'SET_THEATER_ACTIVE', value: true });

  // If the active video is inside a Shadow DOM, inject styling into its root node
  const rootNode = element.getRootNode();
  if (rootNode instanceof ShadowRoot) {
    injectStylesIntoShadowRoot(rootNode);
  }

  markTheaterVideo(element);
  mountDisneyTheaterStage(window.location.hostname);
  mountTwitchTheaterStage(window.location.hostname);
  session.runtimeScope.add(observeTwitchTheaterStage(window.location.hostname));
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

  // Traverse ancestors and apply override class (crossing shadow boundaries)
  refs.ancestorsList = [];
  let parent: Node | null = element.parentNode;
  while (parent && parent !== document.documentElement) {
    if (parent instanceof ShadowRoot) {
      injectStylesIntoShadowRoot(parent);
      parent = parent.host;
    } else {
      if (parent instanceof HTMLElement) {
        parent.classList.add('theater-everywhere-parent-active');
        refs.ancestorsList.push(parent);
      }
      parent = parent.parentNode;
    }
  }

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

    // Clean up custom controls
    destroyCustomControls();
    video.classList.remove('controls-visible');
  }

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
  unmountDisneyTheaterStage();
  unmountTwitchTheaterStage();

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

      if (changes.shortcuts?.newValue) {
        uiStore.dispatch({ type: 'SET_SHORTCUTS', value: withShortcutDefaults(changes.shortcuts.newValue || {}) });
      }
      if (changes[ACCENT_COLOR_STORAGE_KEY]) {
        uiStore.dispatch({ type: 'SET_ACCENT', value: resolveAccentColorPreset(changes[ACCENT_COLOR_STORAGE_KEY].newValue) });
        refreshExtensionAccentColor();
      }

      if (changes[VIDEO_FIT_STORAGE_KEY]) {
        applyTheaterVideoFit(resolveVideoFitMode(changes[VIDEO_FIT_STORAGE_KEY].newValue));
      }
      if (changes[CAPTION_STYLE_STORAGE_KEY]) {
        applyCaptionStyleToTheater(resolveCaptionStyle(changes[CAPTION_STYLE_STORAGE_KEY].newValue));
      }
      if (changes[CAPTION_PREF_STORAGE_KEY]) {
        refs.captionPreferenceMap = resolveCaptionPreferenceMap(changes[CAPTION_PREF_STORAGE_KEY].newValue);
      }
      if (mediaProviderFlagStorageKeys().some((key) => changes[key])) {
        const merged: Record<string, unknown> = {
          youtubeIntegrationEnabled: refs.providerFlags.youtube,
          vimeoIntegrationEnabled: refs.providerFlags.vimeo,
          patreonIntegrationEnabled: refs.providerFlags.patreon,
          twitchIntegrationEnabled: refs.providerFlags.twitch,
          disneyIntegrationEnabled: refs.providerFlags.disney
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
