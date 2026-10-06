export type MediaSeekDetail = {
  live?: boolean;
  time?: number;
  resumeAfterSeek?: boolean;
  cancelPendingResume?: boolean;
};

export type TimelineBounds = {
  start: number;
  end: number;
};

export type HostSeekInput = {
  target: number;
  windowLive: boolean;
  atLiveEdge: boolean;
  resumeAfterSeek: boolean;
};

export type HostSeekDispatch = {
  detail: MediaSeekDetail;
  rememberResume: boolean;
};

export type ProviderTimeline = {
  liveHint?(video: HTMLVideoElement): boolean;
  isAtLiveHead?(video: HTMLVideoElement): boolean;
  liveBounds?(video: HTMLVideoElement): TimelineBounds | null;
  vodDuration?(video: HTMLVideoElement): number | null;
  readClock?(video: HTMLVideoElement | null): number | null;
  observeClock?(
    video: HTMLVideoElement | null,
    onClock: (published: number | null) => void
  ): (() => void) | null;
  mediaSeek?(video: HTMLVideoElement, input: HostSeekInput): HostSeekDispatch | null;
  liveSeek?(video: HTMLVideoElement): HostSeekDispatch | null;
};
