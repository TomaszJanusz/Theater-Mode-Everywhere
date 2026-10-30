import type { ProviderChat } from '../providers/provider-api';
import { registeredChat } from '../providers/runtime-registration';
import { twitchChat } from '../providers/twitch/chat';

/** The page's native chat hook in the isolated world, with Twitch's standing in as for `chatRoutes` (TME-201). */
export const nativeChat = (): ProviderChat | undefined => registeredChat() ?? twitchChat;
