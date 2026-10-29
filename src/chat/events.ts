import { isTwitchHost } from '../providers/hosts';
import { registeredChat } from '../providers/runtime-registration';

import { TWITCH_CHAT_EVENT_SELECTOR } from './selectors';
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
  const href = element.ownerDocument?.location?.href ?? '';
  let host = '';
  try {
    host = new URL(href).hostname;
  } catch {
    host = '';
  }
  if (isTwitchHost(host) && element.matches(TWITCH_CHAT_EVENT_SELECTOR)) return true;
  const chat = registeredChat();
  if (!chat || !(chat.matchesEventHost?.(host) ?? chat.matchesHost(host))) return false;
  return element.matches(chat.eventSelector) || Boolean(chat.matchesEvent?.(element));
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
