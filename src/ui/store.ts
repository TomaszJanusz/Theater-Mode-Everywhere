import { resolveSponsorBlockMarkers } from './sponsorblock-settings';
import { resolveCaptionStyle, type CaptionStyle } from '../media-features/caption-style';
import {
  DEFAULT_ACCENT_COLOR,
  DEFAULT_PICTURE_ALIGN,
  DEFAULT_VIDEO_FIT,
  type AccentColorPreset,
  type PictureAlign,
  type VideoFitMode
} from './appearance';
import { defaultShortcuts, type Shortcuts } from './shortcuts';
import { DEFAULT_AUDIO_SETTINGS, sameAudioSettings, type AudioSettings } from '../audio-settings';
import { DEFAULT_VOLUME_BOOST_ENABLED } from './volume-boost-settings';
import { DEFAULT_AUTO_ENTER_THEATER } from './auto-theater';

export type PlayerUiState = {
  theaterActive: boolean;
  helpOpen: boolean;
  toolbarVisible: boolean;
  sponsorBlockMarkers: boolean;
  keepControlsVisible: boolean;
  videoFit: VideoFitMode;
  pictureAlign: PictureAlign;
  raiseOnlyWithSubtitles: boolean;
  audio: AudioSettings;
  volumeBoost: boolean;
  autoEnterTheater: boolean;
  accentColor: AccentColorPreset;
  captionStyle: CaptionStyle;
  shortcuts: Shortcuts;
};

export type PlayerUiAction =
  | { type: 'HYDRATE'; value: Partial<PlayerUiState> }
  | { type: 'SET_THEATER_ACTIVE'; value: boolean }
  | { type: 'SET_HELP_OPEN'; value: boolean }
  | { type: 'SET_TOOLBAR_VISIBLE'; value: boolean }
  | { type: 'SET_KEEP_CONTROLS_VISIBLE'; value: boolean }
  | { type: 'SET_VIDEO_FIT'; value: VideoFitMode }
  | { type: 'SET_PICTURE_ALIGN'; value: PictureAlign }
  | { type: 'SET_RAISE_ONLY_WITH_SUBTITLES'; value: boolean }
  | { type: 'SET_AUDIO'; value: AudioSettings }
  | { type: 'SET_VOLUME_BOOST'; value: boolean }
  | { type: 'SET_AUTO_ENTER_THEATER'; value: boolean }
  | { type: 'SET_ACCENT'; value: AccentColorPreset }
  | { type: 'SET_CAPTION_STYLE'; value: CaptionStyle }
  | { type: 'SET_SHORTCUTS'; value: Shortcuts };

const defaultState = (): PlayerUiState => ({
  theaterActive: false,
  helpOpen: false,
  toolbarVisible: false,
  sponsorBlockMarkers: resolveSponsorBlockMarkers(undefined),
  keepControlsVisible: false,
  videoFit: DEFAULT_VIDEO_FIT,
  pictureAlign: DEFAULT_PICTURE_ALIGN,
  raiseOnlyWithSubtitles: false,
  audio: DEFAULT_AUDIO_SETTINGS,
  volumeBoost: DEFAULT_VOLUME_BOOST_ENABLED,
  autoEnterTheater: DEFAULT_AUTO_ENTER_THEATER,
  accentColor: DEFAULT_ACCENT_COLOR,
  captionStyle: resolveCaptionStyle(null),
  shortcuts: { ...defaultShortcuts }
});

function sameState(left: PlayerUiState, right: PlayerUiState): boolean {
  return (
    left.theaterActive === right.theaterActive
    && left.helpOpen === right.helpOpen
    && left.toolbarVisible === right.toolbarVisible
    && left.sponsorBlockMarkers === right.sponsorBlockMarkers
    && left.keepControlsVisible === right.keepControlsVisible
    && left.videoFit === right.videoFit
    && left.pictureAlign === right.pictureAlign
    && left.raiseOnlyWithSubtitles === right.raiseOnlyWithSubtitles
    && sameAudioSettings(left.audio, right.audio)
    && left.volumeBoost === right.volumeBoost
    && left.autoEnterTheater === right.autoEnterTheater
    && left.accentColor === right.accentColor
    && left.captionStyle === right.captionStyle
    && left.shortcuts === right.shortcuts
  );
}

function reduce(state: PlayerUiState, action: PlayerUiAction): PlayerUiState {
  let next = state;
  switch (action.type) {
    case 'HYDRATE':
      next = { ...state, ...action.value };
      break;
    case 'SET_THEATER_ACTIVE':
      next = { ...state, theaterActive: action.value, helpOpen: action.value ? state.helpOpen : false };
      break;
    case 'SET_HELP_OPEN':
      next = { ...state, helpOpen: action.value };
      break;
    case 'SET_TOOLBAR_VISIBLE':
      next = { ...state, toolbarVisible: action.value };
      break;
    case 'SET_KEEP_CONTROLS_VISIBLE':
      next = { ...state, keepControlsVisible: action.value };
      break;
    case 'SET_VIDEO_FIT':
      next = { ...state, videoFit: action.value };
      break;
    case 'SET_PICTURE_ALIGN':
      next = { ...state, pictureAlign: action.value };
      break;
    case 'SET_RAISE_ONLY_WITH_SUBTITLES':
      next = { ...state, raiseOnlyWithSubtitles: action.value };
      break;
    case 'SET_AUDIO':
      next = { ...state, audio: action.value };
      break;
    case 'SET_VOLUME_BOOST':
      next = { ...state, volumeBoost: action.value };
      break;
    case 'SET_AUTO_ENTER_THEATER':
      next = { ...state, autoEnterTheater: action.value };
      break;
    case 'SET_ACCENT':
      next = { ...state, accentColor: action.value };
      break;
    case 'SET_CAPTION_STYLE':
      next = { ...state, captionStyle: action.value };
      break;
    case 'SET_SHORTCUTS':
      next = { ...state, shortcuts: action.value };
      break;
  }
  return sameState(state, next) ? state : next;
}

export class PlayerUiStore {
  private state: PlayerUiState = defaultState();
  private readonly listeners = new Set<(state: PlayerUiState) => void>();

  getState(): PlayerUiState {
    return this.state;
  }

  dispatch(action: PlayerUiAction): PlayerUiState {
    const next = reduce(this.state, action);
    if (next === this.state) return this.state;
    this.state = next;
    for (const listener of this.listeners) listener(this.state);
    return this.state;
  }

  subscribe(listener: (state: PlayerUiState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
