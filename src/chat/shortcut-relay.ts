import { matchesShortcut, withShortcutDefaults } from '../ui/shortcuts';

const RELAY_CHANNEL = 'theater-everywhere-chat-shortcut';

/** Chat show/hide request relayed from the chat document to the page that hosts it. */
export function isChatShortcutMessage(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as { channel?: unknown }).channel === RELAY_CHANNEL
    && (data as { action?: unknown }).action === 'toggle-chat';
}

function editableFocused(doc: Document): boolean {
  const active = doc.activeElement as HTMLElement | null;
  return Boolean(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT'
    || active.isContentEditable || active.getAttribute('role') === 'textbox'));
}

/**
 * A chat iframe owns the keyboard while it has focus, so the page never sees the
 * chat shortcut. The chat document forwards only that one binding, and only
 * outside text entry, to its embedding page, which validates the sender.
 */
export function installChatShortcutRelay(): void {
  if (typeof chrome === 'undefined' || !chrome.storage?.sync || window === window.top) return;
  let toggleChat = withShortcutDefaults(undefined).toggleChat;
  const load = (saved: unknown) => {
    toggleChat = withShortcutDefaults(saved && typeof saved === 'object' ? saved as Record<string, unknown> : undefined).toggleChat;
  };
  void chrome.storage.sync.get('shortcuts').then(data => load(data.shortcuts), () => undefined);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.shortcuts) load(changes.shortcuts.newValue);
  });
  window.addEventListener('keydown', event => {
    if (event.isComposing || event.repeat || !matchesShortcut(event, toggleChat) || editableFocused(document)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.parent.postMessage({ channel: RELAY_CHANNEL, action: 'toggle-chat' }, document.location.origin);
  }, true);
}
