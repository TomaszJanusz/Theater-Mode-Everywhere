import type { ParsedChatLocation } from '../../chat/url';
import { normalizeHost } from '../../platform/domain-policy';
import type { ProviderChat } from '../provider-api';

import { isTwitchHost } from './hosts';

const RESERVED = new Set([
  'activate',
  'admin',
  'annual-recap',
  'broadcast',
  'browse',
  'clips',
  'creatorcamp',
  'dashboard',
  'directory',
  'downloads',
  'drops',
  'embed',
  'following',
  'friends',
  'inventory',
  'jobs',
  'login',
  'messages',
  'moderation',
  'moderator',
  'p',
  'payments',
  'popout',
  'prime',
  'privacy',
  'products',
  'search',
  'security',
  'settings',
  'signup',
  'store',
  'subs',
  'subscriptions',
  'team',
  'turbo',
  'user',
  'videos',
  'wallet'
]);

/** Twitch's chat component. Theme attributes such as chat-theme-light are not required. */
export const CHAT_SECTION_SELECTOR = '[data-test-selector="chat-room-component-layout"]';

/**
 * Outer column the Twitch presentation hides unless it carries data-theater-chat.
 * Observed Oct 2026: one DIV is both .right-column and this target.
 */
export const CHAT_COLUMN_SELECTOR = '[data-a-target="right-column-chat-bar"], .right-column';

export const CHAT_TOGGLE_SELECTOR = '[data-a-target="right-column__toggle-collapse-btn"]';

/** Twitch mounts menus and emote pickers in these portals, outside the chat column. */
export const CHAT_PORTAL_SELECTOR = '.ReactModalPortal, .ReactModal__Overlay, .tw-dialog-layer';

/** Portals and in-page controls whose keyboard events belong to the service chat, not TME. */
export const CHAT_EVENT_SELECTOR = [
  CHAT_SECTION_SELECTOR,
  '[data-a-target="right-column-chat-bar"]',
  '.chat-room',
  '.chat-shell',
  '.stream-chat',
  '.chat-input',
  '.chat-wysiwyg-input__box',
  '[data-a-target="emote-picker"]',
  '[data-a-target="chat-input"]',
  '[data-a-target="chat-send-button"]',
  '[data-a-target="chat-settings"]',
  '[data-a-target="viewer-card"]',
  '[data-test-selector="emote-picker"]',
  CHAT_PORTAL_SELECTOR
].join(',');

/** Watch-page chat hosts, including mobile; player, clips and other subdomains stay out. */
function isWatchHost(hostname: string): boolean {
  if (!isTwitchHost(hostname)) return false;
  const host = normalizeHost(hostname);
  return host === 'twitch.tv' || host === 'm.twitch.tv';
}

const isLogin = (value: string) => /^\w{1,25}$/.test(value);
const isVideoId = (value: string) => /^\d{1,20}$/.test(value);

export function parseTwitchChatLocation(url: URL): ParsedChatLocation | null {
  if (!isWatchHost(url.hostname)) return null;
  const pathname = url.pathname.length > 1 && url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname || '/';
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 3 && (parts[0] === 'popout' || parts[0] === 'embed') && parts[2] === 'chat' && isLogin(parts[1] ?? '')) {
    return { role: 'chat-document', provider: 'twitch', contentKey: (parts[1] ?? '').toLowerCase() };
  }
  if (parts.length === 2 && parts[0] === 'videos' && isVideoId(parts[1] ?? '')) {
    return { role: 'watch', provider: 'twitch', contentKey: parts[1] ?? '', kind: 'replay' };
  }
  if (parts.length === 1 && parts[0] && isLogin(parts[0]) && !RESERVED.has(parts[0].toLowerCase())) {
    return { role: 'watch', provider: 'twitch', contentKey: parts[0].toLowerCase(), kind: 'live' };
  }
  return null;
}

/** What both worlds need to recognize Twitch's chat routes and keys; detection and activation stay with `twitchChat`. */
export const twitchChatRoutes = {
  parseLocation: parseTwitchChatLocation,
  matchesHost: isWatchHost,
  // Chat elsewhere on Twitch (the creator dashboard, for one) keeps its keys too.
  matchesEventHost: (hostname: string) => isTwitchHost(hostname),
  eventSelector: CHAT_EVENT_SELECTOR
} satisfies Partial<ProviderChat>;
