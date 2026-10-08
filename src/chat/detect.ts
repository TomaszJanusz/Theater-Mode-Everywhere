import {
  TWITCH_CHAT_COLUMN_SELECTOR,
  TWITCH_CHAT_SECTION_SELECTOR,
  YOUTUBE_CHAT_ROOT_SELECTOR
} from './selectors';
import type { ChatKind, ChatSurface } from './types';
import { parseChatLocation, readLiveChatSource } from './url';

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
  return detectYouTube(document, page.contentKey);
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
    initiallyVisible: initiallyVisible(root, 'twitch')
  };
}

function detectYouTube(document: Document, contentKey: string): ChatSurface | null {
  const stampedId = document.querySelector('ytd-watch-flexy[video-id]')?.getAttribute('video-id');
  // Channel /live pages can retain their URL after the watch component mounts.
  if (contentKey.startsWith('/')) {
    if (!stampedId) return null;
    contentKey = stampedId;
  } else if (stampedId && stampedId !== contentKey) {
    return null; // SPA navigation is still showing the previous watch component.
  }
  const selected = selectYouTubeFrame(document, contentKey);
  if (!selected) return null;
  const root = youtubeRoot(selected.iframe);
  if (!root) return null;
  return {
    provider: 'youtube',
    contentKey,
    kind: selected.kind,
    root,
    iframe: selected.iframe,
    revealAncestors: revealAncestors(root),
    initiallyVisible: initiallyVisible(root, 'youtube')
  };
}

function selectYouTubeFrame(document: Document, contentKey: string): { iframe: HTMLIFrameElement; kind: ChatKind } | null {
  const verified: Array<{ iframe: HTMLIFrameElement; kind: ChatKind }> = [];
  const structural: Array<{ iframe: HTMLIFrameElement; kind: ChatKind }> = [];
  for (const node of document.querySelectorAll('iframe')) {
    if (!(node instanceof HTMLIFrameElement)) continue;
    const rawSrc = node.getAttribute('src') || '';
    const declaredSource = readLiveChatSource(rawSrc);
    if (declaredSource?.videoId && declaredSource.videoId !== contentKey) continue;
    let navigatedSource = null;
    try {
      navigatedSource = readLiveChatSource(node.contentWindow?.location.href || '');
    } catch { /* Cross-origin chat stays opaque; its native shell supplies identity. */ }
    const source = navigatedSource ?? declaredSource;
    if (source?.videoId && source.videoId !== contentKey) continue;
    if (source?.videoId) {
      if (source.videoId === contentKey) verified.push({ iframe: node, kind: source.kind });
      continue;
    }
    const nativeFrame = node.id === 'chatframe' && node.closest('ytd-live-chat-frame');
    const watchId = node.closest('ytd-watch-flexy')?.getAttribute('video-id');
    // An unavailable replay can retain an empty iframe alongside the native
    // status message. That placeholder is not an available chat surface.
    if (!source && nativeFrame instanceof HTMLElement
      && nativeFrame.hasAttribute('hide-chat-frame')
      && nativeFrame.querySelector('ytd-message-renderer')?.textContent?.trim()) continue;
    // YouTube navigates chatframe programmatically, often without a src attribute.
    // Require the native component and its current stamped watch identity.
    if (nativeFrame && watchId === contentKey && (source || !rawSrc || rawSrc === 'about:blank')) {
      structural.push({ iframe: node, kind: source?.kind ?? 'live' });
    } else if (source?.kind === 'replay' && node.closest(YOUTUBE_CHAT_ROOT_SELECTOR)) {
      structural.push({ iframe: node, kind: source.kind });
    }
  }
  return verified[0] ?? structural[0] ?? null;
}

function youtubeRoot(iframe: HTMLIFrameElement): HTMLElement | null {
  const chat = iframe.closest('#chat');
  if (chat instanceof HTMLElement) return chat;
  const frame = iframe.closest('ytd-live-chat-frame');
  if (frame instanceof HTMLElement) return frame;
  const parent = iframe.parentElement;
  if (parent && parent !== iframe.ownerDocument.body && parent !== iframe.ownerDocument.documentElement) {
    return parent;
  }
  return iframe;
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

function initiallyVisible(root: HTMLElement, provider: 'twitch' | 'youtube'): boolean {
  if (root.hasAttribute('hidden') || root.getAttribute('aria-hidden') === 'true') return false;
  if (provider === 'youtube') {
    if (root.hasAttribute('collapsed')) return false;
    const chat = root.id === 'chat' ? root : root.closest('#chat');
    if (chat instanceof HTMLElement && chat.hasAttribute('collapsed')) return false;
  }
  const shell = root.matches('.chat-shell') ? root : root.querySelector('.chat-shell');
  if (shell?.classList.contains('chat-shell__collapsed')) return false;
  if (shell?.classList.contains('chat-shell__expanded') && shell.getBoundingClientRect().width > 0) return true;
  const parentWidth = root.parentElement?.getBoundingClientRect().width ?? 0;
  if (parentWidth > 0 && root.getBoundingClientRect().width === 0) return false;
  return true;
}
