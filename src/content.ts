import './content.css';

const I18N_FALLBACK_MESSAGES: Record<string, string> = {
  keyboardShortcutsTitle: 'Keyboard Shortcuts',
  generalControlsTitle: 'General Controls',
  toggleTheaterMode: 'Toggle Theater Mode',
  exitTheaterMode: 'Exit Theater Mode',
  cycleSwitchVideo: 'Switch Video on Page',
  cycleVideoFit: 'Cycle Video Fit',
  onlyOneVideoHud: 'Feature unavailable. Video switching is only possible when there are more players on the page.',
  cycleIframeHud: 'Switching works only with HTML5 video',
  videoFitTooltip: 'Video Fit <kbd>$1</kbd>',
  videoFitContain: 'Fit',
  videoFitCover: 'Fill',
  videoFitFill: 'Stretch',
  showHideHelp: 'Show/Hide Help',
  playbackVolumeControlsTitle: 'Playback & Volume Controls',
  playPause: 'Play / Pause',
  seekBackward5: 'Seek Backward (5s)',
  seekForward5: 'Seek Forward (5s)',
  volumeUp5: 'Volume Up (5%)',
  volumeDown5: 'Volume Down (5%)',
  frameFullscreenPipTitle: 'Frame, Fullscreen & PiP',
  frameStepBackward: 'Frame Step Backward',
  frameStepForward: 'Frame Step Forward',
  toggleFullscreen: 'Toggle Fullscreen',
  togglePictureInPicture: 'Toggle Picture-in-Picture',
  play: 'Play',
  pause: 'Pause',
  pictureInPictureTooltip: 'Picture-in-Picture <kbd>$1</kbd>',
  exitFullscreen: 'Exit Fullscreen',
  fullscreenTooltip: 'Fullscreen <kbd>$1</kbd>',
  exitTheaterModeTooltip: 'Exit Theater Mode <kbd>$1</kbd> or <kbd>$2</kbd>',
  noSubtitlesAvailable: 'No subtitles available',
  disableSubtitles: 'Disable Subtitles',
  enableSubtitles: 'Enable Subtitles',
  noSubtitles: 'No subtitles',
  subtitlesOff: 'Off',
  trackLabel: 'Track $1',
  switchVideoTooltip: 'Switch Video on Page <kbd>$1</kbd>',
  keyboardShortcutsTooltip: 'Keyboard Shortcuts <kbd>$1</kbd>',
  fiveSeconds: '5 seconds',
  '@@bidi_dir': 'ltr',
  '@@bidi_lang': 'en'
};

type UiDirection = 'ltr' | 'rtl';

function t(messageName: string, substitutions?: string | string[]): string {
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage) {
      const message = chrome.i18n.getMessage(messageName, substitutions);
      if (message) {
        return message;
      }
    }
  } catch (_) {
    // Content scripts can run in test pages without extension i18n.
  }

  let fallback = I18N_FALLBACK_MESSAGES[messageName] || messageName;
  const replacementValues = Array.isArray(substitutions)
    ? substitutions
    : substitutions === undefined
      ? []
      : [substitutions];

  replacementValues.forEach((value, index) => {
    fallback = fallback.replace(new RegExp(`\\$${index + 1}`, 'g'), () => value);
  });

  return fallback;
}

function getUiDirection(): UiDirection {
  return t('@@bidi_dir') === 'rtl' ? 'rtl' : 'ltr';
}

function applyUiDirection(element: HTMLElement): void {
  element.dir = getUiDirection();

  const language = t('@@bidi_lang');
  if (language && !language.startsWith('@@')) {
    element.lang = language.replace('_', '-');
  }
}

interface Shortcuts {
  toggle: string;
  exit: string;
  seekBack: string;
  seekForward: string;
  cycle: string;
  playPause: string;
  frameBack: string;
  frameForward: string;
  toggleFullscreen: string;
  volumeUp: string;
  volumeDown: string;
  togglePiP: string;
  showHelp: string;
  cycleFit: string;
}

const defaultShortcuts: Shortcuts = {
  toggle: 'T',
  exit: 'Escape',
  seekBack: 'ArrowLeft',
  seekForward: 'ArrowRight',
  cycle: 'Shift+T',
  playPause: 'Space',
  frameBack: '<',
  frameForward: '>',
  toggleFullscreen: 'F',
  volumeUp: 'ArrowUp',
  volumeDown: 'ArrowDown',
  togglePiP: 'P',
  showHelp: 'H',
  cycleFit: 'Z'
};

const VIDEO_FIT_STORAGE_KEY = 'videoFitMode';
const VIDEO_FIT_MODES = ['contain', 'cover', 'fill'] as const;
type VideoFitMode = (typeof VIDEO_FIT_MODES)[number];
const DEFAULT_VIDEO_FIT: VideoFitMode = 'contain';

function resolveVideoFitMode(value: unknown): VideoFitMode {
  return typeof value === 'string' && VIDEO_FIT_MODES.includes(value as VideoFitMode)
    ? value as VideoFitMode
    : DEFAULT_VIDEO_FIT;
}

function videoFitLabel(mode: VideoFitMode): string {
  if (mode === 'cover') return t('videoFitCover');
  if (mode === 'fill') return t('videoFitFill');
  return t('videoFitContain');
}

// Kept inline so Vite emits a standalone classic content script without shared imports.
const ACCENT_COLOR_STORAGE_KEY = 'accentColor';
const ACCENT_COLOR_PRESETS = [
  'system',
  'teal',
  'blue',
  'green',
  'yellow',
  'orange',
  'red',
  'pink',
  'purple',
  'gray',
] as const;
type AccentColorPreset = (typeof ACCENT_COLOR_PRESETS)[number];
type AccentColorToken = {
  swatch: string;
  foreground: string;
};

const DEFAULT_ACCENT_COLOR: AccentColorPreset = 'system';
const ACCENT_COLOR_TOKENS: Record<Exclude<AccentColorPreset, 'system'>, AccentColorToken> = {
  teal: { swatch: '#00b894', foreground: '#ffffff' },
  blue: { swatch: '#37adff', foreground: '#0b1020' },
  green: { swatch: '#51cd00', foreground: '#0b1020' },
  yellow: { swatch: '#ffcb00', foreground: '#18181b' },
  orange: { swatch: '#ff9f00', foreground: '#18181b' },
  red: { swatch: '#ff613d', foreground: '#ffffff' },
  pink: { swatch: '#ff4ad8', foreground: '#ffffff' },
  purple: { swatch: '#af51f5', foreground: '#ffffff' },
  gray: { swatch: '#7c7c7d', foreground: '#ffffff' }
};

function resolveAccentColorPreset(value: unknown): AccentColorPreset {
  return typeof value === 'string' && ACCENT_COLOR_PRESETS.includes(value as AccentColorPreset)
    ? value as AccentColorPreset
    : DEFAULT_ACCENT_COLOR;
}

function applyAccentColorPreset(target: HTMLElement, preset: AccentColorPreset): void {
  const supportsNativeAccent =
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('color', 'AccentColor') &&
    CSS.supports('color', 'AccentColorText');

  if (preset === 'system' && supportsNativeAccent) {
    target.style.setProperty('--accent-color', 'var(--native-accent, AccentColor)');
    target.style.setProperty('--accent-text', 'var(--native-accent-text, AccentColorText)');
    target.style.setProperty('--accent-hover', 'color-mix(in srgb, var(--accent-color) 85%, black)');
    return;
  }

  const token = preset === 'system' ? ACCENT_COLOR_TOKENS.purple : ACCENT_COLOR_TOKENS[preset];
  target.style.setProperty('--accent-color', token.swatch);
  target.style.setProperty('--accent-text', token.foreground);
  target.style.setProperty('--accent-hover', `color-mix(in srgb, ${token.swatch} 85%, black)`);
}

let volumeBoostEnabled = false;
let configuredShortcuts: Shortcuts = { ...defaultShortcuts };

interface BoostedVideoElement extends HTMLVideoElement {
  _audioCtx?: AudioContext;
  _gainNode?: GainNode;
  _sourceNode?: MediaElementAudioSourceNode;
  _logicalVolume?: number;
}

function applyVolumeAndBoost(video: HTMLVideoElement, sliderValue: number): void {
  // Ensure the active video has the active class so the main world script can locate it
  if (!video.classList.contains('theater-everywhere-video-active')) {
    video.classList.add('theater-everywhere-video-active');
  }

  if (!volumeBoostEnabled || sliderValue <= 1.0) {
    video.volume = Math.min(1.0, sliderValue);
    // Only dispatch boost event if Web Audio was previously activated (to reset gain to 1.0).
    // Avoid dispatching for normal volume to prevent premature AudioContext creation.
    if (video.dataset.theaterBoostActive === 'true') {
      video.dataset.theaterBoost = '1.0';
      window.dispatchEvent(new CustomEvent('theater-everywhere-boost-event'));
    }
  } else {
    video.volume = 1.0; // Lock native volume at max

    // 1.0 to 1.5 in slider maps to 1.0 to 3.0 volume boost multiplier
    const multiplier = 1.0 + (sliderValue - 1.0) * 4.0;
    video.dataset.theaterBoost = multiplier.toFixed(4);
    video.dataset.theaterBoostActive = 'true';
    window.dispatchEvent(new CustomEvent('theater-everywhere-boost-event'));
  }
}

let activeVideo: HTMLVideoElement | null = null;
let theaterElement: HTMLElement | null = null;
let ancestorsList: HTMLElement[] = [];
let isInitialized = false;
let isTransitioning = false;
let toolbarTimer: ReturnType<typeof setTimeout> | null = null;
let toolbarKeyboardInteractionActive = false;
let currentToggleFullscreen: (() => void) | null = null;
let onVolumeAdjustedCallback: (() => void) | null = null;
let configuredAccentColor: AccentColorPreset = DEFAULT_ACCENT_COLOR;
let configuredVideoFit: VideoFitMode = DEFAULT_VIDEO_FIT;

const TOOLBAR_AUTO_HIDE_DELAY_MS = 2500;
const CURSOR_HIDDEN_CLASS = 'theater-everywhere-cursor-hidden';

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
  margin: '0',
  padding: '0',
  transform: 'none',
  transition: 'none',
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
    'object-fit': configuredVideoFit,
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
    element.style.setProperty(property, value, 'important');
  });
  element.style.setProperty('--theater-object-fit', configuredVideoFit);
}

