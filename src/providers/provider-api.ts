import type { ChatActivation, ChatSurface } from '../chat/types';
import type { ParsedChatLocation } from '../chat/url';
import type { ServiceActionSource } from '../core/service-actions';
import type { MediaFetchRequest } from '../media-features/fetch-allowlist';
import type { MediaProviderId } from '../media-features/provider-flags';
import type { MediaFeaturesAdapter } from '../media-features/types';

import type { LauncherPlacementFactory } from './launcher-placement';
import type { CollectedControl } from './playlist-controls';
import type { WatchPlayback } from './watch-playback';

export type ProviderWorld = 'isolated' | 'main';
export type ProviderChat = {
  parseLocation(url: URL): ParsedChatLocation | null;
  matchesHost(hostname: string): boolean;
  detect(document: Document, href: string): ChatSurface | null;
  activation(document: Document, href: string): ChatActivation | null;
  eventSelector: string;
  activationSelector: string;
  shellSelector: string;
  navigationEvents: readonly string[];
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
  serviceActions?: () => ServiceActionSource;
  navigation?: { playerSelector: string; readControls(root: ParentNode): CollectedControl[] };
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
