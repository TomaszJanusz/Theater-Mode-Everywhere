import { resolveCaptionStyle, type CaptionStyle } from '../media-features/caption-style';
import { DEFAULT_ACCENT_COLOR, DEFAULT_VIDEO_FIT, type AccentColorPreset, type VideoFitMode } from './appearance';
import { defaultShortcuts, type Shortcuts } from './shortcuts';

export type PlayerUiState = {
  theaterActive: boolean;
  helpOpen: boolean;
  toolbarVisible: boolean;
  videoFit: VideoFitMode;
  accentColor: AccentColorPreset;
  captionStyle: CaptionStyle;
  shortcuts: Shortcuts;
};

export type PlayerUiAction =
  | { type: 'HYDRATE'; value: Partial<PlayerUiState> }
  | { type: 'SET_THEATER_ACTIVE'; value: boolean }
  | { type: 'SET_HELP_OPEN'; value: boolean }
  | { type: 'SET_TOOLBAR_VISIBLE'; value: boolean }
  | { type: 'SET_VIDEO_FIT'; value: VideoFitMode }
  | { type: 'SET_ACCENT'; value: AccentColorPreset }
  | { type: 'SET_CAPTION_STYLE'; value: CaptionStyle }
  | { type: 'SET_SHORTCUTS'; value: Shortcuts };

const defaultState = (): PlayerUiState => ({
  theaterActive: false,
  helpOpen: false,
  toolbarVisible: false,
  videoFit: DEFAULT_VIDEO_FIT,
  accentColor: DEFAULT_ACCENT_COLOR,
  captionStyle: resolveCaptionStyle(null),
  shortcuts: { ...defaultShortcuts }
});

function sameState(left: PlayerUiState, right: PlayerUiState): boolean {
  return (
    left.theaterActive === right.theaterActive
    && left.helpOpen === right.helpOpen
    && left.toolbarVisible === right.toolbarVisible
    && left.videoFit === right.videoFit
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
    case 'SET_VIDEO_FIT':
      next = { ...state, videoFit: action.value };
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