function applyTheaterVideoFit(mode: VideoFitMode = configuredVideoFit): void {
  configuredVideoFit = mode;
  document.documentElement.style.setProperty('--theater-object-fit', mode);
  if (theaterElement) {
    theaterElement.style.setProperty('object-fit', mode, 'important');
    theaterElement.style.setProperty('--theater-object-fit', mode);
  }
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
  const currentIndex = VIDEO_FIT_MODES.indexOf(configuredVideoFit);
  const nextMode = VIDEO_FIT_MODES[(currentIndex + 1) % VIDEO_FIT_MODES.length];
  persistVideoFitMode(nextMode);
  triggerStatusIndicator(videoFitLabel(nextMode), STATUS_HUD_FIT_ICON);
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

function matchesShortcut(e: KeyboardEvent, shortcutStr: string): boolean {
  if (!shortcutStr) return false;
  
  const parts = shortcutStr.split('+');
  const mainKey = parts[parts.length - 1];
  
  // Check main key
  let eventKey = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (eventKey === ' ' || eventKey === 'SPACEBAR') {
    eventKey = 'SPACE';
  } else {
    eventKey = eventKey.toUpperCase();
  }
  
  const targetKey = mainKey.toUpperCase();
  if (eventKey !== targetKey && e.code.toUpperCase() !== targetKey) return false;
  
  // Check modifiers
  const hasCtrl = parts.includes('Ctrl');
  const hasAlt = parts.includes('Alt');
  const hasShift = parts.includes('Shift');
  const hasMeta = parts.includes('Meta');
  
  if (e.ctrlKey !== hasCtrl) return false;
  if (e.altKey !== hasAlt) return false;
  if (e.metaKey !== hasMeta) return false;
  
  // Ignore Shift check if target key is a shifted character itself
  const isShiftedChar = ['<', '>', '?', ':', '"', '{', '}', '|', '_', '+', '~', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')'].includes(mainKey);
  if (!isShiftedChar && e.shiftKey !== hasShift) return false;
  
  return true;
}

function scheduleToolbarHide(): void {
  if (toolbarTimer) clearTimeout(toolbarTimer);

  toolbarTimer = setTimeout(() => {
    toolbarTimer = null;
    hideToolbar();
  }, TOOLBAR_AUTO_HIDE_DELAY_MS);
}

function shouldKeepToolbarVisible(controls: HTMLElement): boolean {
  const isScrubberDragging = controls.querySelector('.theater-scrubber-container.dragging') !== null;
  const isCcMenuOpen = controls.querySelector('.theater-cc-menu.visible') !== null;
  const hasKeyboardFocus = toolbarKeyboardInteractionActive && controls.querySelector(':focus-visible') !== null;

  return controls.matches(':hover') || isScrubberDragging || isCcMenuOpen || hasKeyboardFocus || helpOverlayElement !== null;
}

function hideToolbar(): void {
  const controls = document.querySelector('.theater-controls-wrapper') as HTMLElement | null;
  if (!controls || !theaterElement) return;

  if (shouldKeepToolbarVisible(controls)) {
    scheduleToolbarHide();
    return;
  }

  controls.classList.remove('visible');
  if (theaterElement.tagName === 'VIDEO') {
    theaterElement.classList.remove('controls-visible');
  }
  document.querySelector('.theater-button-tooltip')?.classList.remove('visible');
  document.documentElement.classList.add(CURSOR_HIDDEN_CLASS);
}

// Show the floating quick actions toolbar based on pointer or keyboard activity.
function showToolbar(event?: Event): void {
  const controls = document.querySelector('.theater-controls-wrapper') as HTMLElement | null;
  if (!controls) return;

  if (event?.type === 'pointermove' || event?.type === 'pointerdown') {
    toolbarKeyboardInteractionActive = false;
  } else if (event?.type === 'focusin') {
    toolbarKeyboardInteractionActive = event.target instanceof Element && event.target.matches(':focus-visible');
  }
  
  controls.classList.add('visible');
  if (theaterElement && theaterElement.tagName === 'VIDEO') {
    theaterElement.classList.add('controls-visible');
  }
  document.documentElement.classList.remove(CURSOR_HIDDEN_CLASS);

  scheduleToolbarHide();
}

// Prevent custom player containers from double-toggling play/pause and handle clicks/pointers
function preventDoubleToggle(e: Event): void {
  if (!theaterElement) return;

  // Block double clicks completely to avoid site-level fullscreen conflicts
  if (e.type === 'dblclick') {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    return;
  }

  // Isolate completely
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  // Only toggle play/pause on 'click' to guarantee it happens exactly once per mouse release
  if (e.type === 'click' && theaterElement.tagName === 'VIDEO') {
    const video = theaterElement as HTMLVideoElement;
    if (video.paused) {
      video.play().catch(err => {
        console.error('[Theater Everywhere] Programmatic play failed:', err);
      });
    } else {
      video.pause();
    }
  }
}

interface Listeners {
  keydown: ((event: KeyboardEvent) => void) | null;
  mousemove: ((event: MouseEvent) => void) | null;
  play: ((event: Event) => void) | null;
  pause: ((event: Event) => void) | null;
  message: ((event: MessageEvent) => void) | null;
  navigate: (() => void) | null;
}

// Event listener references for clean removal
const listeners: Listeners = {
  keydown: null,
  mousemove: null,
  play: null,
  pause: null,
  message: null,
  navigate: null
};

function getIframeOrigin(iframe: HTMLIFrameElement): string {
  try {
    if (iframe.src) return new URL(iframe.src, window.location.href).origin;
  } catch (_) {}
  return '*';
}

function getParentOrigin(): string {
  try {
    if (document.referrer) return new URL(document.referrer).origin;
  } catch (_) {}
  return '*';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setIcon(el: HTMLElement, svgStr: string): void {
  el.textContent = '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgStr.trim(), 'image/svg+xml');
  el.appendChild(doc.documentElement);
}

function setTooltipContent(el: HTMLElement, rawText: string): void {
  el.textContent = '';
  const kbdRe = /<kbd>(.*?)<\/kbd>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = kbdRe.exec(rawText)) !== null) {
    if (m.index > last) el.appendChild(document.createTextNode(rawText.slice(last, m.index)));
    const kbd = document.createElement('kbd');
    kbd.textContent = m[1];
    el.appendChild(kbd);
    last = m.index + m[0].length;
  }
  if (last < rawText.length) el.appendChild(document.createTextNode(rawText.slice(last)));
}

function applyConfiguredAccentColor(target: HTMLElement): void {
  applyAccentColorPreset(target, configuredAccentColor);
}

function refreshExtensionAccentColor(): void {
  document
    .querySelectorAll<HTMLElement>(
      [
        '.theater-controls-wrapper',
        '.theater-loading-indicator',
        '.theater-button-tooltip',
        '.theater-help-overlay',
        '.theater-everywhere-seek-overlay',
        '.theater-everywhere-volume-overlay'
      ].join(',')
    )
    .forEach(applyConfiguredAccentColor);
}

// Check blacklist and initialize or destroy listeners
async function checkBlacklistAndInit(): Promise<void> {
  const currentHostname = window.location.hostname;
  
  try {
    const data = await chrome.storage.sync.get([
      'blacklist',
      'shortcuts',
      'volumeBoostEnabled',
      ACCENT_COLOR_STORAGE_KEY,
      VIDEO_FIT_STORAGE_KEY
    ]);
    const blacklist = (data.blacklist || []) as string[];
    const saved = data.shortcuts || {};
    volumeBoostEnabled = data.volumeBoostEnabled !== undefined ? data.volumeBoostEnabled : false;
    configuredAccentColor = resolveAccentColorPreset(data[ACCENT_COLOR_STORAGE_KEY]);
    applyTheaterVideoFit(resolveVideoFitMode(data[VIDEO_FIT_STORAGE_KEY]));
    
    configuredShortcuts = {
      toggle: saved.toggle || defaultShortcuts.toggle,
      exit: saved.exit || defaultShortcuts.exit,
      seekBack: saved.seekBack || defaultShortcuts.seekBack,
      seekForward: saved.seekForward || defaultShortcuts.seekForward,
      cycle: saved.cycle || defaultShortcuts.cycle,
      playPause: saved.playPause || defaultShortcuts.playPause,
      frameBack: saved.frameBack || defaultShortcuts.frameBack,
      frameForward: saved.frameForward || defaultShortcuts.frameForward,
      toggleFullscreen: saved.toggleFullscreen || defaultShortcuts.toggleFullscreen,
      volumeUp: saved.volumeUp || defaultShortcuts.volumeUp,
      volumeDown: saved.volumeDown || defaultShortcuts.volumeDown,
      togglePiP: saved.togglePiP || defaultShortcuts.togglePiP,
      showHelp: saved.showHelp || defaultShortcuts.showHelp,
      cycleFit: saved.cycleFit || defaultShortcuts.cycleFit
    } as Shortcuts;
    
    const isBlacklisted = blacklist.some(domain => {
      const cleanDomain = domain.startsWith('www.') ? domain.substring(4) : domain;
      const cleanHostname = currentHostname.startsWith('www.') ? currentHostname.substring(4) : currentHostname;
      return cleanHostname === cleanDomain || cleanHostname.endsWith('.' + cleanDomain);
    });

    if (isBlacklisted) {
      if (isInitialized) {
        destroy();
      }
    } else {
      if (!isInitialized) {
        initialize();
      }
    }
    refreshExtensionAccentColor();
  } catch (err) {
    console.error('[Theater Everywhere] Error loading settings:', err);
    // Safe fallback: initialize if storage fails
    if (!isInitialized) {
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

function handleVideoKey(e: KeyboardEvent, video: HTMLVideoElement) {
  const shortcuts = configuredShortcuts || defaultShortcuts;
  
  if (matchesShortcut(e, shortcuts.playPause)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (video.paused) {
      video.play().catch(err => {
        console.error('[Theater Everywhere] Play failed:', err);
      });
      triggerPlaybackIndicator('play');
    } else {
      video.pause();
      triggerPlaybackIndicator('pause');
    }
  } else if (matchesShortcut(e, shortcuts.seekBack)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (isFinite(video.duration)) {
      video.currentTime = Math.max(0, video.currentTime - 5);
      triggerSeekIndicator('left');
    }
  } else if (matchesShortcut(e, shortcuts.seekForward)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (isFinite(video.duration)) {
      video.currentTime = Math.min(video.duration, video.currentTime + 5);
      triggerSeekIndicator('right');
    }
  } else if (matchesShortcut(e, shortcuts.frameBack)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (isFinite(video.duration)) {
      video.currentTime = Math.max(0, video.currentTime - 0.04);
    }
  } else if (matchesShortcut(e, shortcuts.frameForward)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (isFinite(video.duration)) {
      video.currentTime = Math.min(video.duration, video.currentTime + 0.04);
    }
  } else if (matchesShortcut(e, shortcuts.volumeUp)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const boostedVideo = video as BoostedVideoElement;
    if (boostedVideo._logicalVolume === undefined) {
      boostedVideo._logicalVolume = video.muted ? 0 : video.volume;
    }
    const maxVol = volumeBoostEnabled ? 1.5 : 1.0;
    boostedVideo._logicalVolume = Math.min(maxVol, boostedVideo._logicalVolume + 0.05);
    if (video.muted) {
      video.muted = false;
    }
    applyVolumeAndBoost(boostedVideo, boostedVideo._logicalVolume);
    triggerVolumeIndicator(boostedVideo._logicalVolume, video.muted, 'up');
    if (onVolumeAdjustedCallback) {
      onVolumeAdjustedCallback();
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
    triggerVolumeIndicator(boostedVideo._logicalVolume, video.muted, 'down');
    if (onVolumeAdjustedCallback) {
      onVolumeAdjustedCallback();
    }
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
    if (currentToggleFullscreen) {
      currentToggleFullscreen();
    }
  }
}

// Setup event listeners
function initialize(): void {
  if (isInitialized) return;

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

    const shortcuts = configuredShortcuts || defaultShortcuts;

    if (theaterElement && matchesShortcut(event, shortcuts.cycle)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      cycleTheaterVideo('next');
      return;
    }

    if (theaterElement && matchesShortcut(event, shortcuts.cycleFit)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      cycleVideoFit();
      return;
    }

    if (theaterElement && matchesShortcut(event, shortcuts.showHelp)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      toggleHelpOverlay();
      return;
    }

    if (matchesShortcut(event, shortcuts.toggle)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      toggleTheaterMode();
    } else if (matchesShortcut(event, shortcuts.exit) || event.key === 'Escape' || event.key === 'Esc') {
      // If help overlay is open, close it instead of exiting theater mode
      if (helpOverlayElement) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        hideHelpOverlay();
      } else if (theaterElement) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        exitTheaterMode();
      }
    } else if (theaterElement) {
      if (theaterElement.tagName === 'VIDEO') {
        const video = theaterElement as HTMLVideoElement;
        handleVideoKey(event, video);
      } else if (theaterElement.tagName === 'IFRAME') {
        const iframe = theaterElement as HTMLIFrameElement;
        if (iframe.contentWindow) {
          iframe.contentWindow.postMessage({
            type: 'theater-everywhere-key',
            key: event.key,
            code: event.code,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
            metaKey: event.metaKey
          }, getIframeOrigin(iframe));
          if (matchesShortcut(event, shortcuts.playPause) ||
              matchesShortcut(event, shortcuts.seekBack) ||
              matchesShortcut(event, shortcuts.seekForward) ||
              matchesShortcut(event, shortcuts.frameBack) ||
              matchesShortcut(event, shortcuts.frameForward)) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
          }
        }
      }
    }
  };
  window.addEventListener('keydown', listeners.keydown, true);

  // 2. Mouse Move Listener (Track video under cursor using composedPath)
  listeners.mousemove = (event: MouseEvent) => {
    try {
      const path = event.composedPath();
      for (const target of path) {
        if (!(target instanceof HTMLElement || target instanceof ShadowRoot)) continue;
        
        // If the element itself is a video
        if (target instanceof HTMLElement && target.tagName === 'VIDEO') {
          activeVideo = target as HTMLVideoElement;
          return;
        }
        
        // If it's a shadow host containing a video
        if (target instanceof HTMLElement && target.shadowRoot) {
          const video = target.shadowRoot.querySelector('video');
          if (video) {
            activeVideo = video;
            return;
          }
        }
        
        // If it's a container in light DOM containing a video
        if (target instanceof HTMLElement) {
          const video = target.querySelector('video');
          if (video) {
            activeVideo = video;
            return;
          }
        }
      }
    } catch (e) {
      // Ignore errors
    }
  };
  document.addEventListener('mousemove', listeners.mousemove, { passive: true });

  // 3. Play/Pause event tracking
  listeners.play = (event: Event) => {
    const path = event.composedPath();
    const video = path[0];
    if (video && video instanceof HTMLVideoElement) {
      activeVideo = video;
    }
  };
  document.addEventListener('play', listeners.play, true); // Use capture phase since 'play' does not bubble

  listeners.pause = (_event: Event) => {
    // Track pause events to keep activeVideo reference fresh if needed
  };
  document.addEventListener('pause', listeners.pause, true); // Use capture phase since 'pause' does not bubble

  // 4. Cross-iframe postMessage listener
  listeners.message = (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (!data.type || !String(data.type).startsWith('theater-everywhere-')) return;

    // Only accept messages from our parent frame or one of our child iframes
    const isFromParent = window !== window.top && event.source === window.parent;
    const isFromChild = Array.from(document.querySelectorAll('iframe')).some(
      iframe => iframe.contentWindow === event.source
    );
    if (!isFromParent && !isFromChild) return;

    if (data.type === 'theater-everywhere-toggle') {
      // Toggle requested by parent
      toggleTheaterMode();
    } else if (data.type === 'theater-everywhere-enter') {
      // Child frame entered theater mode; find that iframe and expand it
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        if (iframe.contentWindow === event.source) {
          enterTheaterMode(iframe);
          break;
        }
      }
    } else if (data.type === 'theater-everywhere-exit') {
      // Child frame exited theater mode; restore that iframe
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        if (iframe.contentWindow === event.source) {
          exitTheaterMode();
          break;
        }
      }
    } else if (data.type === 'theater-everywhere-exit-down') {
      // Parent frame told us to exit theater mode
      exitTheaterMode();
    } else if (data.type === 'theater-everywhere-key') {
      if (theaterElement && theaterElement.tagName === 'VIDEO') {
        const video = theaterElement as HTMLVideoElement;
        handleVideoKey({
          key: data.key,
          code: data.code,
          ctrlKey: data.ctrlKey,
          altKey: data.altKey,
          shiftKey: data.shiftKey,
          metaKey: data.metaKey,
          preventDefault: () => {},
          stopPropagation: () => {},
          stopImmediatePropagation: () => {}
        } as KeyboardEvent, video);
      }
    }
  };
  window.addEventListener('message', listeners.message);

  // 5. SPA navigation listener — auto-exit theater mode when page navigates away
  listeners.navigate = () => {
    if (theaterElement && !isElementInDOMDeep(theaterElement)) {
      exitTheaterMode();
    }
    activeVideo = null;
  };
  window.addEventListener('popstate', listeners.navigate);

  isInitialized = true;
}

