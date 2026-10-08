import { DisposableScope } from '../core/disposable-scope';
import { detectChatSurface } from './detect';
import {
  CHAT_GEOMETRY_PROPERTIES,
  type ChatLayout,
  chatGeometry,
  clampChatWidth,
  DEFAULT_CHAT_WIDTH_PX
} from './geometry';
import { OwnedDom } from './owned-dom';
import type { ChatPreference, ChatProvider, ChatState, ChatSurface, ChatTheme } from './types';
import { ChatThemeSession, normalizeChatTheme } from './theme';
import { parseChatLocation, readLiveChatSource, watchIdentity } from './url';

/** Fallback discovery for SPA navigations and chats mounted after theater starts. */
const DISCOVERY_POLL_MS = 500;

/** Coalesce structural mutations. Message appends never reach this timer. */
const STRUCTURE_REFRESH_MS = 80;

export interface ChatControllerOptions {
  document: Document;
  href: () => string;
  onChange: (state: ChatState) => void;
  onLayoutChange: () => void;
  /** Move focus to the TME toggle before the hidden chat becomes inert. */
  focusToggle?: () => void;
  initialPreferences?: Partial<Record<ChatProvider, ChatPreference>>;
  persistPreference?: (provider: ChatProvider, preference: ChatPreference) => void;
}

interface MemoryPreference {
  theme: ChatTheme;
  visible: boolean;
  width: number;
  /** User or stored choice. Native initial visibility must not replace it. */
  visibilityLocked: boolean;
  seeded: boolean;
  /** Width changed before native visibility was known; persist once that seed lands. */
  widthPending: boolean;
}

const EMPTY_STATE: ChatState = {
  surface: null,
  available: false,
  visible: false,
  width: DEFAULT_CHAT_WIDTH_PX,
  dock: 'right',
  theme: 'native'
};

/**
 * Session controller for the native Twitch or YouTube chat.
 * Construction starts observation (`start()` is idempotent if called again).
 * Show, hide, resize, and preference retention are provider-independent.
 */
export class ChatController {
  private readonly options: ChatControllerOptions;
  private readonly scope = new DisposableScope();
  private readonly surfaceOwned = new OwnedDom();
  private readonly documentOwned = new OwnedDom();
  private readonly themeSession = new ChatThemeSession();
  private readonly memory = new Map<ChatProvider, MemoryPreference>();
  private current: ChatState = { ...EMPTY_STATE };
  private started = false;
  private disposed = false;
  private lastIdentity = '';
  private boundFrameSrc = '';
  private structureTimer: ReturnType<typeof setTimeout> | null = null;
  private viewportFrame = 0;

  constructor(options: ChatControllerOptions) {
    this.options = options;
    this.start();
  }

  /** Begins route polling, structural observation, and the first detection. */
  start(): void {
    if (this.disposed || this.started) return;
    this.started = true;
    this.observe();
    this.refresh();
  }

  get state(): ChatState {
    return this.current;
  }

  refresh(): void {
    if (this.disposed) return;
    const href = this.safeHref();
    this.lastIdentity = watchIdentity(href);
    this.apply(detectChatSurface(this.options.document, href));
  }

  show(): void {
    this.setVisible(true);
  }

  hide(): void {
    if (this.disposed || !this.current.visible) return;
    if (this.focusInsideSurface()) this.options.focusToggle?.();
    this.setVisible(false);
  }

  toggle(): void {
    if (this.current.visible) this.hide();
    else this.show();
  }

  setWidth(width: number): void {
    if (this.disposed) return;
    const provider = this.provider();
    if (!provider) return;
    const next = clampChatWidth(width);
    const preference = this.ensurePreference(provider, this.current.surface?.initiallyVisible ?? null);
    if (preference.width === next) return;
    preference.width = next;
    if (preference.seeded || preference.visibilityLocked) this.persist(provider);
    else preference.widthPending = true;
    this.refresh();
  }

  setTheme(theme: ChatTheme): void {
    if (this.disposed) return;
    const provider = this.provider();
    if (!provider) return;
    const preference = this.ensurePreference(provider, this.current.surface?.initiallyVisible ?? null);
    const next = provider === 'youtube' ? 'native' : normalizeChatTheme(theme);
    if (preference.theme === next) return;
    preference.theme = next;
    if (preference.seeded || preference.visibilityLocked) this.persist(provider);
    else preference.widthPending = true;
    this.refresh();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scope.dispose();
    this.clearStructureTimer();
    this.clearViewportFrame();
    this.themeSession.dispose();
    this.surfaceOwned.restoreAll();
    this.documentOwned.restoreAll();
    this.current = { ...EMPTY_STATE };
    this.options.onChange(this.current);
    this.options.onLayoutChange();
  }

