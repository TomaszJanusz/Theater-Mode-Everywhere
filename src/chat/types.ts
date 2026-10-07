export type ChatProvider = 'twitch' | 'youtube';

export type ChatKind = 'live' | 'replay';

export type ChatDock = 'right' | 'bottom';

/** Per-provider choice. Messages and account data are never stored. */
export interface ChatPreference {
  visible: boolean;
  width: number;
}

/**
 * A native chat that already belongs to the page.
 * `root` stays in the service's light-DOM tree; TME never reparents it.
 */
export interface ChatSurface {
  provider: ChatProvider;
  contentKey: string;
  kind: ChatKind;
  root: HTMLElement;
  /** Native component inside a persistent outer column, used to detect replacement. */
  contentRoot?: HTMLElement;
  iframe?: HTMLIFrameElement;
  /** Ancestors whose own visibility or opacity would otherwise keep the chat hidden. */
  revealAncestors: HTMLElement[];
  /** Visibility observed at detection, before a stored or in-session choice is applied. */
  initiallyVisible: boolean;
}

export interface ChatState {
  surface: ChatSurface | null;
  available: boolean;
  visible: boolean;
  /** Preferred right-dock width in pixels, clamped to the shared slider range. */
  width: number;
  dock: ChatDock;
}
