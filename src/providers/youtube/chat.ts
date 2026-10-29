import { readNativeChatVisibility } from '../../chat/adapters/visibility';
import type { ChatActivation, ChatKind, ChatSurface } from '../../chat/types';
import type { ParsedChatLocation } from '../../chat/url';
import { normalizeHost } from '../../platform/domain-policy';
import { isYouTubeHost } from '../hosts';
import type { ProviderChat } from '../provider-api';

/** YouTube watch-page chat shell. Parent CSS hides #chat unless this node is the marked root. */
const CHAT_ROOT = '#chat, ytd-live-chat-frame';
const CHAT_CARD = 'yt-video-metadata-carousel-view-model';

// The carousel contains other actions too. Require a recognized chat title;
// unknown labels fail closed instead of opening a different metadata panel.
const CHAT_TITLES = new Set([
  'live chat', 'chat replay', 'live chat replay', 'czat na żywo', 'powtórka czatu',
  'ponowne odtwarzanie czatu', 'ponowne odtwarzanie czatu na żywo',
  'chat en directo', 'repetición del chat', 'chat ao vivo', 'replay do chat',
  'chat en direct', 'rediffusion du chat', 'livechat', 'chat dal vivo',
  'чат', 'чат трансляции', 'повтор чата', 'чат наживо', 'повтор чату',
  'ライブチャット', 'チャットのリプレイ', '실시간 채팅', '채팅 다시보기',
  '实时聊天', '聊天重放', '聊天室', 'الدردشة المباشرة', 'إعادة تشغيل الدردشة'
]);

function watchHost(hostname: string): boolean {
  return isYouTubeHost(hostname) && normalizeHost(hostname) !== 'youtu.be';
}

function stripSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname || '/';
}

export interface LiveChatSource {
  kind: ChatKind;
  /** Present when the frame URL names a video. Absent continuation URLs are not verified. */
  videoId: string | null;
}

function videoId(value: string): boolean {
  return /^[A-Za-z0-9_-]{6,}$/.test(value);
}

/** Official live_chat / live_chat_replay frame URL, or null when the path is not one of those. */
export function readLiveChatSource(src: string): LiveChatSource | null {
  let url: URL;
  try { url = new URL(src.startsWith('//') ? `https:${src}` : src, 'https://www.youtube.com'); } catch { return null; }
  if (!watchHost(url.hostname)) return null;
  const path = stripSlash(url.pathname);
  let kind: ChatKind;
  if (path === '/live_chat') kind = 'live';
  else if (path === '/live_chat_replay') kind = 'replay';
  else return null;
  return { kind, videoId: url.searchParams.get('v') || null };
}

function parseLocation(url: URL): ParsedChatLocation | null {
  if (!watchHost(url.hostname)) return null;
  const path = stripSlash(url.pathname);
  if (path === '/live_chat' || path === '/live_chat_replay') {
    return { role: 'chat-document', provider: 'youtube', contentKey: url.searchParams.get('v') ?? '' };
  }
  if (path === '/watch') {
    const contentKey = url.searchParams.get('v') ?? '';
    if (!videoId(contentKey)) return null;
    return { role: 'watch', provider: 'youtube', contentKey, kind: null };
  }
  const pathVideo = /^\/(?:live|embed)\/([^/]+)$/.exec(path)?.[1];
  if (pathVideo && videoId(pathVideo)) return { role: 'watch', provider: 'youtube', contentKey: pathVideo, kind: null };
  if (/^\/(?:@[^/]+|(?:channel|c|user)\/[^/]+)\/live$/.test(path)) {
    return { role: 'watch', provider: 'youtube', contentKey: path, kind: 'live' };
  }
  return null;
}

function watchLocation(href: string): Extract<ParsedChatLocation, { role: 'watch' }> | null {
  let page: ParsedChatLocation | null;
  try { page = parseLocation(new URL(href)); } catch { return null; }
  return page?.role === 'watch' ? page : null;
}

function nativeVisibility(root: HTMLElement): boolean | null {
  if (root.hasAttribute('collapsed') || root.closest('#chat[collapsed]')
    || root.querySelector('ytd-live-chat-frame[collapsed]')) return false;
  return readNativeChatVisibility(root);
}

