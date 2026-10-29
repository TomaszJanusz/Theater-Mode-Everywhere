import { registeredChat } from '../providers/runtime-registration';

import { readTwitchChatVisibility } from './adapters/twitch';
import { TWITCH_CHAT_COLUMN_SELECTOR, TWITCH_CHAT_SECTION_SELECTOR } from './selectors';
import type { ChatKind, ChatSurface } from './types';
import { parseChatLocation } from './url';

/**
 * Finds the page's existing native chat for this host and route.
 * Chat-only documents, other hosts, and videos without a chat frame return null.
 * This never creates an iframe or moves a node.
 */
export function detectChatSurface(document: Document, href: string): ChatSurface | null {
  const page = parseChatLocation(href);
  if (!page || page.role !== 'watch') return null;
  if (page.provider === 'twitch') {
    if (!page.kind) return null;
    return detectTwitch(document, page.contentKey, page.kind);
  }
  return registeredChat()?.detect(document, href) ?? null;
}

function detectTwitch(document: Document, contentKey: string, kind: ChatKind): ChatSurface | null {
  // VOD replay uses video-chat rather than the live chat-room component.
  // Keep it scoped to Twitch's native column and to replay routes.
  const section = (kind === 'replay'
    ? document.querySelector('.right-column .video-chat, [data-a-target="right-column-chat-bar"] .video-chat')
    : null)
    ?? document.querySelector(TWITCH_CHAT_SECTION_SELECTOR)
    ?? document.querySelector('.right-column .chat-room, [data-a-target="right-column-chat-bar"] .chat-room');
  if (!(section instanceof HTMLElement)) return null;
  const root = twitchRoot(section);
  return {
    provider: 'twitch',
    contentKey,
    kind,
    root,
    contentRoot: section,
    revealAncestors: revealAncestors(root),
    initiallyVisible: readTwitchChatVisibility(root)
  };
}

function twitchRoot(section: HTMLElement): HTMLElement {
  const column = section.closest(TWITCH_CHAT_COLUMN_SELECTOR);
  return column instanceof HTMLElement ? column : section;
}

function revealAncestors(root: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = [];
  let node = root.parentElement;
  const stop = root.ownerDocument.body;
  while (node && node !== stop && node !== root.ownerDocument.documentElement) {
    found.push(node);
    node = node.parentElement;
  }
  return found;
}
