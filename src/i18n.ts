export const FALLBACK_MESSAGES: Record<string, string> = {
  shortcutUnassigned: "Not assigned",
  shortcutExistingConflicts: "Some shortcuts are assigned to multiple actions. Edit or reset the highlighted shortcuts to resolve the conflicts.",
  shortcutConflictTitle: "Shortcut already assigned",
  shortcutConflictDescription: "$1 is assigned to $2. Move it to $3? The previous actions will no longer have this shortcut.",
  shortcutKeepAssignment: "Keep current assignment",
  shortcutReassign: "Move shortcut",
  shortcutEscapeReserved: "Escape is reserved for closing dialogs and exiting theater mode. Choose another shortcut for this action.",
  shortcutSaveError: "Shortcut could not be saved",
  shortcutSaveErrorDescription: "Your shortcuts were not changed. Please try again.",

  playerSettingsLabel: "Player settings",
  extensionSettingsLabel: "Extension settings",
  videoFitLabel: "Video fit",
  controlsVisibilityOn: "On",
  controlsVisibilityOff: "Off",
  autoEnterTheaterTitle: "Automatically enter theater mode",
  autoEnterTheaterOn: "On",
  autoEnterTheaterOff: "Off",
  autoEnterTheaterDescription: "Enter theater mode when the main video starts playing on supported services’ watch pages with Rich Theater Experience enabled.",
  keepControlsVisibleTitle: "Always show controls",
  keepControlsVisibleDescription: "Keep the playback controls and progress bar visible in theater mode. The title and cursor still hide when idle.",
  toggleControlsPin: "Toggle controls visibility",
  controlsPinnedHud: "Controls always visible",
  controlsUnpinnedHud: "Controls auto-hide",
  extensionName: 'Theater Mode Everywhere',
  extensionDescription: 'Maximize any HTML5 video player to fill the browser viewport with a single keypress.',
  cwsPromoBeforeLabel: 'BEFORE',
  cwsPromoAfterLabel: 'AFTER',
  cwsPromoPlayerUiLabel: 'Player UI',
  cwsPromoShortcutsLabel: 'Shortcuts',
  settingsTitle: 'Settings',
  settingsPageTitle: 'Theater Mode Everywhere - Settings',
  settingsSubtitle: 'Configure website exclusions, appearance, and theater mode keyboard shortcuts.',
  websiteLabel: 'Website',
  loadingLabel: 'Loading...',
  systemPage: 'System page',
  noActivePage: 'No active page',
  errorLoading: 'Error loading',
  statusActive: 'Active',
  statusDisabled: 'Disabled',
  statusDisabledByParent: 'Disabled by $1',
  statusInactiveSystem: 'Inactive (system)',
  statusUnavailable: 'Unavailable',
  toggleTheaterModeLower: 'Toggle theater mode',
  createdBy: 'Created by Tomasz Janusz',
  createdByHtml: 'Created by <a href="https://tomaszjanusz.dev" target="_blank" rel="noopener noreferrer">Tomasz Janusz</a>',
  appearanceTitle: 'Appearance',
  appearanceDescription: 'Choose where the picture sits, and the accent for controls, sliders, shortcuts, and highlights.',
  cyclePictureLayout: 'Change picture layout',
  pictureAlignLabel: 'Layout',
  pictureAlignCenter: 'Centered',
  pictureAlignCenterDescription: 'Picture stays in the middle of the screen. Best\u00a0for\u00a016:9\u00a0screens.',
  pictureAlignTop: 'Raised',
  pictureAlignTopDescription: 'Picture sits at the top, with a black band below for captions. Best for 16:10 and 4:3\u00a0screens.',
  pictureAlignSubtitlesOnlyTitle: 'Raised only with subtitles',
  pictureAlignSubtitlesOnlyDescription: 'Use Raised when subtitles are on and Centered when they are off.',
  voiceBoostLabel: 'Voice boost',
  voiceBoostOff: 'Off',
  voiceBoostLight: 'Light',
  voiceBoostStrong: 'Strong',
  audioProtected: 'Audio settings are unavailable: this video is DRM-protected.',
  audioRefused: 'Audio settings are unavailable: the video’s server doesn’t allow it.',
  audioUnavailableHud: 'Audio settings are unavailable for this video',
  voiceBoostHud: 'Voice boost: $1',
  volumeLevelingLabel: 'Reduce loud sounds',
  volumeLevelingOff: 'Off',
  volumeLevelingLight: 'Light',
  volumeLevelingStrong: 'Strong',
  volumeLevelingHud: 'Reduce loud sounds: $1',
  bassLabel: 'Bass',
  bassLess: 'Less',
  bassOriginal: 'Original',
  bassMore: 'More',
  bassHud: 'Bass: $1',
  volumeBoostLabel: 'Volume boost',
  volumeBoostOff: 'Off',
  volumeBoostOn: 'On',
  volumeBoostHud: 'Volume boost: $1',
  accentColorLabel: 'Accent color',
  accentColorSystem: 'System',
  accentColorTeal: 'Teal',
  accentColorBlue: 'Blue',
  accentColorGreen: 'Green',
  accentColorYellow: 'Yellow',
  accentColorOrange: 'Orange',
  accentColorRed: 'Red',
  accentColorPink: 'Pink',
  accentColorPurple: 'Purple',
  accentColorGray: 'Gray',
  useAccentColor: 'Use $1 as the accent color',
  featuresTitle: 'Features',
  featuresDescription: 'Turn optional theater mode behavior on or off.',
  volumeBoostTitle: 'Volume Boost',
  volumeBoostDescription: 'Amplify volume up to 300% using Web Audio API. A brief loading spinner may appear the first time you enter theater mode while this is enabled.',
  richTheaterExperienceTitle: 'Rich Theater Experience (Experimental)',
  richTheaterExperienceDescription: 'Enable richer integrations with your favorite video services, including YouTube, Twitch, Disney+, Netflix, Bilibili, Bilibili.tv, Tencent Video / WeTV, Crunchyroll, and more. Theater Mode Everywhere can show additional information, support custom subtitle formats, and unlock service-specific features. Availability varies by service - read more ',
  richTheaterExperienceReadMore: 'here',
  richTheaterExperienceDescriptionEnd: '.',
  richTheaterExperiencePopupDescription: 'Enable richer integrations with your favorite video services. Availability varies by service.',
  youtubeIntegrationTitle: 'YouTube integration',
  youtubeIntegrationDescription: 'Enables support for captions, chapters, Most Replayed heatmap, and thumbnails on the timeline in theater mode.',
  vimeoIntegrationTitle: 'Vimeo integration',
  vimeoIntegrationDescription: 'Enables support for chapter markers and thumbnails on the timeline in theater mode.',
  patreonIntegrationTitle: 'Patreon integration',
  patreonIntegrationDescription: 'Enables support for captions and thumbnails on the timeline in theater mode.',
  twitchIntegrationTitle: 'Twitch integration',
  twitchIntegrationDescription: 'Enables support for VOD chapters and thumbnails on the timeline in theater mode.',
  disneyIntegrationTitle: 'Disney+ integration',
  disneyIntegrationDescription: 'Enables support for captions and thumbnails on the timeline in theater mode when the player provides them.',
  netflixIntegrationTitle: 'Netflix integration',
  netflixIntegrationDescription: 'Shows the current title and switches the player\'s subtitle languages in theater mode when the player has an active subtitle renderer. Chapters and timeline thumbnails are not supported.',
  bilibiliIntegrationTitle: 'Bilibili (bilibili.com) integration',
  bilibiliIntegrationDescription: 'Imports the video title, subtitles, chapters, the high-energy progress heatmap, and timeline thumbnails from bilibili.com when available. Some subtitles require signing in to Bilibili.',
  bilibiliIntlIntegrationTitle: 'Bilibili.tv integration',
  bilibiliIntlIntegrationDescription: 'Imports the title, subtitles, and timeline thumbnails from bilibili.tv episode and user-upload pages when available. Episode pages can show intro and outro markers. Next episode uses the player’s next control. This integration does not import a named chapter list or the high-energy heatmap.',
  tencentIntegrationTitle: 'Tencent Video / WeTV integration',
  tencentIntegrationDescription: "Imports episode titles, SRT/WebVTT subtitles and timeline thumbnails from Tencent Video / WeTV when available. Playback and next-episode controls use the player’s available controls.",
  crunchyrollIntegrationTitle: 'Crunchyroll integration',
  crunchyrollIntegrationDescription: 'Shows the episode title, intro and credits, available subtitle controls, and timeline previews. Burned-in captions stay on the video and cannot be turned off.',
  websiteExclusionsTitle: 'Website Exclusions',
  websiteExclusionsDescription: 'Exclude websites where you do not want theater mode to activate automatically.',
  domainInputPlaceholder: 'e.g., youtube.com or paste a URL',
  excludedWebsitesTitle: 'Excluded Websites',
  exclusionsFooterTip: 'Tip: You can also manage exclusions directly by clicking the extension icon in your browser toolbar.',
  invalidDomain: 'Invalid domain or URL format.',
  websiteAlreadyExcluded: 'This website is already excluded.',
  errorSavingSettings: 'Error saving settings.',
  noExclusionsYet: 'No exclusions yet',
  noExclusionsDescription: 'Theater mode will activate automatically on all video pages.',
  removeExclusion: 'Remove exclusion',
  errorLoadingSettings: 'Error loading settings.',
  keyboardShortcutsTitle: 'Keyboard Shortcuts',
  keyboardShortcutsDescription: 'Click any input field and press your desired key combination to configure. Modifiers like Ctrl, Alt, and Shift are supported.',
  playerControlsTitle: 'Player Controls',
  toggleTheaterMode: 'Toggle Theater Mode',
  exitTheaterMode: 'Exit Theater Mode',
  cycleSwitchPlayer: 'Switch Video on Page',
  cycleSwitchVideo: 'Switch Video on Page',
  cycleSwitchPlayerDescription: 'Works only when the page has more than one HTML5 video.',
  cycleVideoFit: 'Cycle Video Fit',
  onlyOneVideoHud: 'Feature unavailable. Video switching is only possible when there are more players on the page.',
  cycleIframeHud: 'Switching works only with HTML5 video',
  videoFitTooltip: 'Video Fit <kbd>$1</kbd>',
  videoFitContain: 'Fit',
  videoFitCover: 'Fill',
  videoFitFill: 'Stretch',
  reportABug: 'Report a Bug',
  privacyThingLabel: 'Privacy Thing',
  privacyThingPopoverTitle: 'Privacy Thing',
  privacyThingPopoverBody: 'Here is my new extension! With Privacy Thing, you decide what any website can see about you: location, language, time zone, and much more. It reduces how you can be tracked from site to site.',
  privacyThingPopoverNote: 'Free and open source.',
  whatsNew: "What's New",
  whatsNewDialogTitle: "What's New",
  whatsNewLead: 'A more comfortable theater mode, with new controls and more supported services.',
  whatsNewItemChat: 'Keep YouTube and Twitch chat beside or below the video, and show or hide it from the player.',
  whatsNewItemLayout: 'Choose a centered or raised picture; raised captions use the black space below widescreen video.',
  whatsNewItemControls: 'Keep controls visible, switch to the previous or next video when available, and see the title in the player.',
  whatsNewItemAudio: 'Adjust dialogue, loud sounds, bass and volume from Player settings when audio processing is available.',
  whatsNewItemServices: 'New Rich Theater Experience support for Bilibili, Bilibili.tv, Tencent Video / WeTV, Crunchyroll and Netflix, plus service skip buttons where available.',
  whatsNewThanks: 'Thanks to @liango2 for suggesting always-visible controls, and Denis Tyscenko for suggesting automatic theater mode.',
  dialogAcknowledge: 'Got it',
  dialogChoiceTrue: 'Yes',
  dialogChoiceFalse: 'No',
  showHideHelp: 'Show/Hide Help',
  playbackVolumeControlsTitle: 'Playback & Volume Controls',
  playPause: 'Play / Pause',
  seekBackward5: 'Seek Backward (5s)',
  seekForward5: 'Seek Forward (5s)',
  volumeUp5: 'Volume Up (5%)',
  volumeDown5: 'Volume Down (5%)',
  toggleMute: 'Toggle mute',
  theaterFullscreenPipTitle: 'Theater, Fullscreen & PiP',
  frameStepBackward: 'Frame Step Backward',
  frameStepForward: 'Frame Step Forward',
  frameStepBackward004: 'Frame Step Backward (0.04s)',
  frameStepForward004: 'Frame Step Forward (0.04s)',
  toggleFullscreen: 'Toggle Fullscreen',
  togglePictureInPicture: 'Toggle Picture-in-Picture',
  pressKeysPlaceholder: 'Press keys...',
  resetToDefault: 'Reset to default',
  resetToDefaults: 'Reset to defaults',
  copyrightHtml: '© 2026 <a href="https://tomaszjanusz.dev" target="_blank" rel="noopener noreferrer">Tomasz Janusz</a>. Released under the <a href="#about">MIT license</a>.',
  homepage: 'Homepage',
  madeInPoland: 'Made with <span class="heart">❤</span> in 🇵🇱',
  aboutTitle: "About",
  aboutTagline: "One player to rule them all.",
  aboutGreeting: "Hi,",
  aboutLetterOrigin: "Thank you so much for choosing my extension! Theater Mode Everywhere was born out of my frustration with the many different solutions that were all supposed to provide one thing: a comfortable way to watch video. They don't deliver it. Most players on the internet lack features that should be standard.",
  aboutLetterProduct: "That's why I created Theater Mode Everywhere: a universal player that, in my humble opinion, gives you a comfortable way to watch video everywhere, and can handle the non-standard, unique features of many websites.",
  aboutLetterFreeHtml: "The extension is free and doesn't send any information about you or what you watch anywhere. If something doesn't work right, you can report it on <a href=\"https://github.com/TomaszJanusz/Theater-Mode-Everywhere/issues/new?template=bug_report.yml\" target=\"_blank\" rel=\"noopener noreferrer\">GitHub</a>.",
  aboutLetterStoresHtml: "Theater Mode Everywhere is available on the <a href=\"https://chromewebstore.google.com/detail/theater-mode-everywhere/cncfdfheagoagmoeiaecfpbcljncoepe\" target=\"_blank\" rel=\"noopener noreferrer\">Chrome Web Store</a>, <a href=\"https://addons.mozilla.org/firefox/addon/theater-mode-everywhere/\" target=\"_blank\" rel=\"noopener noreferrer\">Mozilla Add-ons</a> and <a href=\"https://microsoftedge.microsoft.com/addons/detail/daammcppiohibmlfnaafaeaggbmlhlik\" target=\"_blank\" rel=\"noopener noreferrer\">Microsoft Edge Add-ons</a>. I'd be happy if you shared your opinion about it.",
  aboutSignoff: "Happy watching ❤️!",
  aboutLegalTitle: "Terms of use • License",
  aboutLicenseNote: "The extension is available under the MIT license.",
  play: 'Play',
  pause: 'Pause',
  previousVideo: 'Previous',
  backToStart: 'Back to start',
  nextVideo: 'Next',
  muteHud: 'Mute',
  unmuteHud: 'Unmute',
  pictureInPictureTooltip: 'Picture-in-Picture <kbd>$1</kbd>',
  exitFullscreen: 'Exit Fullscreen',
  fullscreenTooltip: 'Fullscreen <kbd>$1</kbd>',
  exitTheaterModeTooltip: 'Exit Theater Mode <kbd>$1</kbd> or <kbd>$2</kbd>',
  noSubtitlesAvailable: 'No subtitles available',
  disableSubtitles: 'Disable Subtitles',
  enableSubtitles: 'Enable Subtitles',
  toggleNativeChat: 'Toggle chat',
  toggleSubtitles: 'Toggle Subtitles',
  increaseSubtitleSize: 'Increase Subtitle Size',
  decreaseSubtitleSize: 'Decrease Subtitle Size',
  subtitlesTooltip: 'Subtitles <kbd>$1</kbd>',
  subtitlesOnHud: 'Subtitles on',
  subtitlesOnNamedHud: 'Subtitles on: $1',
  subtitlesOffHud: 'Subtitles off',
  subtitlesLoadingHud: 'Loading subtitles...',
  subtitlesLoadFailedHud: 'Couldn\'t load subtitles',
  noSubtitles: 'No subtitles',
  subtitlesOff: 'Off',
  autoGeneratedTrack: '$1 (auto)',
  trackLabel: 'Track $1',
  subtitlesMenuTitle: 'Subtitles',
  subtitleOptions: 'Options',
  subtitleOptionsTitle: 'Subtitle options',
  subtitleFont: 'Font',
  subtitleTextColor: 'Text',
  subtitleSize: 'Size',
  subtitleDropShadow: 'Shadow',
  subtitleBackground: 'Background',
  subtitleOpacity: 'Opacity',
  subtitlePreviewSample: 'Sample caption',
  dialogDone: 'Done',
  dialogClose: 'Close',
  switchVideoTooltip: 'Switch Video on Page <kbd>$1</kbd>',
  keyboardShortcutsTooltip: 'Keyboard Shortcuts <kbd>$1</kbd>',
  fiveSeconds: '5 seconds',
  '@@bidi_dir': 'ltr',
  '@@ui_locale': 'en'
};

export function t(messageName: string, substitutions?: string | string[]): string {
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage) {
      const message = chrome.i18n.getMessage(messageName, substitutions);
      if (message) {
        return message;
      }
    }
  } catch (_) {
    // Fall through to the key for local file/dev-server contexts.
  }

  let fallback = FALLBACK_MESSAGES[messageName] || messageName;
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

export function localizeDocument(root: ParentNode = document): void {
  applyDocumentLocale(root);

  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n || '');
  });

  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((element) => {
    element.innerHTML = t(element.dataset.i18nHtml || '');
  });

  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((element) => {
    element.title = t(element.dataset.i18nTitle || '');
  });

  root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder || '');
  });

  root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel || ''));
  });
}

function applyDocumentLocale(root: ParentNode): void {
  const ownerDocument = root instanceof Document ? root : root.ownerDocument;
  const documentElement = ownerDocument?.documentElement;
  if (!documentElement) {
    return;
  }

  const bidiDir = t('@@bidi_dir');
  documentElement.dir = bidiDir === 'rtl' ? 'rtl' : 'ltr';

  const uiLocale = t('@@ui_locale');
  if (uiLocale && !uiLocale.startsWith('@@')) {
    documentElement.lang = uiLocale.replace('_', '-');
  }
}
