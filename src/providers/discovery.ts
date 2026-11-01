import { providerRegistry } from './runtime-registration';

export type ProviderDiscovery = {
  rankBest?(videos: HTMLVideoElement[]): HTMLVideoElement | null;
  prepareShadowRoot?(shadowRoot: ShadowRoot): void;
  sharesPlaybackHost?(current: HTMLVideoElement, replacement: HTMLVideoElement): boolean;
};

const providerDiscovery = (): ProviderDiscovery[] => providerRegistry.all().flatMap(hooks => hooks.discovery ?? []);

export function providerRankedVideo(videos: HTMLVideoElement[]): HTMLVideoElement | null {
  for (const hook of providerDiscovery()) {
    const picked = hook.rankBest?.(videos);
    if (picked) return picked;
  }
  return null;
}

export function prepareProviderShadowRoot(shadowRoot: ShadowRoot): void {
  for (const hook of providerDiscovery()) hook.prepareShadowRoot?.(shadowRoot);
}

export function providerSharesPlaybackHost(current: HTMLVideoElement, replacement: HTMLVideoElement): boolean {
  for (const hook of providerDiscovery()) {
    if (hook.sharesPlaybackHost && !hook.sharesPlaybackHost(current, replacement)) return false;
  }
  return true;
}

export function providerVideoAbandoned(video: HTMLVideoElement): boolean {
  return providerRegistry.all().some(hooks => hooks.discovery?.abandonedVideo?.(video) === true);
}
