import type { MediaProviderId } from '../media-features/provider-flags';

import { chatRoutes } from './routes';
import type { ChatKind } from './types';

export type ParsedChatLocation =
  | { role: 'watch'; provider: MediaProviderId; contentKey: string; kind: ChatKind | null }
  | { role: 'chat-document'; provider: MediaProviderId; contentKey: string };

/**
 * True for provider documents that are only a chat, popout, or replay.
 * Those documents are not watch pages with a side panel.
 */
export function isChatDocument(href: string): boolean {
  return parseChatLocation(href)?.role === 'chat-document';
}

export function parseChatLocation(href: string): ParsedChatLocation | null {
  const url = parseUrl(href);
  if (!url) return null;
  return chatRoutes()?.parseLocation(url) ?? null;
}

export function watchIdentity(href: string): string {
  const page = parseChatLocation(href);
  if (!page || page.role !== 'watch') return '';
  return `${page.provider}:${page.contentKey}`;
}

/**
 * Hosts that can show a watch-page chat, including mobile and embed hosts.
 * Player, clips, and other non-watch subdomains stay out; route checks are separate.
 */
export function isNativeChatHost(href: string): boolean {
  const url = parseUrl(href);
  if (!url) return false;
  return chatRoutes()?.matchesHost(url.hostname) ?? false;
}

function parseUrl(href: string): URL | null {
  try {
    return new URL(href);
  } catch {
    return null;
  }
}
