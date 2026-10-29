import { THEATER_STAGE_BACKGROUND } from '../../chat/adapters/stage';
import type { ChatThemeAdapter, ForcedTheme } from '../../chat/adapters/types';
import { OwnedDom } from '../../chat/owned-dom';
import type { ChatSurface } from '../../chat/types';
import type { ProviderChat } from '../provider-api';

/** Follows the attribute on the column, so a host rewrite of its inline style cannot drop it. SOOP's border. */
const CANVAS = `#webplayer #chatting_area[data-theater-chat][dark="true"]{background-color:${THEATER_STAGE_BACKGROUND};border-color:rgba(117,123,138,.3)}`;

/**
 * SOOP's dark palette is its site dark mode, `[dark=true]` on the page root. Nearly all of its chat rules
 * are written `[dark=true] .chatbox …` without anchoring that root, so the same attribute on the chat
 * column darkens the chat alone, with SOOP's own colors for messages, links, emoticons and banners. The
 * column's background is anchored above the player, so its canvas is painted here. A page already in
 * SOOP's dark mode matches those rules from the root, so the chat cannot be made light from inside it.
 */
export class SoopChatThemeAdapter implements ChatThemeAdapter {
  private readonly owned = new OwnedDom();
  private canvas: HTMLStyleElement | null = null;

  constructor(private readonly surface: ChatSurface) {}

  apply(theme: ForcedTheme): boolean {
    const root = this.surface.root;
    if (theme === 'light') {
      this.restore();
      return root.isConnected && !siteDark(root.ownerDocument);
    }
    if (!root.isConnected) {
      this.restore();
      return false;
    }
    const head = root.ownerDocument.head;
    if (!head) return false;
    this.owned.setAttribute(root, 'dark', 'true');
    if (!this.canvas?.isConnected) {
      this.canvas = root.ownerDocument.createElement('style');
      this.canvas.setAttribute('data-theater-chat-canvas', 'soop');
      this.canvas.textContent = CANVAS;
      head.append(this.canvas);
    }
    return true;
  }

  restore(): void {
    this.canvas?.remove();
    this.canvas = null;
    this.owned.restoreAll();
  }
}

function siteDark(document: Document): boolean {
  return document.documentElement.getAttribute('dark') === 'true' || Boolean(document.body?.classList.contains('thema_dark'));
}

/** The chat shares the page document. */
export const soopChatTheme: NonNullable<ProviderChat['theme']> = {
  document: surface => surface.root.ownerDocument,
  adapter: (_document, surface) => new SoopChatThemeAdapter(surface)
};