// Cleanup and remove listeners
function destroy(): void {
  if (!isInitialized) return;

  if (theaterElement) {
    exitTheaterMode();
  }

  if (toolbarTimer) {
    clearTimeout(toolbarTimer);
    toolbarTimer = null;
  }

  if (listeners.keydown) window.removeEventListener('keydown', listeners.keydown, true);
  if (listeners.mousemove) document.removeEventListener('mousemove', listeners.mousemove);
  if (listeners.play) document.removeEventListener('play', listeners.play, true);
  if (listeners.pause) document.removeEventListener('pause', listeners.pause, true);
  if (listeners.message) window.removeEventListener('message', listeners.message);
  if (listeners.navigate) window.removeEventListener('popstate', listeners.navigate);

  isInitialized = false;
}

function isElementInDOMDeep(el: Node | null): boolean {
  let parent = el;
  while (parent) {
    if (parent === document.body) return true;
    if (parent instanceof ShadowRoot) {
      parent = parent.host;
    } else {
      parent = parent.parentNode;
    }
  }
  return false;
}

function findAllVideosDeep(root: Document | ShadowRoot = document): HTMLVideoElement[] {
  const videos: HTMLVideoElement[] = Array.from(root.querySelectorAll('video'));
  for (const host of root.querySelectorAll('*')) {
    if (host.shadowRoot) {
      videos.push(...findAllVideosDeep(host.shadowRoot));
    }
  }
  return videos;
}

function injectStylesIntoShadowRoot(shadowRoot: ShadowRoot): void {
  if (shadowRoot.getElementById('theater-everywhere-shadow-styles')) return;

  const styleEl = document.createElement('style');
  styleEl.id = 'theater-everywhere-shadow-styles';
  styleEl.textContent = `
    .theater-everywhere-video-active {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      max-width: 100vw !important;
      max-height: 100vh !important;
      min-width: 100vw !important;
      min-height: 100vh !important;
      z-index: 2147483647 !important;
      background-color: #000000 !important;
      object-fit: var(--theater-object-fit, contain) !important;
      margin: 0 !important;
      padding: 0 !important;
      border: none !important;
      transform: none !important;
      transition: none !important;
    }
    .theater-everywhere-parent-active {
      position: relative !important;
      overflow: visible !important;
      transform: none !important;
      filter: none !important;
      perspective: none !important;
      contain: none !important;
      backdrop-filter: none !important;
      clip: auto !important;
      clip-path: none !important;
      mask: none !important;
      will-change: auto !important;
      z-index: 2147483647 !important;
    }
  `;
  shadowRoot.appendChild(styleEl);
}

interface VideoMetrics {
  inViewport: boolean;
  isPlaying: boolean;
  isHovered: boolean;
  visibleRatio: number;
  visibleArea: number;
  distanceToCenter: number;
}

function getVideoMetrics(video: HTMLVideoElement): VideoMetrics {
  const rect = video.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

  const intersectionLeft = Math.max(rect.left, 0);
  const intersectionRight = Math.min(rect.right, viewportWidth);
  const intersectionTop = Math.max(rect.top, 0);
  const intersectionBottom = Math.min(rect.bottom, viewportHeight);

  const visibleWidth = Math.max(0, intersectionRight - intersectionLeft);
  const visibleHeight = Math.max(0, intersectionBottom - intersectionTop);
  const visibleArea = visibleWidth * visibleHeight;
  const totalArea = rect.width * rect.height;
  const visibleRatio = totalArea > 0 ? visibleArea / totalArea : 0;
  const inViewport = visibleArea > 0 && rect.width > 0 && rect.height > 0;

  const visibleCenterX = intersectionLeft + visibleWidth / 2;
  const visibleCenterY = intersectionTop + visibleHeight / 2;
  const viewportCenterX = viewportWidth / 2;
  const viewportCenterY = viewportHeight / 2;

  const dx = visibleCenterX - viewportCenterX;
  const dy = visibleCenterY - viewportCenterY;
  const distanceToCenter = Math.sqrt(dx * dx + dy * dy);

  const isPlaying = !video.paused && !video.ended && video.readyState > 2;
  const isHovered = video === activeVideo;

  return {
    inViewport,
    isPlaying,
    isHovered,
    visibleRatio,
    visibleArea,
    distanceToCenter
  };
}

function compareVideos(a: HTMLVideoElement, b: HTMLVideoElement): number {
  const aMetrics = getVideoMetrics(a);
  const bMetrics = getVideoMetrics(b);

  // 1. Viewport presence
  if (aMetrics.inViewport !== bMetrics.inViewport) {
    return aMetrics.inViewport ? -1 : 1;
  }

  if (aMetrics.inViewport) {
    // Both are in viewport
    // 2. Playing state
    if (aMetrics.isPlaying !== bMetrics.isPlaying) {
      return aMetrics.isPlaying ? -1 : 1;
    }
    // 3. Hover state
    if (aMetrics.isHovered !== bMetrics.isHovered) {
      return aMetrics.isHovered ? -1 : 1;
    }
    // 4. Significant difference in visibility ratio (>20%)
    if (Math.abs(aMetrics.visibleRatio - bMetrics.visibleRatio) > 0.2) {
      return aMetrics.visibleRatio > bMetrics.visibleRatio ? -1 : 1;
    }
    // 5. Proximity to center (within 20px threshold to avoid jitter)
    if (Math.abs(aMetrics.distanceToCenter - bMetrics.distanceToCenter) > 20) {
      return aMetrics.distanceToCenter < bMetrics.distanceToCenter ? -1 : 1;
    }
    // 6. Visible area size
    return bMetrics.visibleArea - aMetrics.visibleArea;
  } else {
    // Neither is in viewport
    // 2. Playing state
    if (aMetrics.isPlaying !== bMetrics.isPlaying) {
      return aMetrics.isPlaying ? -1 : 1;
    }
    // 3. Hover state
    if (aMetrics.isHovered !== bMetrics.isHovered) {
      return aMetrics.isHovered ? -1 : 1;
    }
    // 4. Total Area size
    const aArea = a.offsetWidth * a.offsetHeight;
    const bArea = b.offsetWidth * b.offsetHeight;
    return bArea - aArea;
  }
}

function toggleHelpOverlay(): void {
  const overlay = document.querySelector('.theater-help-overlay') as HTMLElement | null;
  if (overlay) {
    hideHelpOverlay();
  } else {
    showHelpOverlay();
  }
}

let helpOverlayElement: HTMLElement | null = null;

