import { isTwitchHost, isYouTubeHost } from '../providers/hosts';
import { normalizeHost } from '../platform/domain-policy';
import type { ChatKind, ChatProvider } from './types';

const TWITCH_RESERVED = new Set([
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

export type ParsedChatLocation =
  | { role: 'watch'; provider: ChatProvider; contentKey: string; kind: ChatKind | null }
  | { role: 'chat-document'; provider: ChatProvider; contentKey: string };

export interface LiveChatSource {
  kind: ChatKind;
  /** Present when the frame URL names a video. Absent continuation URLs are not verified. */
  videoId: string | null;
}

/**
 * True for provider documents that are only a chat, popout, or replay.
 * Those documents are not watch pages with a side panel.
 */
export function isChatDocument(href: string): boolean {
  return parseChatLocation(href)?.role === 'chat-document';
}

export function parseChatLocation(href: string): ParsedChatLocation | null {
  const url = parseUrl(href);
  if (!url) return null;
  return parseYouTubeLocation(url) ?? parseTwitchLocation(url);
}

/** Official live_chat / live_chat_replay frame URL, or null when the path is not one of those. */
export function readLiveChatSource(src: string): LiveChatSource | null {
  const url = parseUrl(src.startsWith('//') ? `https:${src}` : src, 'https://www.youtube.com');
  if (!url || !isYouTubeWatchHost(url.hostname)) return null;
  const path = stripSlash(url.pathname);
  const kind: ChatKind | null = path === '/live_chat'
    ? 'live'
    : path === '/live_chat_replay'
      ? 'replay'
      : null;
  if (!kind) return null;
  const videoId = url.searchParams.get('v');
  return { kind, videoId: videoId || null };
}

export function watchIdentity(href: string): string {
  const page = parseChatLocation(href);
  if (!page || page.role !== 'watch') return '';
  return `${page.provider}:${page.contentKey}`;
}

function parseYouTubeLocation(url: URL): ParsedChatLocation | null {
  if (!isYouTubeWatchHost(url.hostname)) return null;
  const path = stripSlash(url.pathname);
  if (path === '/live_chat' || path === '/live_chat_replay') {
    return { role: 'chat-document', provider: 'youtube', contentKey: url.searchParams.get('v') ?? '' };
  }
  if (path === '/watch') {
    const contentKey = url.searchParams.get('v') ?? '';
    if (!isYouTubeVideoId(contentKey)) return null;
    return { role: 'watch', provider: 'youtube', contentKey, kind: null };
  }
  const live = /^\/live\/([^/]+)$/.exec(path);
  if (live?.[1] && isYouTubeVideoId(live[1])) {
    return { role: 'watch', provider: 'youtube', contentKey: live[1], kind: null };
  }
  if (/^\/(?:@[^/]+|(?:channel|c|user)\/[^/]+)\/live$/.test(path)) {
    return { role: 'watch', provider: 'youtube', contentKey: path, kind: 'live' };
  }
  const embed = /^\/embed\/([^/]+)$/.exec(path);
  if (embed?.[1] && isYouTubeVideoId(embed[1])) {
    return { role: 'watch', provider: 'youtube', contentKey: embed[1], kind: null };
  }
  return null;
}

function parseTwitchLocation(url: URL): ParsedChatLocation | null {
  if (!isTwitchWatchHost(url.hostname)) return null;
  const parts = stripSlash(url.pathname).split('/').filter(Boolean);
  if (parts.length === 3 && (parts[0] === 'popout' || parts[0] === 'embed') && parts[2] === 'chat' && isTwitchLogin(parts[1] ?? '')) {
    return { role: 'chat-document', provider: 'twitch', contentKey: (parts[1] ?? '').toLowerCase() };
  }
  if (parts.length === 2 && parts[0] === 'videos' && isTwitchVideoId(parts[1] ?? '')) {
    return { role: 'watch', provider: 'twitch', contentKey: parts[1] ?? '', kind: 'replay' };
  }
  if (parts.length === 1 && parts[0] && isTwitchLogin(parts[0]) && !TWITCH_RESERVED.has(parts[0].toLowerCase())) {
    return { role: 'watch', provider: 'twitch', contentKey: parts[0].toLowerCase(), kind: 'live' };
  }
  return null;
}

function isTwitchWatchHost(hostname: string): boolean {
  if (!isTwitchHost(hostname)) return false;
  const host = normalizeHost(hostname);
  return host === 'twitch.tv' || host === 'm.twitch.tv';
}

function isYouTubeWatchHost(hostname: string): boolean {
  if (!isYouTubeHost(hostname)) return false;
  return normalizeHost(hostname) !== 'youtu.be';
}

function isTwitchLogin(value: string): boolean {
  return /^[A-Za-z0-9_]{1,25}$/.test(value);
}

function isTwitchVideoId(value: string): boolean {
  return /^[0-9]{1,20}$/.test(value);
}

function isYouTubeVideoId(value: string): boolean {
  return /^[A-Za-z0-9_-]{6,}$/.test(value);
}

function stripSlash(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname || '/';
}

function parseUrl(href: string, base?: string): URL | null {
  try {
    return new URL(href, base);
  } catch {
    return null;
  }
}
