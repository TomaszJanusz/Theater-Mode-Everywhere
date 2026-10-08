import type { ChatActivation, ChatSurface } from './types';
import { parseChatLocation } from './url';

export const TWITCH_CHAT_TOGGLE_SELECTOR = '[data-a-target="right-column__toggle-collapse-btn"]';
export const YOUTUBE_CHAT_CARD_SELECTOR = 'yt-video-metadata-carousel-view-model';

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

  const watch = document.querySelector('ytd-watch-flexy[video-id]');
  const stampedId = watch?.getAttribute('video-id');
  if (!watch || !stampedId || (!page.contentKey.startsWith('/') && stampedId !== page.contentKey)) return null;
  const shell = watch.querySelector('ytd-live-chat-frame');
  if (surface && !shell?.hasAttribute('collapsed')) return null;

  for (const card of watch.querySelectorAll(YOUTUBE_CHAT_CARD_SELECTOR)) {
    const label = card.getAttribute('aria-label')?.trim().toLowerCase();
    if (!label || !CHAT_TITLES.has(label) || !enabled(card)) continue;
    const button = card.querySelector('button');
    if (!enabled(button)) continue; // Disabled Open panel is normal while chat is open.
    const control = card.getAttribute('role') === 'button' ? card : button;
    return { provider: page.provider, contentKey: stampedId, control };
  }
  const control = shell?.querySelector('#show-hide-button:not([hidden]) button, #show-hide-button:not([hidden]) tp-yt-paper-button') ?? null;
  return enabled(control) ? { provider: page.provider, contentKey: stampedId, control } : null;
}