function showHelpOverlay(): void {
  if (helpOverlayElement) return;

  showToolbar();

  const shortcuts = configuredShortcuts || defaultShortcuts;

  const overlay = document.createElement('div');
  overlay.className = 'theater-help-overlay';
  applyUiDirection(overlay);
  applyConfiguredAccentColor(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      hideHelpOverlay();
    }
  });

  const card = document.createElement('div');
  card.className = 'theater-help-card';

  const header = document.createElement('div');
  header.className = 'theater-help-header';
  
  const title = document.createElement('h3');
  title.textContent = t('keyboardShortcutsTitle');
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'theater-help-close-btn';
  closeBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;
  closeBtn.addEventListener('click', hideHelpOverlay);

  header.appendChild(title);
  header.appendChild(closeBtn);
  card.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'theater-help-grid';

  const groups = [
    {
      title: t('generalControlsTitle'),
      items: [
        { label: t('toggleTheaterMode'), key: shortcuts.toggle },
        { label: t('exitTheaterMode'), key: shortcuts.exit },
        { label: t('cycleSwitchVideo'), key: shortcuts.cycle },
        { label: t('cycleVideoFit'), key: shortcuts.cycleFit },
        { label: t('showHideHelp'), key: shortcuts.showHelp }
      ]
    },
    {
      title: t('playbackVolumeControlsTitle'),
      items: [
        { label: t('playPause'), key: shortcuts.playPause },
        { label: t('seekBackward5'), key: shortcuts.seekBack },
        { label: t('seekForward5'), key: shortcuts.seekForward },
        { label: t('volumeUp5'), key: shortcuts.volumeUp },
        { label: t('volumeDown5'), key: shortcuts.volumeDown }
      ]
    },
    {
      title: t('frameFullscreenPipTitle'),
      items: [
        { label: t('frameStepBackward'), key: shortcuts.frameBack },
        { label: t('frameStepForward'), key: shortcuts.frameForward },
        { label: t('toggleFullscreen'), key: shortcuts.toggleFullscreen },
        { label: t('togglePictureInPicture'), key: shortcuts.togglePiP }
      ]
    }
  ];

  groups.forEach(group => {
    const groupEl = document.createElement('div');
    groupEl.className = 'theater-help-group';

    const groupTitle = document.createElement('div');
    groupTitle.className = 'theater-help-group-title';
    groupTitle.textContent = group.title;
    groupEl.appendChild(groupTitle);

    group.items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'theater-help-row';

      const labelSpan = document.createElement('span');
      labelSpan.className = 'theater-help-label';
      labelSpan.textContent = item.label;

      const keyWrapper = document.createElement('div');
      keyWrapper.className = 'theater-help-key-wrapper';
      keyWrapper.dir = 'ltr';

      const keys = item.key.split('+');
      keys.forEach((k, idx) => {
        if (idx > 0) {
          keyWrapper.appendChild(document.createTextNode(' + '));
        }
        const kbd = document.createElement('kbd');
        kbd.textContent = k;
        keyWrapper.appendChild(kbd);
      });

      row.appendChild(labelSpan);
      row.appendChild(keyWrapper);
      groupEl.appendChild(row);
    });

    grid.appendChild(groupEl);
  });

  card.appendChild(grid);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  helpOverlayElement = overlay;
}

function hideHelpOverlay(): void {
  if (!helpOverlayElement) return;
  helpOverlayElement.remove();
  helpOverlayElement = null;
  scheduleToolbarHide();
}

// Smart video selection algorithm (viewport-aware and priority ranking)
function findBestVideo(): HTMLVideoElement | null {
  const videos = findAllVideosDeep(document);
  if (videos.length === 0) return null;
  if (videos.length === 1) return videos[0];

  videos.sort(compareVideos);
  return videos[0];
}

function switchTheaterVideo(newVideo: HTMLVideoElement): void {
  if (!theaterElement || theaterElement === newVideo) return;

  // Save/Restore original controls state of the current video and clean up its listeners
  if (theaterElement.tagName === 'VIDEO') {
    const video = theaterElement as HTMLVideoElement;
    video.pause(); // Pause the old video to stop overlapping audio
    const originalControls = video.dataset.originalControls;
    if (originalControls === 'true') {
      video.setAttribute('controls', 'true');
    } else {
      video.removeAttribute('controls');
    }
    delete video.dataset.originalControls;

    const eventTypes = ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'];
    eventTypes.forEach(type => {
      video.removeEventListener(type, preventDoubleToggle, true);
    });

    destroyCustomControls();
    video.classList.remove('controls-visible');
    video.classList.remove('theater-everywhere-video-active');
    restoreTheaterElementInlineStyles(video);
  } else {
    theaterElement.classList.remove('theater-everywhere-video-active');
    restoreTheaterElementInlineStyles(theaterElement);
  }

  // Set the new video as theaterElement
  theaterElement = newVideo;

  const rootNode = newVideo.getRootNode();
  if (rootNode instanceof ShadowRoot) {
    injectStylesIntoShadowRoot(rootNode);
  }
  newVideo.classList.add('theater-everywhere-video-active');
  applyTheaterElementInlineStyles(newVideo);

  // Setup new video
  const originalControls = newVideo.hasAttribute('controls');
  newVideo.dataset.originalControls = originalControls ? 'true' : 'false';
  newVideo.removeAttribute('controls');

  if (newVideo.readyState === 0) {
    newVideo.preload = 'auto';
    newVideo.load();
  }

  newVideo.play().catch(err => {
    console.error('[Theater Everywhere] Auto-play failed during switch:', err);
  });

  const eventTypes = ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'];
  eventTypes.forEach(type => {
    newVideo.addEventListener(type, preventDoubleToggle, true);
  });

  // Recreate custom controls for the new video
  createCustomControls(newVideo);

  // Traverse ancestors and update ancestorsList
  ancestorsList.forEach(parent => {
    if (parent && parent.classList) {
      parent.classList.remove('theater-everywhere-parent-active');
    }
  });
  ancestorsList = [];

  let parent: Node | null = theaterElement.parentNode;
  while (parent && parent !== document.documentElement) {
    if (parent instanceof ShadowRoot) {
      injectStylesIntoShadowRoot(parent);
      parent = parent.host;
    } else {
      if (parent instanceof HTMLElement) {
        parent.classList.add('theater-everywhere-parent-active');
        ancestorsList.push(parent);
      }
      parent = parent.parentNode;
    }
  }

  activeVideo = newVideo;
}

function cycleTheaterVideo(direction: 'next' | 'prev' = 'next'): void {
  if (!theaterElement) return;

  if (theaterElement.tagName !== 'VIDEO') {
    triggerStatusIndicator(t('cycleIframeHud'), STATUS_HUD_SWITCH_ICON);
    return;
  }

  const videos = findAllVideosDeep(document);
  if (videos.length <= 1) {
    triggerStatusIndicator(t('onlyOneVideoHud'), STATUS_HUD_SWITCH_ICON);
    return;
  }

  const currentVideo = theaterElement as HTMLVideoElement;
  const idx = videos.indexOf(currentVideo);
  if (idx === -1) return;

  let nextIdx;
  if (direction === 'next') {
    nextIdx = (idx + 1) % videos.length;
  } else {
    nextIdx = (idx - 1 + videos.length) % videos.length;
  }

  const nextVideo = videos[nextIdx];
  if (nextVideo && nextVideo !== currentVideo) {
    switchTheaterVideo(nextVideo);
  }
}

// Toggle theater mode on or off
function toggleTheaterMode(): void {
  if (isTransitioning) return;
  isTransitioning = true;
  setTimeout(() => { isTransitioning = false; }, 200);

  if (theaterElement) {
    exitTheaterMode();
  } else {
    const video = findBestVideo();
    if (video) {
      enterTheaterMode(video);
    } else {
      // No video found locally, ask child iframes to toggle
      const iframes = document.querySelectorAll('iframe');
      iframes.forEach(iframe => {
        if (iframe.contentWindow) {
          iframe.contentWindow.postMessage({ type: 'theater-everywhere-toggle' }, getIframeOrigin(iframe));
        }
      });
    }
  }
}

// Enter theater mode
function enterTheaterMode(element: HTMLElement): void {
  if (theaterElement) return;

  theaterElement = element;

  // If the active video is inside a Shadow DOM, inject styling into its root node
  const rootNode = element.getRootNode();
  if (rootNode instanceof ShadowRoot) {
    injectStylesIntoShadowRoot(rootNode);
  }

  theaterElement.classList.add('theater-everywhere-video-active');
  applyTheaterElementInlineStyles(theaterElement);

  // Specific setup for HTML5 <video> elements
  if (theaterElement.tagName === 'VIDEO') {
    const video = theaterElement as HTMLVideoElement;
    // Save original controls attribute state
    const originalControls = video.hasAttribute('controls');
    video.dataset.originalControls = originalControls ? 'true' : 'false';
    
    // Hide browser native controls so we use our custom controls overlay instead
    video.removeAttribute('controls');

    // Force loading of paused/unloaded videos to display the initial frame instead of a gray/black screen
    if (video.readyState === 0) {
      video.preload = 'auto';
      video.load();
    }

    // Preemptively enable CORS on the video so Web Audio (Volume Boost) can
    // access decoded audio later without a visible reload at boost time.
    // The theater mode visual transition masks any brief re-fetch.
    if (volumeBoostEnabled && !video.crossOrigin) {
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

    // Create and inject our unified bottom player controls
    createCustomControls(video);
  }

  // Traverse ancestors and apply override class (crossing shadow boundaries)
  ancestorsList = [];
  let parent: Node | null = theaterElement.parentNode;
  while (parent && parent !== document.documentElement) {
    if (parent instanceof ShadowRoot) {
      injectStylesIntoShadowRoot(parent);
      parent = parent.host;
    } else {
      if (parent instanceof HTMLElement) {
        parent.classList.add('theater-everywhere-parent-active');
        ancestorsList.push(parent);
      }
      parent = parent.parentNode;
    }
  }

  // Lock scrollbars on body/html
  document.body.classList.add('theater-everywhere-body-active');
  document.documentElement.classList.add('theater-everywhere-html-active');

  // If we are in an iframe, notify the parent document to expand the iframe itself
  if (window !== window.top) {
    window.parent.postMessage({ type: 'theater-everywhere-enter' }, getParentOrigin());
  }
}

// Exit theater mode
function exitTheaterMode(): void {
  if (!theaterElement) return;

  hideHelpOverlay();

  if (document.fullscreenElement) {
    document.exitFullscreen().catch(console.error);
  }

  // Restore HTML5 video attributes
  if (theaterElement.tagName === 'VIDEO') {
    const video = theaterElement as HTMLVideoElement;
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

  theaterElement.classList.remove('theater-everywhere-video-active');
  restoreTheaterElementInlineStyles(theaterElement);

  // Restore ancestors styling
  ancestorsList.forEach(parent => {
    if (parent && parent.classList) {
      parent.classList.remove('theater-everywhere-parent-active');
    }
  });
  ancestorsList = [];

  // Restore scrollbars
  document.body.classList.remove('theater-everywhere-body-active');
  document.documentElement.classList.remove('theater-everywhere-html-active');

  // If this was an iframe, propagate exit to child window inside it
  if (theaterElement.tagName === 'IFRAME') {
    const iframe = theaterElement as HTMLIFrameElement;
    try {
      if (iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'theater-everywhere-exit-down' }, getIframeOrigin(iframe));
      }
    } catch (e) {
      // Ignore cross-origin exceptions
    }
  }

  // If we are in an iframe, notify parent to restore iframe size
  if (window !== window.top) {
    window.parent.postMessage({ type: 'theater-everywhere-exit' }, getParentOrigin());
  }

  theaterElement = null;
}

