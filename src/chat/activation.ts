import { registeredChat } from '../providers/runtime-registration';

import type { ChatActivation, ChatSurface } from './types';
import { parseChatLocation } from './url';


export const TWITCH_CHAT_TOGGLE_SELECTOR = '[data-a-target="right-column__toggle-collapse-btn"]';

function enabled(control: Element | null): control is HTMLElement {
  return control instanceof HTMLElement && !control.matches('[disabled], [aria-disabled="true"]');
}

/** Detect activation separately from the actual chat; never manufacture a surface. */
export function detectChatActivation(document: Document, href: string, surface: ChatSurface | null): ChatActivation | null {
  const page = parseChatLocation(href);
  if (!page || page.role !== 'watch') return null;
  if (page.provider === 'twitch') {
    const control = document.querySelector(TWITCH_CHAT_TOGGLE_SELECTOR);
    if (!enabled(control)) return null;
    // Width is ambiguous on Twitch: an expanded column can itself be zero-wide.
    // Its native expand action supplies the actual state instead.
    const collapsed = control.getAttribute('aria-expanded') === 'false'
      || /^expand chat$/i.test(control.getAttribute('aria-label')?.trim() ?? '')
      || Boolean(document.querySelector('.chat-shell__collapsed'))
      || (!document.querySelector('[data-a-target="right-column-chat-bar"]')
        && document.querySelector('.channel-root__right-column')?.getBoundingClientRect().width === 0);
    return collapsed ? { provider: page.provider, contentKey: page.contentKey, control } : null;
  }

  return registeredChat()?.activation(document, href, surface) ?? null;
}
