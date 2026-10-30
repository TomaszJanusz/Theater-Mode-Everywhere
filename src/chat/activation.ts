import { nativeChat } from './registered';
import type { ChatActivation, ChatSurface } from './types';
import { parseChatLocation } from './url';

/** Detect activation separately from the actual chat; never manufacture a surface. */
export function detectChatActivation(document: Document, href: string, surface: ChatSurface | null): ChatActivation | null {
  const page = parseChatLocation(href);
  if (!page || page.role !== 'watch') return null;
  return nativeChat()?.activation(document, href, surface) ?? null;
}