function detect(document: Document, href: string): ChatSurface | null {
  const page = watchLocation(href);
  if (!page) return null;
  let contentKey = page.contentKey;
  const stampedId = document.querySelector('ytd-watch-flexy[video-id]')?.getAttribute('video-id');
  // Channel /live pages can retain their URL after the watch component mounts.
  if (contentKey.startsWith('/')) {
    if (!stampedId) return null;
    contentKey = stampedId;
  } else if (stampedId && stampedId !== contentKey) {
    return null; // SPA navigation is still showing the previous watch component.
  }
  const selected = selectFrame(document, contentKey);
  if (!selected) return null;
  const root = chatRoot(selected.iframe);
  if (!root) return null;
  const revealAncestors: HTMLElement[] = [];
  for (let node = root.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    revealAncestors.push(node);
  }
  return { provider: 'youtube', contentKey, kind: selected.kind, root, iframe: selected.iframe, revealAncestors,
    initiallyVisible: nativeVisibility(root) };
}

function selectFrame(document: Document, contentKey: string): { iframe: HTMLIFrameElement; kind: ChatKind } | null {
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
    } else if (source?.kind === 'replay' && node.closest(CHAT_ROOT)) {
      structural.push({ iframe: node, kind: source.kind });
    }
  }
  return verified[0] ?? structural[0] ?? null;
}

function chatRoot(iframe: HTMLIFrameElement): HTMLElement | null {
  const chat = iframe.closest('#chat');
  if (chat instanceof HTMLElement) return chat;
  const frame = iframe.closest('ytd-live-chat-frame');
  if (frame instanceof HTMLElement) return frame;
  const parent = iframe.parentElement;
  if (parent && parent !== iframe.ownerDocument.body && parent !== iframe.ownerDocument.documentElement) return parent;
  return iframe;
}

function enabled(control: Element | null): control is HTMLElement {
  return control instanceof HTMLElement && !control.matches('[disabled], [aria-disabled="true"]');
}

function activation(document: Document, href: string, surface?: ChatSurface | null): ChatActivation | null {
  const page = watchLocation(href);
  if (!page) return null;
  const watch = document.querySelector('ytd-watch-flexy[video-id]');
  const stampedId = watch?.getAttribute('video-id');
  if (!watch || !stampedId || (!page.contentKey.startsWith('/') && stampedId !== page.contentKey)) return null;
  const shell = watch.querySelector('ytd-live-chat-frame');
  if (surface && !shell?.hasAttribute('collapsed')) return null;
  for (const card of watch.querySelectorAll(CHAT_CARD)) {
    const label = card.getAttribute('aria-label')?.trim().toLowerCase();
    if (!label || !CHAT_TITLES.has(label) || !enabled(card)) continue;
    const button = card.querySelector('button');
    if (!enabled(button)) continue; // Disabled Open panel is normal while chat is open.
    const control = card.getAttribute('role') === 'button' ? card : button;
    return { provider: 'youtube', contentKey: stampedId, control };
  }
  const control = shell?.querySelector('#show-hide-button:not([hidden]) button, #show-hide-button:not([hidden]) tp-yt-paper-button') ?? null;
  return enabled(control) ? { provider: 'youtube', contentKey: stampedId, control } : null;
}

/** Also registered in MAIN, where the entry shortcut capture must leave chat keys alone; the theme stays isolated. */
export const youtubeChat: ProviderChat = {
  parseLocation,
  matchesHost: watchHost,
  detect,
  activation,
  eventSelector: '#chat, ytd-live-chat-frame, iframe#chatframe',
  matchesEvent(element) {
    if (element.ownerDocument.documentElement.hasAttribute('data-theater-chat-active') && element.matches('ytd-popup-container')) return true;
    if (element.tagName.startsWith('YT-LIVE-CHAT-')) return true;
    return element instanceof HTMLIFrameElement && readLiveChatSource(element.getAttribute('src') || '') !== null;
  },
  activationSelector: `${CHAT_CARD}, #show-hide-button`,
  shellSelector: '#chat, #secondary, ytd-live-chat-frame',
  navigationEvents: ['yt-navigate-finish', 'yt-page-data-updated'],
  structure: {
    attributeChanged: (target, name) => target.matches('ytd-live-chat-frame')
      || Boolean(target.closest(`${CHAT_CARD}, #show-hide-button`))
      || (target.matches('ytd-watch-flexy') && name === 'video-id'),
    frameSource: src => readLiveChatSource(src) !== null,
    mayMount(node) {
      const tag = node.tagName;
      if (tag === 'YTD-LIVE-CHAT-FRAME' || tag === 'YTD-WATCH-FLEXY' || tag === 'YTD-APP') return true;
      if (tag === 'IFRAME') return node.id === 'chatframe' || readLiveChatSource(node.getAttribute('src') || '') !== null;
      return node.id === 'columns' || node.id === 'page-manager';
    },
    transcript: node => node.tagName.startsWith('YT-LIVE-CHAT-')
  }
};
