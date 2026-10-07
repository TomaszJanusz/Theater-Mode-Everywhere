import { disneyTheaterStage } from './disney/stage';
import { bindNetflixTheaterPlayback } from './netflix/playback';
import type { ProviderPlaybackBindOptions, ProviderStage, ProviderStructuralHelpers } from '../core/provider-presentation';
export type { ProviderPlaybackBindOptions, ProviderStage, ProviderStructuralHelpers } from '../core/provider-presentation';
import {
  mountNetflixTheaterStage,
  onNetflixStructuralMutation,
  pinNetflixTheaterViewport,
  unmountNetflixTheaterStage
} from './netflix/stage';
import { tencentTheaterStage } from './tencent/stage';
import { twitchTheaterStage } from './twitch/stage';

const netflixTheaterStage: ProviderStage = {
  mount(hostname: string) {
    mountNetflixTheaterStage(hostname);
  },
  unmount() {
    unmountNetflixTheaterStage();
  },
  afterViewportPin(element: HTMLElement, pinGeneric: (element: HTMLElement) => void) {
    pinNetflixTheaterViewport(element, pinGeneric);
  },
  onStructuralMutation(element: HTMLElement, helpers: ProviderStructuralHelpers) {
    onNetflixStructuralMutation(element, helpers);
  },
  bindPlayback(options) {
    return bindNetflixTheaterPlayback(options);
  }
};

const providerStages: ProviderStage[] = [
  disneyTheaterStage,
  twitchTheaterStage,
  netflixTheaterStage,
  tencentTheaterStage
];

let stopObservingProviderStages: (() => void) | null = null;

function mountAll(hostname: string, element: HTMLElement): void {
  for (const stage of providerStages) stage.mount(hostname, element);
}

function restartObservers(hostname: string): void {
  stopObservingProviderStages?.();
  const stops = providerStages.flatMap((stage) => {
    const stop = stage.observe?.(hostname);
    return stop ? [stop] : [];
  });
  stopObservingProviderStages = () => {
    for (const stop of stops) stop();
  };
}

export function mountProviderStages(hostname: string, element: HTMLElement): void {
  mountAll(hostname, element);
  restartObservers(hostname);
}

export function remountProviderStages(hostname: string, element: HTMLElement): void {
  mountAll(hostname, element);
}

export function ensureProviderStages(hostname: string, element: HTMLElement): void {
  for (const stage of providerStages) stage.ensure?.(hostname, element);
}

export function unmountProviderStages(): void {
  stopObservingProviderStages?.();
  stopObservingProviderStages = null;
  for (const stage of providerStages) stage.unmount();
}

export function pinProviderViewport(
  element: HTMLElement,
  pinGeneric: (element: HTMLElement) => void
): void {
  const claim = providerStages.find((stage) => stage.claimsViewportPin?.());
  if (claim?.pinViewport) claim.pinViewport(element);
  else pinGeneric(element);
  for (const stage of providerStages) {
    if (stage === claim) continue;
    stage.afterViewportPin?.(element, pinGeneric);
  }
}

export function onProviderStructuralMutation(element: HTMLElement, helpers: ProviderStructuralHelpers): void {
  for (const stage of providerStages) stage.onStructuralMutation?.(element, helpers);
}

export function bindProviderPlayback(options: ProviderPlaybackBindOptions): () => void {
  const stops: Array<() => void> = [];
  for (const stage of providerStages) {
    const stop = stage.bindPlayback?.(options);
    if (stop) stops.push(stop);
  }
  return () => {
    for (const stop of stops) stop();
  };
}
