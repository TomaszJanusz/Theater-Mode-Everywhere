import type { ProviderChat } from '../providers/provider-api';
import { registeredChat } from '../providers/runtime-registration';
import { twitchChatRoutes } from '../providers/twitch/chat-routes';

export type ChatRoutes = Pick<ProviderChat, 'parseLocation' | 'matchesHost' | 'matchesEventHost' | 'eventSelector' | 'matchesEvent'>;

/**
 * Route and key recognition for the page's native chat, in both worlds. Twitch's stands in until Twitch loads per
 * host (TME-201), the one chat no provider entry registers yet; its own host checks keep it inert on other hosts.
 */
export const chatRoutes = (): ChatRoutes | undefined => registeredChat() ?? twitchChatRoutes;
