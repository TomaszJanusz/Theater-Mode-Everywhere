import { isTencentHost } from '../hosts';
import { parseFrameMessage, type FrameEnvelope } from '../../protocol/frame-messages';

export const TENCENT_WASM_TAG = 'fake-iframe-video';
export const TENCENT_WASM_FRAME_HOST = 'vm.gtimg.cn';
export const TENCENT_WASM_MIN_EDGE = 80;
export const TENCENT_WASM_FRAME_PATH = /\/thumbplayer\/txv\/wasm\/[^/]+\/fake-video-element-iframe\.html$/;

const MEDIA_EVENTS = [
  'play',
  'pause',
  'timeupdate',
  'seeking',
  'seeked',
  'volumechange',
  'ratechange',
  'durationchange',
  'waiting',
  'playing',
  'loadedmetadata',
  'progress',
  'emptied',
  'canplay',
  'stalled'
] as const;

export type TencentWasmMediaEvent = typeof MEDIA_EVENTS[number];

export type TencentWasmSnapshot = {
  paused: boolean;
  ended: boolean;
  seeking: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  readyState: number;
  buffered: Array<{ start: number; end: number }>;
  pictureInPicture: boolean;
};

export type TencentTheaterTargetInput = {
  switchable: HTMLElement | null;
  wasm: HTMLElement | null;
  fallback: HTMLElement | null;
  wasmFrameDocument: boolean;
};

type Viewport = { width: number; height: number };

type FrameLike = {
  src?: string;
  contentWindow?: unknown;
};

