import { registeredChat } from '../providers/runtime-registration';

import type { ChatSurface } from './types';
import { parseChatLocation } from './url';

/**
 * Finds the page's existing native chat for this host and route.
 * Chat-only documents, other hosts, and videos without a chat frame return null.
 * This never creates an iframe or moves a node.
 */
export function detectChatSurface(document: Document, href: string): ChatSurface | null {
  const page = parseChatLocation(href);
  if (!page || page.role !== 'watch') return null;
  return registeredChat()?.detect(document, href) ?? null;
}
