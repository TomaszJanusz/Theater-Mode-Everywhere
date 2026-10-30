import { registeredChat } from '../providers/runtime-registration';

import { isChatDocument } from './url';

/**
 * True when a keyboard or pointer event belongs to native chat, including
 * service portals that render outside the column. Document shells never match.
 */
export function isNativeChatEvent(event: Event): boolean {
  const document = documentOf(event);
  if (document && isChatDocument(document.location?.href ?? '')) return true;
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (const node of path) {
    if (!(node instanceof Element)) continue;
    if (isDocumentShell(node)) continue;
    if (node.hasAttribute('data-theater-chat')) return true;
    if (matchesServiceChat(node)) return true;
  }
  return false;
}

function matchesServiceChat(element: Element): boolean {
  let host = '';
  try {
    // A document without a browsing context has no location; its elements belong to no host.
    host = new URL((element.ownerDocument.location as Location).href).hostname;
  } catch {
    // No host: only registered chats that accept an empty host could match.
  }
  const chat = registeredChat();
  if (!chat || !(chat.matchesEventHost ? chat.matchesEventHost(host) : chat.matchesHost(host))) return false;
  return element.matches(chat.eventSelector) || (chat.matchesEvent ? chat.matchesEvent(element) : false);
}

function documentOf(event: Event): Document | null {
  const target = event.target;
  if (target instanceof Document) return target;
  if (target instanceof Node) return target.ownerDocument;
  const view = (event as UIEvent).view;
  return view?.document ?? null;
}

function isDocumentShell(element: Element): boolean {
  return element.tagName === 'BODY' || element.tagName === 'HTML';
}