export function isTencentWasmFrameUrl(value: string, baseHref = 'https://v.qq.com/'): boolean {
  try {
    const url = new URL(value, baseHref);
    return url.hostname === TENCENT_WASM_FRAME_HOST && TENCENT_WASM_FRAME_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

export function isTencentWasmFrameDocument(href = typeof location === 'undefined' ? '' : location.href): boolean {
  return isTencentWasmFrameUrl(href);
}

export function isTencentWasmPlayerElement(element: Element | null | undefined): element is HTMLElement {
  if (!element || element.localName !== TENCENT_WASM_TAG) return false;
  if (typeof HTMLElement === 'undefined') return true;
  return element instanceof HTMLElement;
}

function frameOf(host: DomNode): FrameLike | null {
  const shadow = host.shadowRoot;
  if (!shadow || typeof shadow.querySelector !== 'function') return null;
  const frame = shadow.querySelector('iframe');
  return frame ? frame as FrameLike : null;
}

export function isUsableTencentWasmPlayer(
  element: Element | null | undefined,
  viewport?: Viewport
): element is HTMLElement {
  if (!isTencentWasmPlayerElement(element)) return false;
  if (element.isConnected === false) return false;
  const view = element.ownerDocument?.defaultView;
  if (view && typeof view.getComputedStyle === 'function') {
    const style = view.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  const rect = element.getBoundingClientRect();
  const width = Math.max(rect.width || 0, element.clientWidth || 0);
  const height = Math.max(rect.height || 0, element.clientHeight || 0);
  if (width < TENCENT_WASM_MIN_EDGE || height < TENCENT_WASM_MIN_EDGE) return false;
  const bounds = viewport || {
    width: view?.innerWidth || width,
    height: view?.innerHeight || height
  };
  const left = Math.max(rect.left, 0);
  const right = Math.min(rect.right, bounds.width);
  const top = Math.max(rect.top, 0);
  const bottom = Math.min(rect.bottom, bounds.height);
  if (right - left <= 0 || bottom - top <= 0) return false;
  const frame = frameOf(element);
  if (!frame?.src) return false;
  const base = element.ownerDocument?.location?.href || view?.location?.href;
  return isTencentWasmFrameUrl(frame.src, base);
}

export function selectTencentTheaterTarget(input: TencentTheaterTargetInput): HTMLElement | null {
  if (input.switchable) return input.switchable;
  if (input.wasm) return input.wasm;
  if (input.wasmFrameDocument) return null;
  return input.fallback;
}

export function replacementTencentWasmHost(
  current: HTMLElement | null,
  candidates: HTMLElement[],
  connected: (element: HTMLElement) => boolean = (element) => element.isConnected !== false
): HTMLElement | null {
  if (current && connected(current)) return null;
  return candidates.find((candidate) => candidate !== current && connected(candidate)) || null;
}

type DomNode = {
  localName?: string;
  src?: string;
  contentWindow?: unknown;
  shadowRoot?: { querySelector(selector: string): DomNode | null } | null;
};

type QueryRoot = {
  querySelectorAll(selector: string): ArrayLike<DomNode>;
};

export function tencentWasmContentWindows(root: QueryRoot): unknown[] {
  const windows: unknown[] = [];
  const hosts = Array.from(root.querySelectorAll(TENCENT_WASM_TAG));
  for (const host of hosts) {
    const frame = frameOf(host);
    if (frame?.contentWindow) windows.push(frame.contentWindow);
  }
  return windows;
}

export function ordinaryChildWindows(root: QueryRoot): unknown[] {
  const hidden = new Set(tencentWasmContentWindows(root));
  return Array.from(root.querySelectorAll('iframe'))
    .map((frame) => (frame as FrameLike).contentWindow)
    .filter((win) => win && !hidden.has(win));
}

function frameOrigin(src: string, pageHref: string): string | null {
  try {
    return new URL(src, pageHref).origin;
  } catch {
    return null;
  }
}

export type TencentWasmHostToggle = {
  action: 'toggle' | 'fullscreen';
  host: HTMLElement;
};

/**
 * Accepts FRAME_HOST_TOGGLE only from the open shadow iframe of a fake-iframe-video
 * on a Tencent host. The wasm frame is not an ordinary child, and FRAME_ENTER from
 * that window is rejected here.
 */
export function readTencentWasmHostToggle(
  event: { source: unknown; origin: string; data: unknown },
  page: { hostname: string; href: string; root: QueryRoot }
): TencentWasmHostToggle | null {
  if (!isTencentHost(page.hostname)) return null;
  const envelope = parseFrameMessage(event.data);
  if (!envelope || envelope.type !== 'FRAME_HOST_TOGGLE') return null;
  if (envelope.origin !== event.origin) return null;
  const action = envelope.payload.action;
  if (action !== 'toggle' && action !== 'fullscreen') return null;
  const hosts = Array.from(page.root.querySelectorAll(TENCENT_WASM_TAG));
  for (const host of hosts) {
    if (host.localName && host.localName !== TENCENT_WASM_TAG) continue;
    const frame = frameOf(host);
    if (!frame?.contentWindow || frame.contentWindow !== event.source) continue;
    if (!frame.src || !isTencentWasmFrameUrl(frame.src, page.href)) return null;
    const origin = frameOrigin(frame.src, page.href);
    if (!origin || origin !== event.origin) return null;
    return { action, host: host as HTMLElement };
  }
  return null;
}

export function wasmHostToggleFromEnvelope(envelope: FrameEnvelope | null): 'toggle' | 'fullscreen' | null {
  if (!envelope || envelope.type !== 'FRAME_HOST_TOGGLE') return null;
  const action = envelope.payload.action;
  return action === 'toggle' || action === 'fullscreen' ? action : null;
}

export type WasmClock = {
  notePlaying(): void;
  notePause(): void;
  noteSeek(): void;
  noteEvent(): void;
  dispose(): void;
};

/**
 * Fills a missing timeupdate or buffered sample for the Tencent surface.
 * Polling stops on pause, seek, and dispose (swap or exit).
 */
export function createWasmClock(options: {
  intervalMs?: number;
  staleMs?: number;
  now?: () => number;
  schedule: (fn: () => void, ms: number) => number;
  cancel: (id: number) => void;
  poll: () => void;
}): WasmClock {
  const intervalMs = options.intervalMs ?? 250;
  const staleMs = options.staleMs ?? 400;
  const now = options.now ?? (() => Date.now());
  let timer: number | null = null;
  let playing = false;
  let seeking = false;
  let disposed = false;
  let lastEvent = now();

  const stop = () => {
    if (timer == null) return;
    options.cancel(timer);
    timer = null;
  };
  const arm = () => {
    if (disposed || !playing || seeking || timer != null) return;
    timer = options.schedule(tick, intervalMs);
  };
  const tick = () => {
    timer = null;
    if (disposed || !playing || seeking) return;
    if (now() - lastEvent >= staleMs) options.poll();
    arm();
  };

  return {
    notePlaying() {
      if (disposed) return;
      playing = true;
      seeking = false;
      arm();
    },
    notePause() {
      playing = false;
      stop();
    },
    noteSeek() {
      seeking = true;
      stop();
    },
    noteEvent() {
      lastEvent = now();
    },
    dispose() {
      disposed = true;
      playing = false;
      seeking = false;
      stop();
    }
  };
}

export function readBufferedRanges(value: unknown): Array<{ start: number; end: number }> {
  if (!value || typeof value !== 'object') return [];
  const range = value as { length?: unknown; start?: (index: number) => number; end?: (index: number) => number };
  const length = Number(range.length);
  if (!Number.isFinite(length) || length <= 0 || typeof range.start !== 'function' || typeof range.end !== 'function') {
    return [];
  }
  const ranges: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < length; index += 1) {
    try {
      const start = range.start(index);
      const end = range.end(index);
      if (!Number.isFinite(start) || !Number.isFinite(end)) break;
      ranges.push({ start, end });
    } catch {
      break;
    }
  }
  return ranges;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Accepts a bridge snapshot. A non-array `buffered` is rejected so it cannot be cached. */
export function coerceTencentWasmSnapshot(value: unknown): TencentWasmSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const state = value as Record<string, unknown>;
  if (typeof state.paused !== 'boolean' || typeof state.ended !== 'boolean' || typeof state.seeking !== 'boolean'
      || typeof state.muted !== 'boolean' || typeof state.pictureInPicture !== 'boolean') return null;
  if (!finiteNumber(state.currentTime) || !finiteNumber(state.duration) || !finiteNumber(state.volume)
      || !finiteNumber(state.playbackRate) || !finiteNumber(state.readyState)) return null;
  if (!Array.isArray(state.buffered)) return null;
  const buffered: Array<{ start: number; end: number }> = [];
  for (const range of state.buffered) {
    if (!range || typeof range !== 'object') return null;
    const pair = range as { start?: unknown; end?: unknown };
    if (!finiteNumber(pair.start) || !finiteNumber(pair.end)) return null;
    buffered.push({ start: pair.start, end: pair.end });
  }
  return {
    paused: state.paused,
    ended: state.ended,
    seeking: state.seeking,
    currentTime: state.currentTime,
    duration: state.duration,
    volume: Math.min(1, Math.max(0, state.volume)),
    muted: state.muted,
    playbackRate: state.playbackRate > 0 ? state.playbackRate : 1,
    readyState: state.readyState,
    buffered,
    pictureInPicture: state.pictureInPicture
  };
}

export function emptyWasmSnapshot(): TencentWasmSnapshot {
  return {
    paused: true,
    ended: false,
    seeking: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    muted: false,
    playbackRate: 1,
    readyState: 0,
    buffered: [],
    pictureInPicture: false
  };
}

export type WasmApi = HTMLElement & {
  play?: () => Promise<unknown> | unknown;
  pause?: () => void;
  paused?: boolean;
  ended?: boolean;
  seeking?: boolean;
  currentTime?: number;
  duration?: number;
  volume?: number;
  muted?: boolean;
  playbackRate?: number;
  readyState?: number;
  buffered?: unknown;
  requestPictureInPicture?: () => unknown;
  supportPictureInPicture?: () => boolean;
};

export function tencentWasmApiVisible(element: Element | null | undefined): element is WasmApi {
  if (!isTencentWasmPlayerElement(element)) return false;
  const host = element as WasmApi;
  return typeof host.play === 'function'
    && typeof host.pause === 'function'
    && typeof host.paused === 'boolean'
    && typeof host.currentTime === 'number';
}

export function readTencentWasmSnapshot(element: WasmApi): TencentWasmSnapshot {
  let pictureInPicture = typeof element.requestPictureInPicture === 'function';
  if (pictureInPicture && typeof element.supportPictureInPicture === 'function') {
    try {
      pictureInPicture = element.supportPictureInPicture() === true;
    } catch {
      pictureInPicture = false;
    }
  }
  return {
    paused: Boolean(element.paused),
    ended: Boolean(element.ended),
    seeking: Boolean(element.seeking),
    currentTime: Number(element.currentTime) || 0,
    duration: Number(element.duration) || 0,
    volume: Math.min(1, Math.max(0, Number(element.volume) || 0)),
    muted: Boolean(element.muted),
    playbackRate: Number(element.playbackRate) || 1,
    readyState: Number(element.readyState) || 0,
    buffered: readBufferedRanges(element.buffered),
    pictureInPicture
  };
}

export const TENCENT_WASM_MEDIA_EVENTS: readonly TencentWasmMediaEvent[] = MEDIA_EVENTS;
