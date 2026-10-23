import { AUDIO_LABEL_KEYS } from '../audio-settings';

import { NAVIGATION_SHORTCUTS, type Shortcuts } from './shortcuts';

type Action = keyof Shortcuts;

/** Each action's own name (a message key); a shared row still names its halves with these. */
export const SHORTCUT_LABELS: Record<Action, string> = {
  toggle: 'toggleTheaterMode',
  exit: 'exitTheaterMode',
  seekBack: 'seekBackward5',
  seekForward: 'seekForward5',
  cycle: 'cycleSwitchVideo',
  playPause: 'playPause',
  previousVideo: 'previousVideo',
  nextVideo: 'nextVideo',
  frameBack: 'frameStepBackward',
  frameForward: 'frameStepForward',
  toggleFullscreen: 'toggleFullscreen',
  volumeUp: 'volumeUp5',
  volumeDown: 'volumeDown5',
  toggleMute: 'toggleMute',
  togglePiP: 'togglePictureInPicture',
  showHelp: 'showHideHelp',
  toggleControlsPin: 'toggleControlsPin',
  cycleFit: 'cycleVideoFit',
  cycleLayout: 'cyclePictureLayout',
  toggleChat: 'toggleNativeChat',
  toggleCaptions: 'toggleSubtitles',
  increaseCaptionSize: 'increaseSubtitleSize',
  decreaseCaptionSize: 'decreaseSubtitleSize',
  toggleVolumeBoost: 'volumeBoostLabel',
  cycleVoice: AUDIO_LABEL_KEYS.voice,
  cycleLeveling: AUDIO_LABEL_KEYS.leveling,
  cycleBass: AUDIO_LABEL_KEYS.bass,
  navigateUp: 'navigateUp',
  navigateLeft: 'navigateLeft',
  navigateDown: 'navigateDown',
  navigateRight: 'navigateRight'
};

/** A row of the shortcuts help: one action, opposites sharing a row (less before more), or the navigation cluster. */
export interface ShortcutHelpRow {
  /** Message key; defaults to the single action's own label. */
  label?: string;
  actions: readonly Action[];
}

export interface ShortcutHelpGroup {
  id: string;
  title: string;
  rows: readonly ShortcutHelpRow[];
}

/**
 * What the shortcuts help lists, in reading order: groups and rows by how often people reach for them.
 * Every action appears exactly once (a test enforces it), so a new shortcut is one row here; the
 * dialog lays the groups out on its own.
 */
export const SHORTCUT_HELP_GROUPS: readonly ShortcutHelpGroup[] = [
  { id: 'playback', title: 'helpGroupPlayback', rows: [
    { actions: ['playPause'] },
    { label: 'helpSeek', actions: ['seekBack', 'seekForward'] },
    { label: 'helpPreviousNext', actions: ['previousVideo', 'nextVideo'] },
    { label: 'helpFrameStep', actions: ['frameBack', 'frameForward'] }
  ] },
  { id: 'audio', title: 'settingsSectionAudio', rows: [
    { label: 'helpVolume', actions: ['volumeDown', 'volumeUp'] },
    { actions: ['toggleMute'] },
    { actions: ['toggleVolumeBoost'] },
    { actions: ['cycleVoice'] },
    { actions: ['cycleLeveling'] },
    { actions: ['cycleBass'] }
  ] },
  { id: 'captions', title: 'subtitlesMenuTitle', rows: [
    { actions: ['toggleCaptions'] },
    { label: 'helpSubtitleSize', actions: ['decreaseCaptionSize', 'increaseCaptionSize'] }
  ] },
  { id: 'view', title: 'theaterFullscreenPipTitle', rows: [
    { actions: ['toggle'] },
    { actions: ['exit'] },
    { actions: ['toggleFullscreen'] },
    { actions: ['togglePiP'] },
    { actions: ['cycle'] }
  ] },
  { id: 'layout', title: 'helpGroupLayout', rows: [
    { actions: ['cycleFit'] },
    { actions: ['cycleLayout'] },
    { actions: ['toggleChat'] }
  ] },
  { id: 'navigation', title: 'navigationGroupTitle', rows: [
    { label: 'helpNavigateControls', actions: NAVIGATION_SHORTCUTS },
    { actions: ['toggleControlsPin'] },
    { actions: ['showHelp'] }
  ] }
];

export function shortcutHelpRowLabel(row: ShortcutHelpRow): string {
  return row.label ?? SHORTCUT_LABELS[row.actions[0]];
}