// Listen to state changes from the extension popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'statusChanged') {
    checkBlacklistAndInit();
    sendResponse({ success: true });
  }
});

// Run blacklist check and apply theme on load
checkBlacklistAndInit();

if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;

    if (changes.shortcuts?.newValue) {
      const saved = changes.shortcuts.newValue || {};
      configuredShortcuts = {
        toggle: saved.toggle || defaultShortcuts.toggle,
        exit: saved.exit || defaultShortcuts.exit,
        seekBack: saved.seekBack || defaultShortcuts.seekBack,
        seekForward: saved.seekForward || defaultShortcuts.seekForward,
        cycle: saved.cycle || defaultShortcuts.cycle,
        playPause: saved.playPause || defaultShortcuts.playPause,
        frameBack: saved.frameBack || defaultShortcuts.frameBack,
        frameForward: saved.frameForward || defaultShortcuts.frameForward,
        toggleFullscreen: saved.toggleFullscreen || defaultShortcuts.toggleFullscreen,
        volumeUp: saved.volumeUp || defaultShortcuts.volumeUp,
        volumeDown: saved.volumeDown || defaultShortcuts.volumeDown,
        togglePiP: saved.togglePiP || defaultShortcuts.togglePiP,
        showHelp: saved.showHelp || defaultShortcuts.showHelp,
        cycleFit: saved.cycleFit || defaultShortcuts.cycleFit
      };
    }

    if (changes[VIDEO_FIT_STORAGE_KEY]) {
      applyTheaterVideoFit(resolveVideoFitMode(changes[VIDEO_FIT_STORAGE_KEY].newValue));
    }
  });
}

interface ExtendedHTMLDivElement extends HTMLDivElement {
  _videoListenersCleanup?: () => void;
}

interface TooltipState {
  element: HTMLDivElement | null;
}
const tooltipState: TooltipState = {
  element: null
};

function bindCustomTooltip(button: HTMLButtonElement, getTooltipText: () => string): void {
  button.removeAttribute('title');

  const show = () => {
    if (!tooltipState.element) {
      tooltipState.element = document.createElement('div');
      tooltipState.element.className = 'theater-button-tooltip';
      applyUiDirection(tooltipState.element);
      applyConfiguredAccentColor(tooltipState.element);
      document.body.appendChild(tooltipState.element);
    }
    
    const rawText = getTooltipText();
    setTooltipContent(tooltipState.element, rawText);
    tooltipState.element.classList.add('visible');
    
    // Position
    const rect = button.getBoundingClientRect();
    const tooltipWidth = tooltipState.element.offsetWidth;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    
    let tooltipX = rect.left + rect.width / 2;
    const padding = 12;
    const minX = tooltipWidth / 2 + padding;
    const maxX = viewportWidth - (tooltipWidth / 2 + padding);
    
    // Clamp horizontal position to viewport bounds to prevent overflow
    if (tooltipX < minX) {
      tooltipX = minX;
    } else if (tooltipX > maxX) {
      tooltipX = maxX;
    }
    
    const tooltipY = rect.top - 8;
    
    tooltipState.element.style.left = `${tooltipX}px`;
    tooltipState.element.style.top = `${tooltipY}px`;
  };

  const hide = () => {
    if (tooltipState.element) {
      tooltipState.element.classList.remove('visible');
    }
  };

  button.addEventListener('mouseenter', show);
  button.addEventListener('mouseleave', hide);
  button.addEventListener('click', hide);
}

