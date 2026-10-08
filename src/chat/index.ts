export type {
  ChatActivation,
  ChatDock,
  ChatKind,
  ChatPreference,
  ChatProvider,
  ChatState,
  ChatSurface,
  ChatTheme,
  ChatThemeStatus
} from './types';
export type { ChatControllerOptions } from './controller';
export { ChatController } from './controller';
export { detectChatSurface } from './detect';
export { detectChatActivation } from './activation';
export { isNativeChatEvent } from './events';
export { normalizeChatTheme } from './theme';
export { isChatDocument } from './url';
export {
  CHAT_DOCK_BREAKPOINT_PX,
  DEFAULT_CHAT_WIDTH_PX,
  MAX_CHAT_WIDTH_PX,
  MIN_CHAT_WIDTH_PX
} from './geometry';
