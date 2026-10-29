import type { ChatThemeAdapter } from '../chat/adapters/types';
import type { ChatActivation, ChatSurface } from '../chat/types';
import type { ParsedChatLocation } from '../chat/url';
import type { ServiceActionSource } from '../core/service-actions';
import type { MediaFetchRequest } from '../media-features/fetch-allowlist';
import type { MediaProviderId } from '../media-features/provider-flags';
import type { MediaFeaturesAdapter, TimelineMarkerSource } from '../media-features/types';
import type { PlaylistAction, PlaylistDirection } from '../playlist-nav';

import type { LauncherPlacementFactory } from './launcher-placement';
import type { NativeServiceActionHooks } from './native-service-actions';
import type { CollectedControl, PlaylistHelpers } from './playlist-controls';
import type { ProviderTimeline } from './timeline/types';
import type { WatchPlayback } from './watch-playback';

export type ProviderWorld = 'isolated' | 'main';
export type ProviderChat = {
  parseLocation(url: URL): ParsedChatLocation | null;
  matchesHost(hostname: string): boolean;
  detect(document: Document, href: string): ChatSurface | null;
  /** `surface` is the chat already detected, if any; a service may offer activation only while it is collapsed. */
  activation(document: Document, href: string, surface?: ChatSurface | null): ChatActivation | null;
  eventSelector: string;
  /** Chat-owned elements a selector cannot express (custom element families, chat frames, open portals). */
  matchesEvent?(element: Element): boolean;
  activationSelector: string;
  shellSelector: string;
  /** Events at the page (document or window) after which the chat may have moved to a new route. */
  navigationEvents: readonly string[];
  /** Finer structure rules for services whose chat mounts through custom elements or frames. */
  structure?: {
    attributeChanged(target: Element, name: string | null): boolean;
    /** The frame source names this service's chat document. */
    frameSource(src: string): boolean;
    mayMount(node: Element): boolean;
    /** Chat transcript nodes, skipped before any subtree scan. */
    transcript(node: Element): boolean;
  };
  /** Palette integration. Without it a non-native theme stays unavailable and the service keeps its appearance. */
  theme?: {
    /** The document that holds the chat's palette, such as the chat iframe's. */
    document(surface: ChatSurface): Document | null;
    adapter(document: Document, surface: ChatSurface): ChatThemeAdapter;
  };
};

/** Only hooks used by the pilot. Stateful shared services are supplied by the owning runtime. */
export type ProviderHooks = {
  id: MediaProviderId;
  contractVersion: 1;
  watchPlayback: WatchPlayback;
  /**
   * Fetch admission for this provider's media URLs. Optional: a rule the background broker must also apply
   * (it has no provider registry), such as YouTube's timedtext, stays in the shared allowlist.
   */
  allowsMediaFetch?(request: MediaFetchRequest, base?: string): boolean;
  createAdapter?: (video: HTMLVideoElement | null) => MediaFeaturesAdapter;
  launcherPlacement?: LauncherPlacementFactory;
  /** Host events the shared runtime follows on this provider's pages, by what they signal. */
  events?: {
    /** The host starts replacing its page: page reads abort and the theater viewport holds. */
    navigationStart?: readonly string[];
    /** The host may have rebuilt DOM that observers watch (playlist controls, actions). */
    domChange?: readonly string[];
    /** New media data (title, captions, chapters) may be available; window-level, any target. */
    media?: readonly string[];
  };
  /** Host clocks, live bounds and seek dispatch in the isolated world. */
  timeline?: ProviderTimeline;
  timelineMarkers?: (video: HTMLElement) => TimelineMarkerSource | null;
  /** `options` binds the source to the theater session's document and surface. */
  serviceActions?: (options: NativeServiceActionHooks) => ServiceActionSource;
  navigation?: {
    playerSelector: string;
    readControls(root: ParentNode): CollectedControl[];
    /** Host surfaces whose changes can alter navigation; any mutation inside them counts. */
    surfaces?: string;
    /** Host queue actions; each claimed direction (including a confirmed end) hides host controls for it. */
    queue?(root: ParentNode, video: HTMLVideoElement | null | undefined, helpers: PlaylistHelpers): { actions: PlaylistAction[]; claimed: Set<PlaylistDirection> };
  };
  chat?: ProviderChat;
  install?: () => void;
};
export type ProviderRuntimeApi = {
  contractVersion: 1;
  register(hooks: ProviderHooks): boolean;
  start(): void;
  services?: {
    requestPageFetch(url: string): Promise<string | null>;
    serviceElementToken(element: Element): number;
  };
};
const apiKey = (world: ProviderWorld) => Symbol.for(`theater-everywhere.provider-runtime.${world}`);

export function exposeProviderRuntime(world: ProviderWorld, api: ProviderRuntimeApi): void {
  Object.defineProperty(window, apiKey(world), { value: api });
}

/** Each world has its own API; nothing is passed through DOM or across the world boundary. */
export function providerRuntime(world: ProviderWorld): ProviderRuntimeApi | undefined {
  const api: unknown = (window as unknown as Record<symbol, unknown>)[apiKey(world)];
  if (!api || typeof api !== 'object' || !('contractVersion' in api) || api.contractVersion !== 1) return undefined;
  // Only the runtime entry writes this object, before provider entries in the same js array.
  return api as ProviderRuntimeApi;
}