// Creates unified bottom player controls
function createCustomControls(video: HTMLVideoElement): void {
  destroyCustomControls();

  const wrapper = document.createElement('div') as ExtendedHTMLDivElement;
  wrapper.className = 'theater-controls-wrapper';
  applyUiDirection(wrapper);
  applyConfiguredAccentColor(wrapper);

  // Create loading indicator
  const loadingIndicator = document.createElement('div');
  loadingIndicator.className = 'theater-loading-indicator';
  applyUiDirection(loadingIndicator);
  applyConfiguredAccentColor(loadingIndicator);
  
  const loadingSpinner = document.createElement('div');
  loadingSpinner.className = 'theater-loading-spinner';
  
  loadingIndicator.appendChild(loadingSpinner);
  
  document.body.appendChild(loadingIndicator);

  // Prevent event propagation so clicking controls doesn't trigger parent actions or play/pause
  wrapper.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  wrapper.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    e.stopImmediatePropagation();
  });
  wrapper.addEventListener('mousedown', (e) => {
    e.stopPropagation();
  });

  // 1. Scrubber (Progress bar)
  const scrubberContainer = document.createElement('div');
  scrubberContainer.className = 'theater-scrubber-container';

  const scrubberTrack = document.createElement('div');
  scrubberTrack.className = 'theater-scrubber-track';

  const scrubberBuffer = document.createElement('div');
  scrubberBuffer.className = 'theater-scrubber-buffer';

  const scrubberFill = document.createElement('div');
  scrubberFill.className = 'theater-scrubber-fill';

  const scrubberHandle = document.createElement('div');
  scrubberHandle.className = 'theater-scrubber-handle';

  scrubberTrack.appendChild(scrubberBuffer);
  scrubberTrack.appendChild(scrubberFill);
  scrubberTrack.appendChild(scrubberHandle);
  scrubberContainer.appendChild(scrubberTrack);

  const tooltip = document.createElement('div');
  tooltip.className = 'theater-scrubber-tooltip';
  scrubberContainer.appendChild(tooltip);

  // 2. Control Row
  const controlsRow = document.createElement('div');
  controlsRow.className = 'theater-controls-row';

  // Left Controls Section
  const leftSec = document.createElement('div');
  leftSec.className = 'theater-controls-left';

  // Play/Pause Button
  const playPauseBtn = document.createElement('button');
  playPauseBtn.className = 'theater-control-btn play-pause-btn';
  
  bindCustomTooltip(playPauseBtn, () => {
    const action = video.paused ? t('play') : t('pause');
    return `${action} <kbd>${configuredShortcuts.playPause}</kbd>`;
  });

  const playIcon = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3"></polygon>
    </svg>
  `;
  const pauseIcon = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" rx="1"></rect>
      <rect x="14" y="4" width="4" height="16" rx="1"></rect>
    </svg>
  `;

  setIcon(playPauseBtn, video.paused ? playIcon : pauseIcon);
  playPauseBtn.addEventListener('click', () => {
    if (video.paused) {
      video.play().catch(console.error);
    } else {
      video.pause();
    }
  });

  // Volume Container
  const volumeContainer = document.createElement('div');
  volumeContainer.className = 'theater-volume-container';

  const volumeBtn = document.createElement('button');
  volumeBtn.className = 'theater-control-btn volume-btn';

  const volumePanel = document.createElement('div');
  volumePanel.className = 'theater-volume-panel';

  const volumeTooltip = document.createElement('div');
  volumeTooltip.className = 'theater-volume-tooltip-vertical';

  const volumeSliderWrapper = document.createElement('div');
  volumeSliderWrapper.className = 'theater-vertical-slider-wrapper';

  const volumeSlider = document.createElement('input');
  volumeSlider.type = 'range';
  volumeSlider.className = 'theater-volume-slider theater-vertical-slider';
  volumeSlider.min = '0';
  volumeSlider.max = volumeBoostEnabled ? '1.5' : '1.0';
  volumeSlider.step = '0.05';
  
  const boostedVideo = video as BoostedVideoElement;
  const initialLogical = boostedVideo._logicalVolume !== undefined ? boostedVideo._logicalVolume : (video.muted ? 0 : video.volume);
  volumeSlider.value = String(initialLogical);

  const volumeTick100 = document.createElement('div');
  volumeTick100.className = 'volume-tick-100-vertical';
  if (!volumeBoostEnabled) {
    volumeTick100.style.display = 'none';
  }

  volumeSliderWrapper.appendChild(volumeSlider);
  volumeSliderWrapper.appendChild(volumeTick100);
  volumePanel.appendChild(volumeTooltip);
  volumePanel.appendChild(volumeSliderWrapper);

  const volHighIcon = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
    </svg>
  `;
  const volLowIcon = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
    </svg>
  `;
  const volMutedIcon = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
      <line x1="23" y1="9" x2="17" y2="15"></line>
      <line x1="17" y1="9" x2="23" y2="15"></line>
    </svg>
  `;

  const updateVolumeIcon = () => {
    const logicalVol = video.muted ? 0 : (boostedVideo._logicalVolume !== undefined ? boostedVideo._logicalVolume : video.volume);
    if (video.muted || logicalVol === 0) {
      setIcon(volumeBtn, volMutedIcon);
      volumeBtn.style.color = '';
    } else if (logicalVol < 0.5) {
      setIcon(volumeBtn, volLowIcon);
      volumeBtn.style.color = '';
    } else {
      setIcon(volumeBtn, volHighIcon);
      if (logicalVol > 1.0) {
        volumeBtn.style.color = '#f59e0b';
      } else {
        volumeBtn.style.color = '';
      }
    }
  };
  updateVolumeIcon();

  const updateVolumeSliderFill = () => {
    const logicalVol = video.muted ? 0 : (boostedVideo._logicalVolume !== undefined ? boostedVideo._logicalVolume : video.volume);
    const fillPct = (logicalVol / (volumeBoostEnabled ? 1.5 : 1.0)) * 100;
    const isBoosted = logicalVol > 1.0;
    const activeColor = isBoosted ? '#f59e0b' : 'var(--accent-color, #6366f1)';
    const grad = `linear-gradient(to right, ${activeColor} 0%, ${activeColor} ${fillPct}%, rgba(255, 255, 255, 0.2) ${fillPct}%, rgba(255, 255, 255, 0.2) 100%)`;
    volumeSlider.style.setProperty('background', grad, 'important');
    if (isBoosted) {
      volumeSlider.classList.add('boosted');
    } else {
      volumeSlider.classList.remove('boosted');
    }
  };
  updateVolumeSliderFill();

  const updateVolumeTooltip = () => {
    const logicalVol = video.muted ? 0 : (boostedVideo._logicalVolume !== undefined ? boostedVideo._logicalVolume : video.volume);
    if (logicalVol <= 1.0) {
      volumeTooltip.textContent = `${Math.round(logicalVol * 100)}%`;
      volumeTooltip.style.color = '#f8fafc';
    } else {
      const pct = Math.round(100 + (logicalVol - 1.0) * 400);
      volumeTooltip.textContent = `${pct}%`;
      volumeTooltip.style.color = '#f59e0b';
    }
  };
  updateVolumeTooltip();

  volumeBtn.addEventListener('click', () => {
    video.muted = !video.muted;
  });

  volumeSlider.addEventListener('input', (e) => {
    let val = parseFloat((e.target as HTMLInputElement).value);
    if (Math.abs(val - 1.0) <= 0.05) {
      val = 1.0;
      volumeSlider.value = '1.0';
    }
    boostedVideo._logicalVolume = val;
    if (val > 0 && video.muted) {
      video.muted = false;
    }
    applyVolumeAndBoost(boostedVideo, val);
    updateVolumeSliderFill();
    updateVolumeTooltip();
  });

  volumeContainer.appendChild(volumeBtn);
  volumeContainer.appendChild(volumePanel);

  // Time label display
  const timeDisplay = document.createElement('span');
  timeDisplay.className = 'theater-time-display';
  timeDisplay.style.cursor = 'pointer';
  timeDisplay.textContent = '0:00 / 0:00';

  const formatTime = (secs: number): string => {
    if (isNaN(secs) || !isFinite(secs)) return '0:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    const sStr = s < 10 ? '0' + s : String(s);
    if (h > 0) {
      const mStr = m < 10 ? '0' + m : String(m);
      return `${h}:${mStr}:${sStr}`;
    }
    return `${m}:${sStr}`;
  };

  let showRemainingTime = false;
  timeDisplay.addEventListener('click', (e) => {
    e.stopPropagation();
    showRemainingTime = !showRemainingTime;
    updateTimeDisplay();
  });

  const updateTimeDisplay = () => {
    const cur = video.currentTime || 0;
    const dur = video.duration || 0;
    if (showRemainingTime) {
      const remaining = Math.max(0, dur - cur);
      timeDisplay.textContent = `-${formatTime(remaining)} / ${formatTime(dur)}`;
    } else {
      timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
    }
  };
  updateTimeDisplay();

  leftSec.appendChild(playPauseBtn);
  leftSec.appendChild(volumeContainer);
  leftSec.appendChild(timeDisplay);

  // Right Controls Section
  const rightSec = document.createElement('div');
  rightSec.className = 'theater-controls-right';

  // Playback Speed Controls
  const speedContainer = document.createElement('div');
  speedContainer.className = 'theater-speed-container';

  const speedBtn = document.createElement('button');
  speedBtn.className = 'theater-control-btn speed-btn';

  const speedLabel = document.createElement('span');
  speedLabel.className = 'speed-label';
  speedBtn.appendChild(speedLabel);

  const speedLevels = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
  const getSpeedIndex = (rate: number): number => {
    let closestIdx = 3; // default to 1.0
    let minDiff = Infinity;
    for (let i = 0; i < speedLevels.length; i++) {
      const diff = Math.abs(speedLevels[i] - rate);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }
    return closestIdx;
  };

  const updateSpeedLabelText = () => {
    speedLabel.textContent = video.playbackRate.toFixed(2).replace(/\.00$|\.0$/, '') + 'x';
  };
  updateSpeedLabelText();

  const speedPanel = document.createElement('div');
  speedPanel.className = 'theater-speed-panel';

  const speedTooltip = document.createElement('div');
  speedTooltip.className = 'theater-speed-tooltip-vertical';

  const speedSliderWrapper = document.createElement('div');
  speedSliderWrapper.className = 'theater-vertical-slider-wrapper';

  const speedSlider = document.createElement('input');
  speedSlider.type = 'range';
  speedSlider.className = 'theater-speed-slider theater-vertical-slider';
  speedSlider.min = '0';
  speedSlider.max = String(speedLevels.length - 1);
  speedSlider.step = '1';
  speedSlider.value = String(getSpeedIndex(video.playbackRate));

  const speedTick1x = document.createElement('div');
  speedTick1x.className = 'speed-tick-1x-vertical';

  speedSliderWrapper.appendChild(speedSlider);
  speedSliderWrapper.appendChild(speedTick1x);
  speedPanel.appendChild(speedTooltip);
  speedPanel.appendChild(speedSliderWrapper);

  speedContainer.appendChild(speedBtn);
  speedContainer.appendChild(speedPanel);

  let lastNonNormalSpeed = 1.5;

  const updateSpeedSliderFill = () => {
    const idx = getSpeedIndex(video.playbackRate);
    const pct = (idx / (speedLevels.length - 1)) * 100;
    const accentColor = 'var(--accent-color, #6366f1)';
    const grad = `linear-gradient(to right, ${accentColor} 0%, ${accentColor} ${pct}%, rgba(255, 255, 255, 0.2) ${pct}%, rgba(255, 255, 255, 0.2) 100%)`;
    speedSlider.style.setProperty('background', grad, 'important');
  };
  updateSpeedSliderFill();

  const updateSpeedTooltip = () => {
    speedTooltip.textContent = `${video.playbackRate.toFixed(2).replace(/\.00$|\.0$/, '')}x`;
  };
  updateSpeedTooltip();

  speedBtn.addEventListener('click', () => {
    if (video.playbackRate !== 1.0) {
      lastNonNormalSpeed = video.playbackRate;
      video.playbackRate = 1.0;
    } else {
      video.playbackRate = lastNonNormalSpeed;
    }
  });

  speedSlider.addEventListener('input', (e) => {
    const idx = parseInt((e.target as HTMLInputElement).value, 10);
    const rate = speedLevels[idx];
    video.playbackRate = rate;
    if (rate !== 1.0) {
      lastNonNormalSpeed = rate;
    }
    updateSpeedSliderFill();
    updateSpeedTooltip();
  });

  // PiP Button
  const pipBtn = document.createElement('button');
  pipBtn.className = 'theater-control-btn pip-btn';
  if (!document.pictureInPictureEnabled) {
    pipBtn.style.display = 'none';
  }

  bindCustomTooltip(pipBtn, () => t('pictureInPictureTooltip', configuredShortcuts.togglePiP));

  setIcon(pipBtn, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect><rect x="13" y="11" width="7" height="7" rx="1" ry="1"></rect></svg>`);
  pipBtn.addEventListener('click', () => {
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(console.error);
    } else {
      video.requestPictureInPicture().catch(console.error);
    }
  });

  // Fullscreen Button
  const fullscreenBtn = document.createElement('button');
  fullscreenBtn.className = 'theater-control-btn fullscreen-btn';
  
  bindCustomTooltip(fullscreenBtn, () => {
    return document.fullscreenElement ? t('exitFullscreen') : t('fullscreenTooltip', configuredShortcuts.toggleFullscreen);
  });

  const enterFullscreenIcon = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
    </svg>
  `;
  const exitFullscreenIcon = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 14h6v6m10-6h-6v6M4 10h6V4m10 6h-6V4"></path>
    </svg>
  `;

  setIcon(fullscreenBtn, document.fullscreenElement ? exitFullscreenIcon : enterFullscreenIcon);

  let wasPlayingBeforeFullscreen = false;

  const toggleFullscreen = () => {
    wasPlayingBeforeFullscreen = !video.paused;
    
    const resumeIfPaused = () => {
      if (wasPlayingBeforeFullscreen && video.paused) {
        video.play().catch(console.error);
      }
    };

    if (document.fullscreenElement) {
      document.exitFullscreen()
        .then(() => {
          setTimeout(resumeIfPaused, 150);
        })
        .catch(console.error);
    } else {
      const target = theaterElement ? document.documentElement : (video.parentElement || video);
      target.requestFullscreen()
        .then(() => {
          setTimeout(resumeIfPaused, 150);
        })
        .catch(() => {
          video.requestFullscreen()
            .then(() => {
              setTimeout(resumeIfPaused, 150);
            })
            .catch(console.error);
        });
    }
  };
  currentToggleFullscreen = toggleFullscreen;

  fullscreenBtn.addEventListener('click', () => {
    toggleFullscreen();
  });

  const onFullscreenChange = () => {
    setIcon(fullscreenBtn, document.fullscreenElement ? exitFullscreenIcon : enterFullscreenIcon);
    showToolbar();
    if (wasPlayingBeforeFullscreen && video.paused) {
      setTimeout(() => {
        if (video.paused) {
          video.play().catch(console.error);
        }
      }, 50);
    }
  };
  document.addEventListener('fullscreenchange', onFullscreenChange);

  // Close Button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'theater-control-btn close-btn';
  
  bindCustomTooltip(closeBtn, () => {
    const toggleKey = escapeHtml((configuredShortcuts.toggle || 'T').toUpperCase());
    const exitKey = escapeHtml(configuredShortcuts.exit === 'Escape' ? 'Esc' : (configuredShortcuts.exit || 'Esc'));
    return t('exitTheaterModeTooltip', [toggleKey, exitKey]);
  });

  setIcon(closeBtn, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`);
  closeBtn.addEventListener('click', () => {
    exitTheaterMode();
  });

  // Subtitles / CC Button
  const ccBtn = document.createElement('button');
  ccBtn.className = 'theater-control-btn cc-btn';
  
  bindCustomTooltip(ccBtn, () => {
    const tracks = video.textTracks;
    const hasTracks = tracks && tracks.length > 0;
    if (!hasTracks) {
      return t('noSubtitlesAvailable');
    }
    const isCCActive = ccBtn.classList.contains('active');
    return isCCActive ? t('disableSubtitles') : t('enableSubtitles');
  });

  setIcon(ccBtn, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M7 10a2 2 0 0 1 4 0v4a2 2 0 0 1-4 0M14 10a2 2 0 0 1 4 0v4a2 2 0 0 1-4 0"></path></svg>`);

  const ccMenu = document.createElement('div');
  ccMenu.className = 'theater-cc-menu';
  applyUiDirection(ccMenu);
  wrapper.appendChild(ccMenu);

  const checkCCActive = () => {
    const tracks = video.textTracks;
    const hasTracks = tracks && tracks.length > 0;
    
    if (!hasTracks) {
      ccBtn.classList.add('disabled');
      ccBtn.style.opacity = '0.35';
      ccBtn.style.pointerEvents = 'none';
    } else {
      ccBtn.classList.remove('disabled');
      ccBtn.style.opacity = '';
      ccBtn.style.pointerEvents = '';
    }

    let isAnyShowing = false;
    if (tracks) {
      for (let i = 0; i < tracks.length; i++) {
        if (tracks[i].mode === 'showing') {
          isAnyShowing = true;
          break;
        }
      }
    }
    if (isAnyShowing) {
      ccBtn.classList.add('active');
    } else {
      ccBtn.classList.remove('active');
    }
  };

  const handleTrackChange = () => {
    checkCCActive();
    updateCCMenu();
  };

  if (video.textTracks) {
    video.textTracks.addEventListener('change', checkCCActive);
    video.textTracks.addEventListener('addtrack', handleTrackChange);
    video.textTracks.addEventListener('removetrack', handleTrackChange);
  }
  checkCCActive();

  const updateCCMenu = () => {
    ccMenu.innerHTML = '';
    const tracks = video.textTracks;
    
    if (!tracks || tracks.length === 0) {
      const item = document.createElement('div');
      item.className = 'theater-cc-menu-item';
      item.textContent = t('noSubtitles');
      item.style.opacity = '0.5';
      item.style.cursor = 'default';
      ccMenu.appendChild(item);
      return;
    }
    
    // Add "Off" option
    const offItem = document.createElement('button');
    offItem.className = 'theater-cc-menu-item';
    offItem.textContent = t('subtitlesOff');
    
    let isAnyShowing = false;
    for (let i = 0; i < tracks.length; i++) {
      if (tracks[i].mode === 'showing') {
        isAnyShowing = true;
      }
    }
    
    if (!isAnyShowing) {
      offItem.classList.add('active');
      const checkIcon = document.createElement('span');
      checkIcon.textContent = '✓';
      checkIcon.style.marginLeft = '8px';
      offItem.appendChild(checkIcon);
    }
    
    offItem.addEventListener('click', () => {
      for (let i = 0; i < tracks.length; i++) {
        tracks[i].mode = 'disabled';
      }
      updateCCMenu();
      checkCCActive();
      ccMenu.classList.remove('visible');
    });
    ccMenu.appendChild(offItem);
    
    // Add each track
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const item = document.createElement('button');
      item.className = 'theater-cc-menu-item';
      
      const label = track.label || track.language || t('trackLabel', String(i + 1));
      item.textContent = label;
      
      if (track.mode === 'showing') {
        item.classList.add('active');
        const checkIcon = document.createElement('span');
        checkIcon.textContent = '✓';
        checkIcon.style.marginLeft = '8px';
        item.appendChild(checkIcon);
      }
      
      item.addEventListener('click', () => {
        for (let j = 0; j < tracks.length; j++) {
          tracks[j].mode = j === i ? 'showing' : 'disabled';
        }
        updateCCMenu();
        checkCCActive();
        ccMenu.classList.remove('visible');
      });
      ccMenu.appendChild(item);
    }
  };

  ccBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!ccMenu.classList.contains('visible')) {
      updateCCMenu();
      ccMenu.classList.add('visible');
      
      // Position menu relative to the CC button
      const rect = ccBtn.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();
      ccMenu.style.right = `${wrapperRect.right - rect.right}px`;
      ccMenu.style.bottom = `${rect.height + 10}px`;
    } else {
      ccMenu.classList.remove('visible');
    }
  });

  const onDocumentClick = (e: MouseEvent) => {
    if (ccMenu.classList.contains('visible') && !ccMenu.contains(e.target as Node) && !ccBtn.contains(e.target as Node)) {
      ccMenu.classList.remove('visible');
    }
    const target = e.target as HTMLElement;
    if (target && !target.closest('.theater-volume-container')) {
      volumeSlider.blur();
    }
    if (target && !target.closest('.theater-speed-container')) {
      speedSlider.blur();
    }
  };
  window.addEventListener('click', onDocumentClick, true);

  const onWindowBlur = () => {
    ccMenu.classList.remove('visible');
    volumeSlider.blur();
    speedSlider.blur();
  };
  window.addEventListener('blur', onWindowBlur);

  rightSec.appendChild(ccBtn);
  rightSec.appendChild(speedContainer);

  const fitBtn = document.createElement('button');
  fitBtn.className = 'theater-control-btn video-fit-btn';
  bindCustomTooltip(fitBtn, () => t('videoFitTooltip', configuredShortcuts.cycleFit));
  const updateFitButtonIcon = () => {
    setIcon(fitBtn, `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 3H5a2 2 0 0 0-2 2v3"></path>
        <path d="M16 3h3a2 2 0 0 1 2 2v3"></path>
        <path d="M8 21H5a2 2 0 0 1-2-2v-3"></path>
        <path d="M16 21h3a2 2 0 0 0 2-2v-3"></path>
        <rect x="8" y="8" width="8" height="8" rx="1"></rect>
      </svg>
    `);
  };
  updateFitButtonIcon();
  fitBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    cycleVideoFit();
  });
  rightSec.appendChild(fitBtn);

  // Switch Video Button (Only if there are multiple video players on the page)
  const videosOnPage = findAllVideosDeep(document);
  if (videosOnPage.length > 1) {
    const switchVideoBtn = document.createElement('button');
    switchVideoBtn.className = 'theater-control-btn switch-video-btn';
    bindCustomTooltip(switchVideoBtn, () => t('switchVideoTooltip', configuredShortcuts.cycle));
    setIcon(switchVideoBtn, `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"></path>
      </svg>
    `);
    switchVideoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      cycleTheaterVideo('next');
    });
    rightSec.appendChild(switchVideoBtn);
  }

  rightSec.appendChild(pipBtn);
  rightSec.appendChild(fullscreenBtn);

  // Help Button (Keyboard shortcuts listing)
  const helpBtn = document.createElement('button');
  helpBtn.className = 'theater-control-btn help-btn';
  bindCustomTooltip(helpBtn, () => t('keyboardShortcutsTooltip', configuredShortcuts.showHelp));
  setIcon(helpBtn, `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
      <line x1="12" y1="17" x2="12.01" y2="17"></line>
    </svg>
  `);
  helpBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showHelpOverlay();
  });
  rightSec.appendChild(helpBtn);

  rightSec.appendChild(closeBtn);

  controlsRow.appendChild(leftSec);
  controlsRow.appendChild(scrubberContainer);
  controlsRow.appendChild(rightSec);

  wrapper.appendChild(controlsRow);

  document.body.appendChild(wrapper);

  // Scrubber updates
  let isDragging = false;
  let lastSeekTime = 0;
  let seekTimeout: number | null = null;

  const throttledSeek = (time: number) => {
    const now = Date.now();
    if (now - lastSeekTime >= 100) {
      video.currentTime = time;
      lastSeekTime = now;
      if (seekTimeout) {
        clearTimeout(seekTimeout);
        seekTimeout = null;
      }
    } else {
      if (seekTimeout) clearTimeout(seekTimeout);
      seekTimeout = window.setTimeout(() => {
        video.currentTime = time;
        lastSeekTime = Date.now();
      }, 100 - (now - lastSeekTime));
    }
  };

  const updateScrubber = () => {
    const dur = video.duration || 0;
    const cur = video.currentTime || 0;
    
    let bufPct = 0;
    // Update buffering progress
    if (dur > 0 && video.buffered && video.buffered.length > 0) {
      let bufferedEnd = cur;
      for (let i = 0; i < video.buffered.length; i++) {
        const start = video.buffered.start(i);
        const end = video.buffered.end(i);
        if (cur >= start && cur <= end) {
          bufferedEnd = end;
          break;
        }
      }
      bufPct = (bufferedEnd / dur) * 100;
      scrubberBuffer.style.width = `${bufPct}%`;
    } else {
      scrubberBuffer.style.width = '0%';
    }

    if (isDragging || video.seeking) return;
    const pct = dur > 0 ? (cur / dur) * 100 : 0;
    scrubberFill.style.width = `${pct}%`;
    scrubberHandle.style.left = `${pct}%`;
  };
  updateScrubber();

  const updateTooltip = (clientX: number) => {
    const rect = scrubberContainer.getBoundingClientRect();
    if (rect.width === 0) return;
    
    const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const duration = video.duration || 0;
    const time = pos * duration;
    
    tooltip.textContent = formatTime(time);
    const leftPx = pos * rect.width;
    tooltip.style.left = `${leftPx}px`;
    tooltip.classList.add('visible');
  };

  const onScrubberMouseMove = (e: MouseEvent) => {
    if (isDragging) return;
    updateTooltip(e.clientX);
  };

  const onScrubberMouseLeave = () => {
    if (!isDragging) {
      tooltip.classList.remove('visible');
    }
  };

  scrubberContainer.addEventListener('mousemove', onScrubberMouseMove);
  scrubberContainer.addEventListener('mouseleave', onScrubberMouseLeave);

  const handleSeekEvent = (clientX: number, seekMode: 'none' | 'immediate' | 'throttled' = 'none') => {
    const rect = scrubberContainer.getBoundingClientRect();
    if (rect.width === 0) return 0;
    
    const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const pct = pos * 100;
    scrubberFill.style.width = `${pct}%`;
    scrubberHandle.style.left = `${pct}%`;
    
    const duration = video.duration;
    if (isNaN(duration) || !isFinite(duration) || duration <= 0) {
      return 0;
    }
    
    const targetTime = pos * duration;
    if (showRemainingTime) {
      const remaining = Math.max(0, duration - targetTime);
      timeDisplay.textContent = `-${formatTime(remaining)} / ${formatTime(duration)}`;
    } else {
      timeDisplay.textContent = `${formatTime(targetTime)} / ${formatTime(duration)}`;
    }
    
    if (isDragging) {
      updateTooltip(clientX);
    }
    
    if (seekMode === 'immediate') {
      if (seekTimeout) {
        clearTimeout(seekTimeout);
        seekTimeout = null;
      }
      video.currentTime = targetTime;
      lastSeekTime = Date.now();
    } else if (seekMode === 'throttled') {
      throttledSeek(targetTime);
    }
    
    return targetTime;
  };

  const onScrubberMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    isDragging = true;
    scrubberContainer.classList.add('dragging');
    handleSeekEvent(e.clientX, 'immediate');
    
    const onMouseMove = (moveEvt: MouseEvent) => {
      handleSeekEvent(moveEvt.clientX, 'throttled');
    };

    const onMouseUp = (upEvt: MouseEvent) => {
      handleSeekEvent(upEvt.clientX, 'immediate');
      
      const onSeeked = () => {
        isDragging = false;
        scrubberContainer.classList.remove('dragging');
        video.removeEventListener('seeked', onSeeked);
        
        // Hide tooltip if cursor is not over the scrubber container
        const rect = scrubberContainer.getBoundingClientRect();
        if (
          upEvt.clientX < rect.left ||
          upEvt.clientX > rect.right ||
          upEvt.clientY < rect.top ||
          upEvt.clientY > rect.bottom
        ) {
          tooltip.classList.remove('visible');
        }
      };
      video.addEventListener('seeked', onSeeked);
      
      setTimeout(() => {
        isDragging = false;
        scrubberContainer.classList.remove('dragging');
        video.removeEventListener('seeked', onSeeked);
        
        // Hide tooltip if cursor is not over the scrubber container
        const rect = scrubberContainer.getBoundingClientRect();
        if (
          upEvt.clientX < rect.left ||
          upEvt.clientX > rect.right ||
          upEvt.clientY < rect.top ||
          upEvt.clientY > rect.bottom
        ) {
          tooltip.classList.remove('visible');
        }
      }, 150);

      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('mouseup', onMouseUp, true);
    };

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseup', onMouseUp, true);
  };

  scrubberContainer.addEventListener('mousedown', onScrubberMouseDown);

  const onScrubberTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    isDragging = true;
    scrubberContainer.classList.add('dragging');
    handleSeekEvent(e.touches[0].clientX, 'immediate');

    const onTouchMove = (moveEvt: TouchEvent) => {
      if (moveEvt.touches.length === 1) {
        handleSeekEvent(moveEvt.touches[0].clientX, 'throttled');
      }
    };

    const onTouchEnd = (endEvt: TouchEvent) => {
      if (endEvt.changedTouches.length === 1) {
        handleSeekEvent(endEvt.changedTouches[0].clientX, 'immediate');
      }
      const onSeeked = () => {
        isDragging = false;
        scrubberContainer.classList.remove('dragging');
        video.removeEventListener('seeked', onSeeked);
        tooltip.classList.remove('visible');
      };
      video.addEventListener('seeked', onSeeked);
      
      setTimeout(() => {
        isDragging = false;
        scrubberContainer.classList.remove('dragging');
        video.removeEventListener('seeked', onSeeked);
        tooltip.classList.remove('visible');
      }, 150);

      document.removeEventListener('touchmove', onTouchMove, true);
      document.removeEventListener('touchend', onTouchEnd, true);
    };

    document.addEventListener('touchmove', onTouchMove, { capture: true, passive: true });
    document.addEventListener('touchend', onTouchEnd, true);
  };
  scrubberContainer.addEventListener('touchstart', onScrubberTouchStart, { passive: true });

  // Buffering / Loading State Helper
  let bufferingTimeout: number | null = null;

  const setBuffering = (isBuffering: boolean) => {
    if (isBuffering) {
      if (bufferingTimeout || loadingIndicator.classList.contains('visible')) return;
      bufferingTimeout = window.setTimeout(() => {
        loadingIndicator.classList.add('visible');
        scrubberContainer.classList.add('buffering');
        bufferingTimeout = null;
      }, 1000);
    } else {
      if (bufferingTimeout) {
        clearTimeout(bufferingTimeout);
        bufferingTimeout = null;
      }
      loadingIndicator.classList.remove('visible');
      scrubberContainer.classList.remove('buffering');
    }
  };

  // Event hookups
  const onPlay = () => {
    setIcon(playPauseBtn, pauseIcon);
    setBuffering(false);
  };
  const onPause = () => { setIcon(playPauseBtn, playIcon); };
  const onTimeUpdate = () => { 
    updateScrubber(); 
    updateTimeDisplay(); 
    if (!video.paused && !video.seeking && video.readyState >= 3) {
      setBuffering(false);
    }
  };
  const onProgress = () => { updateScrubber(); };
  const onDurationChange = () => { updateScrubber(); updateTimeDisplay(); };
  const onVolumeChange = () => {
    const boostedVideo = video as BoostedVideoElement;
    if (video.muted) {
      volumeSlider.value = '0';
    } else {
      if (boostedVideo._logicalVolume !== undefined && boostedVideo._logicalVolume > 1.0 && video.volume === 1.0) {
        // Keep the slider at the logical volume if currently boosted
        volumeSlider.value = String(boostedVideo._logicalVolume);
      } else {
        boostedVideo._logicalVolume = video.volume;
        volumeSlider.value = String(video.volume);
      }
    }
    updateVolumeIcon();
    updateVolumeSliderFill();
    updateVolumeTooltip();
  };
  onVolumeAdjustedCallback = onVolumeChange;
  const onRateChange = () => {
    updateSpeedLabelText();
    speedSlider.value = String(getSpeedIndex(video.playbackRate));
    updateSpeedSliderFill();
    updateSpeedTooltip();
  };
  
  const onWaiting = () => { setBuffering(true); };
  const onSeeking = () => { setBuffering(true); };
  const onSeeked = () => { 
    updateScrubber(); 
    updateTimeDisplay(); 
    setBuffering(false); 
  };
  const onCanPlay = () => { setBuffering(false); };
  const onPlaying = () => { setBuffering(false); };
  const onStalled = () => {
    if (!video.paused) {
      setBuffering(true);
    }
  };

  video.addEventListener('play', onPlay);
  video.addEventListener('pause', onPause);
  video.addEventListener('timeupdate', onTimeUpdate);
  video.addEventListener('progress', onProgress);
  video.addEventListener('seeked', onSeeked);
  video.addEventListener('durationchange', onDurationChange);
  video.addEventListener('volumechange', onVolumeChange);
  video.addEventListener('ratechange', onRateChange);
  video.addEventListener('waiting', onWaiting);
  video.addEventListener('seeking', onSeeking);
  video.addEventListener('canplay', onCanPlay);
  video.addEventListener('playing', onPlaying);
  video.addEventListener('stalled', onStalled);

  wrapper._videoListenersCleanup = () => {
    onVolumeAdjustedCallback = null;
    video.removeEventListener('play', onPlay);
    video.removeEventListener('pause', onPause);
    video.removeEventListener('timeupdate', onTimeUpdate);
    video.removeEventListener('progress', onProgress);
    video.removeEventListener('seeked', onSeeked);
    video.removeEventListener('durationchange', onDurationChange);
    video.removeEventListener('volumechange', onVolumeChange);
    video.removeEventListener('ratechange', onRateChange);
    video.removeEventListener('waiting', onWaiting);
    video.removeEventListener('seeking', onSeeking);
    video.removeEventListener('canplay', onCanPlay);
    video.removeEventListener('playing', onPlaying);
    video.removeEventListener('stalled', onStalled);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    if (bufferingTimeout) {
      clearTimeout(bufferingTimeout);
      bufferingTimeout = null;
    }
    if (video.textTracks) {
      video.textTracks.removeEventListener('change', checkCCActive);
      video.textTracks.removeEventListener('addtrack', handleTrackChange);
      video.textTracks.removeEventListener('removetrack', handleTrackChange);
    }
    window.removeEventListener('click', onDocumentClick, true);
    window.removeEventListener('blur', onWindowBlur);
    loadingIndicator.remove();
  };

  // Reveal controls for mouse, touch, pen, and keyboard users.
  document.addEventListener('pointermove', showToolbar, { passive: true });
  document.addEventListener('pointerdown', showToolbar, { passive: true });
  wrapper.addEventListener('focusin', showToolbar);
  showToolbar();
}

