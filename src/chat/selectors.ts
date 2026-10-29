/** Twitch's chat component. Theme attributes such as chat-theme-light are not required. */
export const TWITCH_CHAT_SECTION_SELECTOR = '[data-test-selector="chat-room-component-layout"]';

/**
 * Outer column the Twitch presentation hides unless it carries data-theater-chat.
 * Observed Oct 2026: one DIV is both .right-column and this target.
 */
export const TWITCH_CHAT_COLUMN_SELECTOR = '[data-a-target="right-column-chat-bar"], .right-column';

/**
 * Nodes parent CSS leaves at opacity 0 or visibility hidden unless marked.
 * #secondary uses data-theater-chat-ancestor; the chat column uses data-theater-chat.
 */
export const CHAT_REVEAL_SELECTOR = '#secondary, #chat, .right-column, [data-a-target="right-column-chat-bar"]';

/** Twitch mounts menus and emote pickers in these portals, outside the chat column. */
export const TWITCH_CHAT_PORTAL_SELECTOR = '.ReactModalPortal, .ReactModal__Overlay, .tw-dialog-layer';

/** Portals and in-page controls whose keyboard events belong to the service chat, not TME. */
export const TWITCH_CHAT_EVENT_SELECTOR = [
  TWITCH_CHAT_SECTION_SELECTOR,
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
  TWITCH_CHAT_PORTAL_SELECTOR
].join(',');
