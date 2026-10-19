import { DisposableScope } from '../core/disposable-scope';
import { detectChatSurface } from './detect';
import { detectChatActivation, TWITCH_CHAT_TOGGLE_SELECTOR, YOUTUBE_CHAT_CARD_SELECTOR } from './activation';
import {
  CHAT_GEOMETRY_PROPERTIES,
  type ChatLayout,
  chatGeometry,
  clampChatWidth,
  DEFAULT_CHAT_WIDTH_PX
} from './geometry';
import { OwnedDom } from './owned-dom';
import type { ChatActivation, ChatPreference, ChatProvider, ChatState, ChatSurface, ChatTheme } from './types';
import { ChatThemeSession, normalizeChatTheme } from './theme';
import { isNativeChatHost, parseChatLocation, readLiveChatSource, watchIdentity } from './url';

/** Cheap route check. DOM discovery does not run on every tick. */
const DISCOVERY_POLL_MS = 500;

/**
 * Late shells usually arrive as mutations. This only covers a mount or model
 * change that does not touch the DOM, and it never runs while the document is hidden.
 */
const LATE_MOUNT_MS = 2000;

/** Coalesce structural mutations. Message appends never reach this timer. */
const STRUCTURE_REFRESH_MS = 80;

const ACTIVATION_SELECTOR = `${TWITCH_CHAT_TOGGLE_SELECTOR}, ${YOUTUBE_CHAT_CARD_SELECTOR}, #show-hide-button`;

const SHELL_SELECTOR = '[data-test-selector="chat-room-component-layout"], .chat-room, .chat-shell, [data-a-target="right-column-chat-bar"], .right-column, #chat, #secondary, ytd-live-chat-frame';

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
  /** Explicit choice for this content. Native initial visibility must not replace it. */
  visibilityLocked: boolean;
  seeded: boolean;
}