// Cleans up custom controls
function destroyCustomControls(): void {
  const wrapper = document.querySelector('.theater-controls-wrapper') as ExtendedHTMLDivElement | null;
  if (wrapper) {
    if (wrapper._videoListenersCleanup) {
      wrapper._videoListenersCleanup();
    }
    wrapper.remove();
  }

  if (tooltipState.element) {
    tooltipState.element.remove();
    tooltipState.element = null;
  }
  
  document.removeEventListener('pointermove', showToolbar);
  document.removeEventListener('pointerdown', showToolbar);
  if (toolbarTimer) {
    clearTimeout(toolbarTimer);
    toolbarTimer = null;
  }
  toolbarKeyboardInteractionActive = false;
  document.documentElement.classList.remove(CURSOR_HIDDEN_CLASS);
  document
    .querySelectorAll('.theater-everywhere-seek-overlay, .theater-everywhere-volume-overlay')
    .forEach(overlay => overlay.remove());
  currentToggleFullscreen = null;
}

// Triggers and animates the seek overlay indicator (YouTube-style)
function triggerSeekIndicator(direction: 'left' | 'right'): void {
  if (!theaterElement) return;

  // If an overlay already exists in that direction, remove it to reset the animation
  const existing = document.querySelector(`.theater-everywhere-seek-overlay.${direction}`) as HTMLElement | null;
  if (existing) {
    existing.remove();
  }

  const overlay = document.createElement('div');
  overlay.className = `theater-everywhere-seek-overlay ${direction} animate`;
  applyUiDirection(overlay);
  applyConfiguredAccentColor(overlay);

  const iconWrapper = document.createElement('div');
  iconWrapper.className = 'seek-icon-wrapper';

  if (direction === 'left') {
    ['left-3', 'left-2', 'left-1'].forEach(cls => {
      const arrow = document.createElement('div');
      arrow.className = `seek-arrow left ${cls}`;
      iconWrapper.appendChild(arrow);
    });
    overlay.appendChild(iconWrapper);
  } else {
    ['right-1', 'right-2', 'right-3'].forEach(cls => {
      const arrow = document.createElement('div');
      arrow.className = `seek-arrow right ${cls}`;
      iconWrapper.appendChild(arrow);
    });
    overlay.appendChild(iconWrapper);
  }

  const textSpan = document.createElement('span');
  textSpan.textContent = t('fiveSeconds');
  overlay.appendChild(textSpan);

  document.body.appendChild(overlay);

  // Automatically remove after animation completes
  setTimeout(() => {
    if (overlay && overlay.parentNode) {
      overlay.remove();
    }
  }, 650);
}