  private observe(): void {
    const root = this.options.document.documentElement;
    if (!root) return;
    const observer = new MutationObserver((records) => {
      if (this.structureChanged(records)) this.scheduleStructureRefresh();
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'video-id'] });
    this.scope.add(() => observer.disconnect());

    const view = this.options.document.defaultView;
    if (view) {
      this.scope.listen(view, 'resize', () => this.scheduleViewport());
      this.scope.listen(view, 'popstate', () => this.refresh());
      if (view.visualViewport) {
        this.scope.listen(view.visualViewport, 'resize', () => this.scheduleViewport());
      }
    }
    const poll = setInterval(() => this.poll(), DISCOVERY_POLL_MS);
    this.scope.add(() => clearInterval(poll));
  }

  private poll(): void {
    if (this.disposed) return;
    const identity = watchIdentity(this.safeHref());
    const surface = this.current.surface;
    if (!identity) {
      if (identity !== this.lastIdentity || surface) this.refresh();
      return;
    }
    const frameDetached = Boolean(surface?.iframe && !surface.iframe.isConnected);
    const frameRetargeted = Boolean(surface?.iframe) && (surface?.iframe?.getAttribute('src') || '') !== this.boundFrameSrc;
    const rootDetached = Boolean(surface && !surface.root.isConnected);
    const componentDetached = Boolean(surface?.contentRoot && !surface.contentRoot.isConnected);
    if (!surface || identity !== this.lastIdentity || frameDetached || frameRetargeted || rootDetached || componentDetached) this.refresh();
  }

  /**
   * Message nodes are inside the current root and do not match a chat shell.
   * Only a removed/replaced shell, or a newly added shell outside it, schedules work.
   */
  private structureChanged(records: MutationRecord[]): boolean {
    const surface = this.current.surface;
    for (const record of records) {
      if (record.type === 'attributes') {
        const target = record.target;
        if (target instanceof Element && target.matches('ytd-watch-flexy') && record.attributeName === 'video-id') return true;
        if (!(target instanceof HTMLIFrameElement)) continue;
        const src = target.getAttribute('src') || '';
        if (surface?.iframe === target && src !== this.boundFrameSrc) return true;
        if (readLiveChatSource(src) === null) continue;
        if (surface?.iframe === target && src === this.boundFrameSrc) continue;
        return true;
      }
      if (record.type !== 'childList') continue;
      for (const node of record.removedNodes) {
        if (this.removalBreaksSurface(node, surface)) return true;
      }
      for (const node of record.addedNodes) {
        if (this.additionMayMountChat(node, surface)) return true;
      }
    }
    return false;
  }

  private removalBreaksSurface(node: Node, surface: ChatSurface | null): boolean {
    if (!surface) return false;
    if (node === surface.root) return true;
    if (surface.iframe && node === surface.iframe) return true;
    if (surface.contentRoot && node === surface.contentRoot) return true;
    if (!(node instanceof Element)) return false;
    if (node.contains(surface.root)) return true;
    if (surface.contentRoot && node.contains(surface.contentRoot)) return true;
    if (surface.iframe && node.contains(surface.iframe)) return true;
    return false;
  }

  private additionMayMountChat(node: Node, surface: ChatSurface | null): boolean {
    if (!(node instanceof Element)) return false;
    if (node.matches('[data-test-selector="chat-room-component-layout"], .chat-room, .chat-shell, [data-a-target="right-column-chat-bar"], .right-column, #chat, #secondary, ytd-live-chat-frame')) {
      return true;
    }
    if (surface?.root.contains(node) && !(node instanceof HTMLIFrameElement)) return false;
    const tag = node.tagName;
    if (tag === 'YTD-LIVE-CHAT-FRAME' || tag === 'YTD-WATCH-FLEXY' || tag === 'YTD-APP') return true;
    if (tag === 'IFRAME') {
      return node.getAttribute('id') === 'chatframe' || readLiveChatSource(node.getAttribute('src') || '') !== null;
    }
    const id = node.getAttribute('id');
    return id === 'columns' || id === 'page-manager' || id === 'chat-container';
  }

  private scheduleStructureRefresh(): void {
    if (this.disposed || this.structureTimer !== null) return;
    this.structureTimer = setTimeout(() => {
      this.structureTimer = null;
      this.refresh();
    }, STRUCTURE_REFRESH_MS);
  }

  private scheduleViewport(): void {
    if (this.disposed || this.viewportFrame) return;
    const view = this.options.document.defaultView;
    if (!view || typeof view.requestAnimationFrame !== 'function') {
      this.publishGeometry();
      return;
    }
    this.viewportFrame = view.requestAnimationFrame(() => {
      this.viewportFrame = 0;
      this.publishGeometry();
    });
  }

  private apply(detected: ChatSurface | null): void {
    if (this.disposed) return;
    const next = this.retainSurface(detected);
    const previous = this.current.surface;
    if (previous && (previous.root !== next?.root || (next !== null && !sameElements(previous.revealAncestors, next.revealAncestors)))) {
      this.surfaceOwned.restoreAll();
    }
    if (next) this.bindSurface(next, this.preferenceFor(next).visible);
    this.boundFrameSrc = next?.iframe?.getAttribute('src') || '';
    this.themeSession.update(next, this.preferenceForSurface(next).theme);
    this.publish(next);
  }

  private retainSurface(detected: ChatSurface | null): ChatSurface | null {
    const current = this.current.surface;
    if (!detected || !current) return detected;
    if (current.root !== detected.root || current.contentRoot !== detected.contentRoot || current.provider !== detected.provider || current.contentKey !== detected.contentKey || current.kind !== detected.kind || current.iframe !== detected.iframe) {
      return detected;
    }
    if (!sameElements(current.revealAncestors, detected.revealAncestors)) return detected;
    return current;
  }

  private bindSurface(surface: ChatSurface, visible: boolean): void {
    const root = surface.root;
    this.surfaceOwned.setAttribute(root, 'data-theater-chat', '');
    if (root.id === 'secondary') this.surfaceOwned.setAttribute(root, 'data-theater-chat-ancestor', '');
    if (visible) {
      this.surfaceOwned.removeAttribute(root, 'data-theater-chat-hidden');
      this.surfaceOwned.releaseAttribute(root, 'inert');
    } else {
      this.surfaceOwned.setAttribute(root, 'data-theater-chat-hidden', '');
      this.surfaceOwned.setAttribute(root, 'inert', '');
    }
    for (const ancestor of surface.revealAncestors) {
      this.surfaceOwned.setAttribute(ancestor, 'data-theater-chat-ancestor', '');
    }
  }

  private publish(surface: ChatSurface | null): void {
    const layoutChanged = this.writeGeometry(surface);
    const next = this.readState(surface);
    const changed = !sameState(this.current, next);
    this.current = next;
    if (changed) this.options.onChange(this.current);
    if (layoutChanged) this.options.onLayoutChange();
  }

  private publishGeometry(): void {
    if (this.disposed) return;
    if (this.writeGeometry(this.current.surface)) {
      const next = this.readState(this.current.surface);
      const changed = !sameState(this.current, next);
      this.current = next;
      if (changed) this.options.onChange(this.current);
      this.options.onLayoutChange();
    }
  }

  private writeGeometry(surface: ChatSurface | null): boolean {
    const html = this.options.document.documentElement;
    if (!html) return false;
    if (surface) this.documentOwned.setAttribute(html, 'data-theater-chat-active', '');
    else this.documentOwned.removeAttribute(html, 'data-theater-chat-active');
    const visible = Boolean(surface) && this.preferenceForSurface(surface).visible;
    if (surface && visible) this.documentOwned.setAttribute(html, 'data-theater-chat-visible', '');
    else this.documentOwned.removeAttribute(html, 'data-theater-chat-visible');

    const layout = this.layoutFor(surface);
    let changed = false;
    const values: Record<(typeof CHAT_GEOMETRY_PROPERTIES)[number], string> = {
      '--theater-video-width': layout.videoWidth,
      '--theater-video-height': layout.videoHeight,
      '--theater-chat-width': layout.chatWidth,
      '--theater-chat-height': layout.chatHeight,
      '--theater-chat-left': layout.chatLeft,
      '--theater-chat-top': layout.chatTop
    };
    for (const property of CHAT_GEOMETRY_PROPERTIES) {
      const value = values[property];
      if (html.style.getPropertyValue(property) !== value) changed = true;
      this.documentOwned.setProperty(html, property, value);
    }
    return changed;
  }

  private layoutFor(surface: ChatSurface | null): ChatLayout {
    const viewport = readViewport(this.options.document);
    const preference = this.preferenceForSurface(surface);
    const mode = !surface ? 'absent' : preference.visible ? 'shown' : 'hidden';
    return chatGeometry({
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      preferredWidth: preference.width,
      mode
    });
  }

  private readState(surface: ChatSurface | null): ChatState {
    const preference = this.preferenceForSurface(surface);
    const layout = this.layoutFor(surface);
    return {
      surface,
      available: surface !== null,
      visible: surface !== null && preference.visible,
      width: preference.width,
      dock: layout.dock,
      theme: preference.theme
    };
  }

  private preferenceFor(surface: ChatSurface): MemoryPreference {
    return this.ensurePreference(surface.provider, surface.initiallyVisible);
  }

  private preferenceForSurface(surface: ChatSurface | null): { visible: boolean; width: number; theme: ChatTheme } {
    const provider = surface?.provider ?? this.provider();
    if (!provider) return { visible: false, width: DEFAULT_CHAT_WIDTH_PX, theme: 'native' };
    if (!surface) {
      const existing = this.memory.get(provider);
      return existing
        ? { visible: existing.visible, width: existing.width, theme: existing.theme }
        : { visible: false, width: DEFAULT_CHAT_WIDTH_PX, theme: 'native' };
    }
    const preference = this.preferenceFor(surface);
    return { visible: preference.visible, width: preference.width, theme: preference.theme };
  }

  private ensurePreference(provider: ChatProvider, initiallyVisible: boolean | null): MemoryPreference {
    const existing = this.memory.get(provider);
    if (existing) {
      if (initiallyVisible !== null && !existing.seeded && !existing.visibilityLocked) {
        existing.visible = initiallyVisible;
        existing.seeded = true;
        if (existing.widthPending) {
          existing.widthPending = false;
          this.persist(provider);
        }
      }
      return existing;
    }
    const stored = this.options.initialPreferences?.[provider];
    const storedWidth = stored && Number.isFinite(stored.width) ? clampChatWidth(stored.width) : null;
    const storedVisible = stored && typeof stored.visible === 'boolean' ? stored.visible : null;
    const created: MemoryPreference = {
      theme: provider === 'youtube' ? 'native' : normalizeChatTheme(stored?.theme),
      visible: storedVisible ?? initiallyVisible ?? true,
      width: storedWidth ?? DEFAULT_CHAT_WIDTH_PX,
      visibilityLocked: storedVisible !== null,
      seeded: storedVisible !== null || initiallyVisible !== null,
      widthPending: false
    };
    this.memory.set(provider, created);
    return created;
  }

  private setVisible(visible: boolean): void {
    if (this.disposed) return;
    const provider = this.provider();
    if (!provider) return;
    const preference = this.ensurePreference(provider, this.current.surface?.initiallyVisible ?? null);
    if (preference.visible === visible && preference.visibilityLocked) return;
    preference.visible = visible;
    preference.visibilityLocked = true;
    preference.seeded = true;
    preference.widthPending = false;
    this.persist(provider);
    this.refresh();
  }

  private persist(provider: ChatProvider): void {
    const preference = this.memory.get(provider);
    if (!preference) return;
    this.options.persistPreference?.(provider, { visible: preference.visible, width: preference.width, theme: preference.theme });
  }

  private provider(): ChatProvider | null {
    return this.current.surface?.provider ?? parseChatLocation(this.safeHref())?.provider ?? null;
  }

  private focusInsideSurface(): boolean {
    const root = this.current.surface?.root;
    const active = this.options.document.activeElement;
    return Boolean(root && active && root.contains(active));
  }

  private safeHref(): string {
    try {
      return this.options.href();
    } catch {
      return '';
    }
  }

  private clearStructureTimer(): void {
    if (this.structureTimer === null) return;
    clearTimeout(this.structureTimer);
    this.structureTimer = null;
  }

  private clearViewportFrame(): void {
    if (!this.viewportFrame) return;
    this.options.document.defaultView?.cancelAnimationFrame(this.viewportFrame);
    this.viewportFrame = 0;
  }
}

function readViewport(document: Document): { width: number; height: number } {
  const view = document.defaultView;
  const width = view?.innerWidth ?? document.documentElement?.clientWidth ?? 0;
  const height = view?.innerHeight ?? document.documentElement?.clientHeight ?? 0;
  return {
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0
  };
}

function sameElements(left: readonly HTMLElement[], right: readonly HTMLElement[]): boolean {
  return left.length === right.length && left.every((element, index) => element === right[index]);
}

function sameState(left: ChatState, right: ChatState): boolean {
  return left.available === right.available
    && left.visible === right.visible
    && left.theme === right.theme
    && left.width === right.width
    && left.dock === right.dock
    && left.surface === right.surface;
}
