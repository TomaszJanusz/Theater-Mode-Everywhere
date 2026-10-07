import type { ChatDock } from './types';

/** Right dock at this viewport width and above; bottom dock below it. */
export const CHAT_DOCK_BREAKPOINT_PX = 900;

export const DEFAULT_CHAT_WIDTH_PX = 360;
export const MIN_CHAT_WIDTH_PX = 280;
export const MAX_CHAT_WIDTH_PX = 600;

export const DEFAULT_BOTTOM_CHAT_HEIGHT_PX = 360;
export const MIN_BOTTOM_CHAT_HEIGHT_PX = 280;
export const MIN_VIDEO_HEIGHT_PX = 220;

export type ChatLayoutMode = 'absent' | 'hidden' | 'shown';

export interface ChatLayout {
  dock: ChatDock;
  width: number;
  videoWidth: string;
  videoHeight: string;
  chatWidth: string;
  chatHeight: string;
  chatLeft: string;
  chatTop: string;
}

export const CHAT_GEOMETRY_PROPERTIES = [
  '--theater-video-width',
  '--theater-video-height',
  '--theater-chat-width',
  '--theater-chat-height',
  '--theater-chat-left',
  '--theater-chat-top'
] as const;

export type ChatGeometryProperty = typeof CHAT_GEOMETRY_PROPERTIES[number];

export function clampChatWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_CHAT_WIDTH_PX;
  return Math.min(MAX_CHAT_WIDTH_PX, Math.max(MIN_CHAT_WIDTH_PX, Math.round(width)));
}

/**
 * Bottom panel height. Leaves the picture at least MIN_VIDEO_HEIGHT_PX when the
 * viewport is tall enough; shorter viewports keep a smaller chat instead of a negative picture.
 */
export function bottomChatHeight(viewportHeight: number): number {
  if (!(viewportHeight > 0)) return DEFAULT_BOTTOM_CHAT_HEIGHT_PX;
  const available = Math.max(0, viewportHeight - MIN_VIDEO_HEIGHT_PX);
  const target = Math.min(
    DEFAULT_BOTTOM_CHAT_HEIGHT_PX,
    Math.max(MIN_BOTTOM_CHAT_HEIGHT_PX, Math.floor(viewportHeight * 0.45))
  );
  if (available >= MIN_BOTTOM_CHAT_HEIGHT_PX) return Math.min(target, available);
  return Math.max(0, Math.min(target, Math.floor(viewportHeight * 0.4)));
}

export function chatGeometry(input: {
  viewportWidth: number;
  viewportHeight: number;
  preferredWidth: number;
  mode: ChatLayoutMode;
}): ChatLayout {
  const width = clampChatWidth(input.preferredWidth);
  const viewportWidth = input.viewportWidth;
  const viewportHeight = input.viewportHeight;
  if (!(viewportWidth > 0) || !(viewportHeight > 0)) {
    return unknownViewport(width, input.mode);
  }

  const dock: ChatDock = viewportWidth >= CHAT_DOCK_BREAKPOINT_PX ? 'right' : 'bottom';
  if (dock === 'right') {
    return {
      dock,
      width,
      videoWidth: px(input.mode === 'shown' ? viewportWidth - width : viewportWidth),
      videoHeight: px(viewportHeight),
      chatWidth: input.mode === 'absent' ? '0px' : px(width),
      chatHeight: input.mode === 'absent' ? '0px' : px(viewportHeight),
      chatLeft: input.mode === 'absent' ? '0px' : px(viewportWidth - width),
      chatTop: '0px'
    };
  }

  const chatHeight = bottomChatHeight(viewportHeight);
  const shownPicture = Math.max(0, viewportHeight - chatHeight);
  return {
    dock,
    width,
    videoWidth: px(viewportWidth),
    videoHeight: px(input.mode === 'shown' ? shownPicture : viewportHeight),
    chatWidth: input.mode === 'absent' ? '0px' : px(viewportWidth),
    chatHeight: input.mode === 'absent' ? '0px' : px(chatHeight),
    chatLeft: '0px',
    chatTop: input.mode === 'absent' ? '0px' : px(shownPicture)
  };
}

function unknownViewport(width: number, mode: ChatLayoutMode): ChatLayout {
  if (mode === 'absent') {
    return {
      dock: 'right',
      width,
      videoWidth: '100vw',
      videoHeight: '100vh',
      chatWidth: '0px',
      chatHeight: '0px',
      chatLeft: '0px',
      chatTop: '0px'
    };
  }
  return {
    dock: 'right',
    width,
    videoWidth: mode === 'shown' ? `calc(100vw - ${width}px)` : '100vw',
    videoHeight: '100vh',
    chatWidth: `${width}px`,
    chatHeight: '100vh',
    chatLeft: `calc(100vw - ${width}px)`,
    chatTop: '0px'
  };
}

function px(value: number): string {
  return `${Math.round(value)}px`;
}
