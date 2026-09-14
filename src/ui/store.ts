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

function reduce(state: PlayerUiState, action: PlayerUiAction): PlayerUiState {
  switch (action.type) {
    case 'HYDRATE':
      return { ...state, ...action.value };
    case 'SET_THEATER_ACTIVE':
      return { ...state, theaterActive: action.value, helpOpen: action.value ? state.helpOpen : false };
    case 'SET_HELP_OPEN':
      return { ...state, helpOpen: action.value };
    case 'SET_TOOLBAR_VISIBLE':
      return { ...state, toolbarVisible: action.value };
    case 'SET_VIDEO_FIT':
      return { ...state, videoFit: action.value };
    case 'SET_ACCENT':
      return { ...state, accentColor: action.value };
    case 'SET_CAPTION_STYLE':
      return { ...state, captionStyle: action.value };
    case 'SET_SHORTCUTS':
      return { ...state, shortcuts: action.value };
  }
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
