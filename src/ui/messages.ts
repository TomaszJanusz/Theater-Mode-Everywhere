import { SHARED_I18N_FALLBACKS } from '../i18n-fallbacks';
import { translateMessage } from '../i18n-runtime';

export const PLAYER_I18N_FALLBACKS: Record<string, string> = {
  ...SHARED_I18N_FALLBACKS,
  showNativeChat: "Show chat",
  hideNativeChat: "Hide chat",
  settingsSectionChat: "Chat",
  settingsSectionPlayer: "Player",
  nativeChatResize: "Resize chat",
  nativeChatTheme: "Theme",
  nativeChatThemeLight: "Light",
  nativeChatThemeNative: "Service settings",
  nativeChatThemeDark: "Dark",
  nativeChatThemeUnavailable: "Chat is using the service appearance. The selected theme is unavailable on this page.",
  nativeChatFullscreenUnavailable: "Fullscreen with chat is unavailable. Theater mode remains active.",
  autoEnterNoticeTitle: "Entering theater mode…",
  autoEnterNoticeHint: "Click or press $1 to cancel",
  videoActivatorLabel: "Enter theater mode",
  helpGroupPlayback: "Playback",
  helpGroupLayout: "Picture and layout",
  helpSeek: "Seek back / forward (5s)",
  helpPreviousNext: "Previous / next video",
  helpFrameStep: "Frame step back / forward",
  helpPlaybackSpeed: "Playback speed slower / faster",
  helpVolume: "Volume down / up (5%)",
  helpSubtitleSize: "Subtitle size smaller / larger",
  helpNavigateControls: "Move between controls",
  helpNavigationHint: "$1 opens the controls bar at the settings button. On a menu button, $1 opens its menu and $2 from its bottom row closes it. $3 ends navigation.",
  helpSeekHoldHint: "Hold $1 to play at 2x until you let go.",
  helpCustomizeShortcuts: "Customize shortcuts",
  replay: 'Replay',
  videoEnded: 'Video ended',
  skipIntro: 'Skip intro',
  skipOutro: 'Skip outro',
  liveBadge: 'LIVE',
  jumpToLive: 'Go to live',
  showTotalTime: 'Show duration',
  showRemainingTime: 'Show time remaining',
  audioTrackLabel: "Audio track",
  audioTrackBack: "Back",
  searchAudioTracks: "Search audio tracks…",
  noAudioTracks: "No audio tracks",
  audioTrackDescription: "$1 (audio description)",
  audioTrackCommentary: "$1 (commentary)",
  audioTrackServiceDefault: "Default",
  audioTrackFailedHud: "Couldn't switch audio track",
  audioTrackDefaultHud: "$1 (Default)",
  audioHudLabel: 'Audio',
  audioTrackRefusedHud: "Couldn't switch to $1",
  subtitlesHudOn: 'On',
  subtitlesHudNone: 'Not available',
  subtitlesHudFailed: "Couldn't load",

};

export type UiDirection = 'ltr' | 'rtl';

export function t(messageName: string, substitutions?: string | string[]): string {
  return translateMessage(PLAYER_I18N_FALLBACKS, messageName, substitutions);
}

export function getUiDirection(): UiDirection {
  return t('@@bidi_dir') === 'rtl' ? 'rtl' : 'ltr';
}

export function applyUiDirection(element: HTMLElement): void {
  element.dir = getUiDirection();

  const language = t('@@ui_locale');
  if (language && !language.startsWith('@@')) {
    element.lang = language.replace('_', '-');
  }
}
