/** Hooks the player offers to host presentation implementations. */
export type ProviderStructuralHelpers = {
  connected(element: HTMLElement): boolean;
  refreshAncestors(element: HTMLElement): void;
};

export type ProviderPlaybackBindOptions = {
  root: Node;
  video: HTMLVideoElement;
  current: () => HTMLVideoElement | null;
  pick: () => HTMLVideoElement | null;
  onSwitch: (next: HTMLVideoElement) => void;
  onStabilize: (video: HTMLVideoElement) => void;
};

export type ProviderStage = {
  mount(hostname: string, element: HTMLElement): void;
  ensure?(hostname: string, element: HTMLElement): void;
  unmount(): void;
  observe?(hostname: string): () => void;
  claimsViewportPin?(): boolean;
  pinViewport?(element: HTMLElement): void;
  afterViewportPin?(element: HTMLElement, pinGeneric: (element: HTMLElement) => void): void;
  onStructuralMutation?(element: HTMLElement, helpers: ProviderStructuralHelpers): void;
  bindPlayback?(options: ProviderPlaybackBindOptions): (() => void) | null;
};
