import { isTwitchHost, isYouTubeHost } from '../providers/hosts';
import { TWITCH_CHAT_EVENT_SELECTOR, YOUTUBE_CHAT_EVENT_SELECTOR } from './selectors';
import { isChatDocument, readLiveChatSource } from './url';

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
  if (!isYouTubeHost(host)) return false;
  if (element.matches(YOUTUBE_CHAT_EVENT_SELECTOR)) return true;
  if (element.ownerDocument.documentElement.hasAttribute('data-theater-chat-active') && element.matches('ytd-popup-container')) return true;
  if (element.tagName.startsWith('YT-LIVE-CHAT-')) return true;
  if (element instanceof HTMLIFrameElement) {
    return readLiveChatSource(element.getAttribute('src') || '') !== null;
  }
  return false;
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
