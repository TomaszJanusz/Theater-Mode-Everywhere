import type { ChatKind, ChatSurface } from '../../chat/types';
import { readNativeChatVisibility } from '../../chat/visibility';
import type { ProviderChat } from '../provider-api';

import { CHAT_COLUMN_SELECTOR, CHAT_SECTION_SELECTOR, CHAT_TOGGLE_SELECTOR, parseTwitchChatLocation, twitchChatRoutes } from './chat-routes';
import { TWITCH_NAVIGATE_EVENT } from './navigation';

export function readTwitchChatVisibility(root: HTMLElement): boolean | null {
  const shell = root.matches('.chat-shell') ? root : root.querySelector('.chat-shell');
  if (shell?.classList.contains('chat-shell__collapsed')) return false;
  const native = readNativeChatVisibility(root);
  if (native !== null) return native;
  // An expanded column can be a zero-width wrapper around a translated shell, so the shell itself
  // is the evidence of an open chat. A collapsed one measures zero and stays unknown.
  return shell && shell.getBoundingClientRect().width > 0 ? true : null;
}

function detectSurface(document: Document, contentKey: string, kind: ChatKind): ChatSurface | null {
  // VOD replay uses video-chat rather than the live chat-room component.
  // Keep it scoped to Twitch's native column and to replay routes.
  const section = (kind === 'replay'
    ? document.querySelector('.right-column .video-chat, [data-a-target="right-column-chat-bar"] .video-chat')
    : null)
    ?? document.querySelector(CHAT_SECTION_SELECTOR)
    ?? document.querySelector('.right-column .chat-room, [data-a-target="right-column-chat-bar"] .chat-room');
  if (!(section instanceof HTMLElement)) return null;
  const column = section.closest(CHAT_COLUMN_SELECTOR);
  const root = column instanceof HTMLElement ? column : section;
  const revealAncestors: HTMLElement[] = [];
  for (let node = root.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    revealAncestors.push(node);
  }
  return { provider: 'twitch', contentKey, kind, root, contentRoot: section, revealAncestors, initiallyVisible: readTwitchChatVisibility(root) };
}

const enabled = (control: Element | null): control is HTMLElement =>
  control instanceof HTMLElement && !control.matches('[disabled], [aria-disabled="true"]');

const never = () => false;

export const twitchChat: ProviderChat = {
  ...twitchChatRoutes,
  detect(document, href) {
    const page = parseTwitchChatLocation(new URL(href));
    return page?.role === 'watch' && page.kind ? detectSurface(document, page.contentKey, page.kind) : null;
  },
  activation(document, href) {
    const page = parseTwitchChatLocation(new URL(href));
    if (page?.role !== 'watch') return null;
    const control = document.querySelector(CHAT_TOGGLE_SELECTOR);
    if (!enabled(control)) return null;
    // Width is ambiguous on Twitch: an expanded column can itself be zero-wide.
    // Its native expand action supplies the actual state instead.
    const collapsed = control.getAttribute('aria-expanded') === 'false'
      || /^expand chat$/i.test(control.getAttribute('aria-label')?.trim() ?? '')
      || Boolean(document.querySelector('.chat-shell__collapsed'))
      || (!document.querySelector('[data-a-target="right-column-chat-bar"]')
        && document.querySelector('.channel-root__right-column')?.getBoundingClientRect().width === 0);
    return collapsed ? { provider: 'twitch', contentKey: page.contentKey, control } : null;
  },
  activationSelector: CHAT_TOGGLE_SELECTOR,
  shellSelector: `${CHAT_SECTION_SELECTOR}, .chat-room, .chat-shell, ${CHAT_COLUMN_SELECTOR}`,
  navigationEvents: [TWITCH_NAVIGATE_EVENT],
  structure: {
    attributeChanged: never,
    frameSource: never,
    mayMount: never,
    transcript: node => node.matches('.chat-line__message, .chat-line')
  }
};