function triggerVolumeIndicator(logicalVolume: number, muted: boolean, action: 'up' | 'down'): void {
  if (!theaterElement) return;

  const existing = document.querySelector('.theater-everywhere-volume-overlay') as HTMLElement | null;
  if (existing) {
    existing.remove();
  }

  const overlay = document.createElement('div');
  const isBoosted = !muted && logicalVolume > 1.0;
  overlay.className = 'theater-everywhere-volume-overlay' + (isBoosted ? ' boosted' : '');
  applyUiDirection(overlay);
  applyConfiguredAccentColor(overlay);

  const pct = muted ? 0 : (logicalVolume <= 1.0 ? Math.round(logicalVolume * 100) : Math.round(100 + (logicalVolume - 1.0) * 400));

  let icon = '';
  if (muted || pct === 0) {
    icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
      <line x1="23" y1="9" x2="17" y2="15"></line>
      <line x1="17" y1="9" x2="23" y2="15"></line>
    </svg>`;
  } else if (pct < 50) {
    icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
    </svg>`;
  } else {
    icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
    </svg>`;
  }

  overlay.innerHTML = `
    <div class="volume-hud-content">
      <div class="volume-hud-icon" style="${isBoosted ? 'color: #f59e0b;' : ''}">${icon}</div>
      <span class="volume-hud-text ${action === 'up' ? 'zoom-in' : 'zoom-out'}">${pct}%</span>
    </div>
  `;

  document.body.appendChild(overlay);

  setTimeout(() => {
    overlay.classList.add('fade-out');
    setTimeout(() => {
      overlay.remove();
    }, 200);
  }, 800);
}

const STATUS_HUD_SWITCH_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"></path>
  </svg>
`;

const STATUS_HUD_FIT_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 3H5a2 2 0 0 0-2 2v3"></path>
    <path d="M16 3h3a2 2 0 0 1 2 2v3"></path>
    <path d="M8 21H5a2 2 0 0 1-2-2v-3"></path>
    <path d="M16 21h3a2 2 0 0 0 2-2v-3"></path>
    <rect x="8" y="8" width="8" height="8" rx="1"></rect>
  </svg>
`;

function triggerStatusIndicator(text: string, icon: string): void {
  if (!theaterElement) return;

  const existing = document.querySelector('.theater-everywhere-volume-overlay') as HTMLElement | null;
  if (existing) {
    existing.remove();
  }

  const overlay = document.createElement('div');
  overlay.className = 'theater-everywhere-volume-overlay status-hud';
  applyUiDirection(overlay);
  applyConfiguredAccentColor(overlay);

  overlay.innerHTML = `
    <div class="volume-hud-content">
      <div class="volume-hud-icon zoom-in">${icon}</div>
      <span class="volume-hud-text">${text}</span>
    </div>
  `;

  document.body.appendChild(overlay);

  setTimeout(() => {
    overlay.classList.add('fade-out');
    setTimeout(() => {
      overlay.remove();
    }, 200);
  }, 800);
}

function triggerPlaybackIndicator(action: 'play' | 'pause'): void {
  if (!theaterElement) return;

  const existing = document.querySelector('.theater-everywhere-volume-overlay') as HTMLElement | null;
  if (existing) {
    existing.remove();
  }

  const overlay = document.createElement('div');
  overlay.className = 'theater-everywhere-volume-overlay';
  applyUiDirection(overlay);
  applyConfiguredAccentColor(overlay);

  let icon = '';
  if (action === 'play') {
    icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="5 3 19 12 5 21 5 3"></polygon>
    </svg>`;
  } else {
    icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="6" y="4" width="4" height="16"></rect>
      <rect x="14" y="4" width="4" height="16"></rect>
    </svg>`;
  }

  const text = action === 'play' ? t('play') : t('pause');

  overlay.innerHTML = `
    <div class="volume-hud-content">
      <div class="volume-hud-icon">${icon}</div>
      <span class="volume-hud-text ${action === 'play' ? 'zoom-in' : 'zoom-out'}">${text}</span>
    </div>
  `;

  document.body.appendChild(overlay);

  setTimeout(() => {
    overlay.classList.add('fade-out');
    setTimeout(() => {
      overlay.remove();
    }, 200);
  }, 800);
}