const EMPTY_STATE: ChatState = {
  surface: null,
  available: false,
  visible: false,
  width: DEFAULT_CHAT_WIDTH_PX,
  dock: 'right',
  theme: 'native',
  themeStatus: 'native'
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
  private readonly themeSession = new ChatThemeSession(() => {
    if (!this.disposed) this.publish(this.current.surface);
  });
  private readonly memory = new Map<ChatProvider, MemoryPreference>();
  private current: ChatState = { ...EMPTY_STATE };
  private started = false;
  private disposed = false;
  private lastIdentity = '';
  private boundFrameSrc = '';
  private structureTimer: ReturnType<typeof setTimeout> | null = null;
  private viewportFrame = 0;
  private shellObserver: MutationObserver | null = null;
  private shellArmed = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private listenersBound = false;
  private lastLateRefresh = 0;
  private activation: ChatActivation | null = null;
  private attemptedActivation: (ChatActivation & { at: number }) | null = null;

  constructor(options: ChatControllerOptions) {
    this.options = options;
    this.start();
  }

  /** Begins observation only for a visible chat host, then detects once. */
  start(): void {
    if (this.disposed || this.started) return;
    this.started = true;
    this.refresh();
  }

  get state(): ChatState {
    return this.current;
  }

  refresh(): void {
    if (this.disposed) return;
    this.syncActivity();
    if (this.options.document.hidden) return;
    const href = this.safeHref();
    const identity = watchIdentity(href);
    const routeChanged = identity !== this.lastIdentity;
    if (routeChanged) this.resetVisibilitySeed();
    this.lastIdentity = identity;
    this.lastLateRefresh = Date.now();
    let surface = detectChatSurface(this.options.document, href);
    const previous = this.current.surface;
    // A stable live route may mount a new content identity without changing its URL.
    if (!routeChanged && surface && previous
      && (surface.provider !== previous.provider || surface.contentKey !== previous.contentKey)) {
      this.resetVisibilitySeed();
      surface = detectChatSurface(this.options.document, href);
    }
    this.activation = detectChatActivation(this.options.document, href, surface);
    // Closing chat through the service's own UI is also a viewer choice.
    // Do not immediately undo it with the previously shown TME preference.
    if (this.activation && this.current.visible && previous?.provider === this.activation.provider
      && previous.contentKey === this.activation.contentKey) {
      const preference = this.ensurePreference(previous.provider, false);
      preference.visible = false;
      preference.visibilityLocked = true;
      this.persist(previous.provider);
    }
    this.apply(surface);
    this.openNativeChat();
  }

  private resetVisibilitySeed(): void {
    // Restore our presentation before measuring the next native content.
    this.surfaceOwned.restoreAll();
    this.documentOwned.restoreAll();
    this.attemptedActivation = null;
    for (const preference of this.memory.values()) {
      preference.visibilityLocked = false;
      preference.seeded = false;
    }
  }

  show(): void {
    this.setVisible(true);
  }

  hide(): void {
    if (this.disposed) return;
    if (this.focusInsideSurface()) this.options.focusToggle?.();
    this.setVisible(false);
  }

  toggle(): void {
    if (this.current.visible || (this.attemptedActivation && Date.now() - this.attemptedActivation.at < 5000
      && this.preferenceForSurface(this.current.surface).visible)) this.hide();
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
    this.persist(provider);
    this.refresh();
  }

  setTheme(theme: ChatTheme): void {
    if (this.disposed) return;
    const provider = this.provider();
    if (!provider) return;
    const preference = this.ensurePreference(provider, this.current.surface?.initiallyVisible ?? null);
    const next = normalizeChatTheme(theme);
    if (preference.theme === next) return;
    preference.theme = next;
    this.persist(provider);
    this.refresh();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scope.dispose();
    this.disarmShell();
    this.clearPoll();
    this.clearStructureTimer();
    this.clearViewportFrame();
    this.themeSession.dispose();
    this.surfaceOwned.restoreAll();
    this.documentOwned.restoreAll();
    this.activation = null;
    this.attemptedActivation = null;
    this.current = { ...EMPTY_STATE };
    this.options.onChange(this.current);
    this.options.onLayoutChange();
  }

  /**
   * Generic pages and non-watch hosts get no observer and no timer.
   * A chat host on a non-watch route only compares the URL until a watch route appears.
   */
  private syncActivity(): void {
    if (this.disposed) return;
    const doc = this.options.document;
    const href = this.safeHref();
    // Geometry follows the viewport on every page: the controller also publishes
    // the stage size variables when there is no chat.
    this.bindListeners();
    const host = isNativeChatHost(href);
    if (!host) {
      this.disarmShell();
      this.clearPoll();
      return;
    }
    if (doc.hidden) {
      this.disarmShell();
      this.clearPoll();
      return;
    }
    this.ensurePoll();
    if (parseChatLocation(href)?.role === 'watch') this.armShell();
    else this.disarmShell();
  }

  private bindListeners(): void {
    if (this.listenersBound) return;
    this.listenersBound = true;
    const doc = this.options.document;
    const view = doc.defaultView;
    this.scope.listen(doc, 'visibilitychange', () => this.onVisibility());
    if (!view) return;
    this.scope.listen(view, 'popstate', () => { if (!doc.hidden && isNativeChatHost(this.safeHref())) this.refresh(); });
    this.scope.listen(view, 'resize', () => this.onViewport());
    if (view.visualViewport) this.scope.listen(view.visualViewport, 'resize', () => this.onViewport());
  }

  private onVisibility(): void {
    if (this.disposed) return;
    if (this.options.document.hidden) {
      this.disarmShell();
      this.clearPoll();
      this.clearStructureTimer();
      return;
    }
    if (isNativeChatHost(this.safeHref())) this.refresh();
    else this.scheduleViewport();
  }

  private onViewport(): void {
    if (this.options.document.hidden) return;
    this.scheduleViewport();
  }

  private ensurePoll(): void {
    if (this.pollTimer !== null) return;
    const poll = setInterval(() => this.poll(), DISCOVERY_POLL_MS);
    this.pollTimer = poll;
    this.scope.add(() => {
      clearInterval(poll);
      if (this.pollTimer === poll) this.pollTimer = null;
    });
  }

  private clearPoll(): void {
    if (this.pollTimer === null) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private armShell(): void {
    if (this.shellArmed) return;
    const root = this.options.document.documentElement;
    if (!root) return;
    if (!this.shellObserver) {
      this.shellObserver = new MutationObserver((records) => {
        if (this.disposed || this.options.document.hidden) return;
        if (this.structureChanged(records)) this.scheduleStructureRefresh();
      });
      this.scope.add(() => {
        this.shellObserver?.disconnect();
        this.shellObserver = null;
        this.shellArmed = false;
      });
    }
    this.shellObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'video-id', 'collapsed', 'aria-label', 'aria-expanded', 'disabled', 'aria-disabled', 'hidden']
    });
    this.shellArmed = true;
  }

  private disarmShell(): void {
    if (!this.shellArmed) return;
    this.shellObserver?.disconnect();
    this.shellArmed = false;
  }

  private poll(): void {
    if (this.disposed || this.options.document.hidden) return;
    const href = this.safeHref();
    if (!isNativeChatHost(href)) {
      this.disarmShell();
      this.clearPoll();
      return;
    }
    const identity = watchIdentity(href);
    if (identity) this.armShell();
    else this.disarmShell();
    if (identity !== this.lastIdentity) {
      this.refresh();
      return;
    }
    if (!identity) return;
    const surface = this.current.surface;
    const frameDetached = Boolean(surface?.iframe && !surface.iframe.isConnected);
    const frameRetargeted = Boolean(surface?.iframe) && (surface?.iframe?.getAttribute('src') || '') !== this.boundFrameSrc;
    const rootDetached = Boolean(surface && !surface.root.isConnected);
    const componentDetached = Boolean(surface?.contentRoot && !surface.contentRoot.isConnected);
    if (frameDetached || frameRetargeted || rootDetached || componentDetached) {
      this.refresh();
      return;
    }
    if (surface && !this.activation) return;
    if (Date.now() - this.lastLateRefresh < LATE_MOUNT_MS) return;
    this.refresh();
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
        if (target instanceof Element && (target.matches(ACTIVATION_SELECTOR + ', ytd-live-chat-frame')
          || target.closest(YOUTUBE_CHAT_CARD_SELECTOR + ', #show-hide-button'))) return true;
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
    if (this.ignoredBeforeScan(node, surface)) return false;
    if (node.matches(ACTIVATION_SELECTOR) || node.matches(SHELL_SELECTOR)) return true;
    const tag = node.tagName;
    if (tag === 'YTD-LIVE-CHAT-FRAME' || tag === 'YTD-WATCH-FLEXY' || tag === 'YTD-APP') return true;
    if (tag === 'IFRAME') {
      return node.getAttribute('id') === 'chatframe' || readLiveChatSource(node.getAttribute('src') || '') !== null;
    }
    const id = node.getAttribute('id');
    if (id === 'columns' || id === 'page-manager' || id === 'chat-container') return true;
    // An empty node cannot contain a shell. Wrappers are the only subtree scan.
    if (node.childElementCount === 0) return false;
    return Boolean(node.querySelector(ACTIVATION_SELECTOR) || node.querySelector(SHELL_SELECTOR));
  }

  /** Chat transcripts and our controls are not shells. Skip them before any selector scan. */
  private ignoredBeforeScan(node: Element, surface: ChatSurface | null): boolean {
    if (node.id === 'theater-everywhere-ui' || node.closest('#theater-everywhere-ui')) return true;
    if (node.matches('[data-theater-chat-palette], [data-theater-chat-canvas], .chat-line__message, .chat-line, yt-live-chat-text-message-renderer')) return true;
    if (surface?.root.contains(node) && !(node instanceof HTMLIFrameElement) && !node.matches(SHELL_SELECTOR)) return true;
    return false;
  }

  private scheduleStructureRefresh(): void {
    if (this.disposed || this.options.document.hidden || this.structureTimer !== null) return;
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
    if (next) this.bindSurface(next, this.preferenceFor(next).visible && !this.activation);
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
    const visible = Boolean(surface) && this.preferenceForSurface(surface).visible && !this.activation;
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
    const mode = !surface ? 'absent' : preference.visible && !this.activation ? 'shown' : 'hidden';
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
      available: surface !== null || this.activation !== null,
      visible: surface !== null && preference.visible && !this.activation,
      width: preference.width,
      dock: layout.dock,
      theme: preference.theme,
      themeStatus: this.themeSession.status
    };
  }

  private preferenceFor(surface: ChatSurface): MemoryPreference {
    return this.ensurePreference(surface.provider, this.activation ? false : surface.initiallyVisible);
  }

  private preferenceForSurface(surface: ChatSurface | null): { visible: boolean; width: number; theme: ChatTheme } {
    const provider = surface?.provider ?? this.provider();
    if (!provider) return { visible: false, width: DEFAULT_CHAT_WIDTH_PX, theme: 'native' };
    if (!surface) {
      if (this.activation) return this.ensurePreference(provider, false);
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
      }
      return existing;
    }
    const stored = this.options.initialPreferences?.[provider];
    const storedWidth = stored && Number.isFinite(stored.width) ? clampChatWidth(stored.width) : null;
    const storedVisible = stored && typeof stored.visible === 'boolean' ? stored.visible : null;
    const created: MemoryPreference = {
      theme: normalizeChatTheme(stored?.theme),
      visible: initiallyVisible ?? storedVisible ?? true,
      width: storedWidth ?? DEFAULT_CHAT_WIDTH_PX,
      visibilityLocked: false,
      seeded: initiallyVisible !== null
    };
    this.memory.set(provider, created);
    return created;
  }

  private setVisible(visible: boolean): void {
    if (this.disposed) return;
    const provider = this.provider();
    if (!provider) return;
    const preference = this.ensurePreference(provider, this.current.surface?.initiallyVisible ?? null);
    if (visible) this.attemptedActivation = null; // An explicit retry may repeat a failed native action.
    if (preference.visible === visible && preference.visibilityLocked) {
      if (visible) this.refresh();
      return;
    }
    preference.visible = visible;
    preference.visibilityLocked = true;
    preference.seeded = true;
    this.persist(provider);
    this.refresh();
  }

  /** Click once per route/attempt. Polling only waits for service-owned DOM. */
  private openNativeChat(): void {
    const activation = this.activation;
    if (!activation) {
      if (this.current.visible) this.attemptedActivation = null;
      return;
    }
    if (!this.preferenceForSurface(this.current.surface).visible || !activation.control.isConnected) return;
    const previous = this.attemptedActivation;
    if (previous?.contentKey === activation.contentKey && previous.provider === activation.provider) return;
    this.attemptedActivation = { ...activation, at: Date.now() };
    activation.control.click();
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
    && left.themeStatus === right.themeStatus
    && left.width === right.width
    && left.dock === right.dock
    && left.surface === right.surface;
}
