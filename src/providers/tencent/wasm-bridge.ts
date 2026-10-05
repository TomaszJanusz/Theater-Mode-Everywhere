import { rangesFromPairs, type PlaybackSurface } from '../../playback-surface';
import { createSessionId } from '../../protocol/frame-messages';
import { isTencentHost } from '../hosts';
import {
  TENCENT_WASM_MEDIA_EVENTS,
  coerceTencentWasmSnapshot,
  createWasmClock,
  emptyWasmSnapshot,
  isTencentWasmPlayerElement,
  readTencentWasmSnapshot,
  tencentWasmApiVisible,
  type TencentWasmSnapshot,
  type WasmApi
} from './wasm-player';

export const TENCENT_WASM_COMMAND_EVENT = 'theater-everywhere-tencent-wasm-command';
export const TENCENT_WASM_RESULT_EVENT = 'theater-everywhere-tencent-wasm-result';
export const TENCENT_WASM_MIRROR_EVENT = 'theater-everywhere-tencent-wasm-event';
const ELEMENT_ID_ATTR = 'data-te-wasm-id';

type WasmOp = 'snapshot' | 'play' | 'pause' | 'seek' | 'volume' | 'muted' | 'rate' | 'pip' | 'watch' | 'unwatch';

type WasmCommand = {
  requestId: string;
  elementId: string;
  op: WasmOp;
  value?: number | boolean;
};

type WasmMessage = {
  requestId?: string;
  elementId?: string;
  type?: string;
  failed?: boolean;
  state: TencentWasmSnapshot | null;
};

export type WasmTransport = {
  read(element: HTMLElement): TencentWasmSnapshot | null;
  command(element: HTMLElement, op: WasmOp, value?: number | boolean): void;
  play(element: HTMLElement): Promise<void>;
  subscribe(element: HTMLElement, onEvent: (type: string, state: TencentWasmSnapshot) => void): () => void;
};

function parseDetail(detail: unknown): WasmMessage | WasmCommand | null {
  if (typeof detail !== 'string') return null;
  try {
    const parsed = JSON.parse(detail) as WasmMessage & WasmCommand;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function elementId(element: HTMLElement): string {
  const existing = element.getAttribute(ELEMENT_ID_ATTR);
  if (existing && /^[\w-]{8,80}$/.test(existing)) return existing;
  const next = createSessionId();
  element.setAttribute(ELEMENT_ID_ATTR, next);
  return next;
}

function markedElement(id: string): WasmApi | null {
  if (!/^[\w-]{8,80}$/.test(id)) return null;
  const element = document.querySelector(`[${ELEMENT_ID_ATTR}="${id}"]`);
  return tencentWasmApiVisible(element) ? element : null;
}

function post(name: string, payload: unknown): void {
  window.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(payload) }));
}

type WasmEventTarget = {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
};

type WasmWatchRecord = { count: number; stops: Array<() => void> };

/** Refcounted media listeners. The last release removes them so exit and swap go quiet. */
export function createWasmEventWatch(events: readonly string[]) {
  const watches = new WeakMap<object, WasmWatchRecord>();
  return {
    watch(element: WasmEventTarget, emit: (type: string) => void): void {
      const current = watches.get(element);
      if (current) {
        current.count += 1;
        return;
      }
      const stops: Array<() => void> = [];
      for (const type of events) {
        const listener: EventListener = () => emit(type);
        element.addEventListener(type, listener);
        stops.push(() => element.removeEventListener(type, listener));
      }
      watches.set(element, { count: 1, stops });
    },
    /** Returns whether listeners remain after this release. */
    release(element: WasmEventTarget): boolean {
      const current = watches.get(element);
      if (!current) return false;
      current.count -= 1;
      if (current.count > 0) return true;
      for (const stop of current.stops) stop();
      watches.delete(element);
      return false;
    }
  };
}

const WASM_ELEMENT_ID = /^[\w-]{8,80}$/;

/** Finds a watched player by the id we assigned, including after it leaves the document. */
export function createWasmIdWatch(events: readonly string[]) {
  const mirrors = createWasmEventWatch(events);
  const byId = new Map<string, WasmEventTarget>();
  return {
    watch(id: string, element: WasmEventTarget, emit: (type: string) => void): void {
      if (!WASM_ELEMENT_ID.test(id)) return;
      byId.set(id, element);
      mirrors.watch(element, emit);
    },
    release(id: string): void {
      if (!WASM_ELEMENT_ID.test(id)) return;
      const element = byId.get(id);
      if (!element) return;
      if (!mirrors.release(element)) byId.delete(id);
    }
  };
}

const mirrors = createWasmIdWatch(TENCENT_WASM_MEDIA_EVENTS);

function watchElement(element: WasmApi): void {
  const id = elementId(element);
  mirrors.watch(id, element, (type) => {
    post(TENCENT_WASM_MIRROR_EVENT, {
      elementId: id,
      type,
      state: readTencentWasmSnapshot(element)
    });
  });
}

function releaseWatchedId(id: string): void {
  mirrors.release(id);
}

function startPlayback(element: WasmApi): Promise<void> {
  try {
    return Promise.resolve(element.play?.()).then(() => undefined);
  } catch (error) {
    return Promise.reject(error);
  }
}

function applyCommand(element: WasmApi, command: WasmCommand): void {
  try {
    if (command.op === 'pause') {
      element.pause?.();
    } else if (command.op === 'seek' && typeof command.value === 'number') {
      element.currentTime = command.value;
    } else if (command.op === 'volume' && typeof command.value === 'number') {
      element.volume = Math.min(1, Math.max(0, command.value));
    } else if (command.op === 'muted') {
      element.muted = command.value === true;
    } else if (command.op === 'rate' && typeof command.value === 'number' && command.value > 0) {
      element.playbackRate = command.value;
    } else if (command.op === 'pip') {
      // The fake element is not an HTMLMediaElement. Picture-in-Picture stays off.
      return;
    }
  } catch {
    // A synchronous player exception must not escape into the page.
  }
}

let bridgeInstalled = false;

/** Page-world bridge. The content script cannot see methods defined by this custom element. */
export function installTencentWasmBridge(): void {
  if (bridgeInstalled || typeof window === 'undefined' || !isTencentHost()) return;
  bridgeInstalled = true;
  window.addEventListener(TENCENT_WASM_COMMAND_EVENT, (event) => {
    const command = parseDetail((event as CustomEvent<string>).detail) as WasmCommand | null;
    if (!command?.requestId || !command.elementId || !command.op) return;
    if (command.op === 'unwatch') {
      releaseWatchedId(command.elementId);
      post(TENCENT_WASM_RESULT_EVENT, {
        requestId: command.requestId,
        elementId: command.elementId,
        state: null
      });
      return;
    }
    const element = markedElement(command.elementId);
    if (!element) {
      post(TENCENT_WASM_RESULT_EVENT, { requestId: command.requestId, state: null });
      return;
    }
    if (command.op === 'watch') watchElement(element);
    else if (command.op === 'play') {
      startPlayback(element).then(
        () => post(TENCENT_WASM_RESULT_EVENT, {
          requestId: command.requestId,
          elementId: command.elementId,
          state: readTencentWasmSnapshot(element)
        }),
        () => post(TENCENT_WASM_RESULT_EVENT, {
          requestId: command.requestId,
          elementId: command.elementId,
          state: null,
          failed: true
        })
      );
      return;
    } else if (command.op !== 'snapshot') applyCommand(element, command);
    post(TENCENT_WASM_RESULT_EVENT, {
      requestId: command.requestId,
      elementId: command.elementId,
      state: readTencentWasmSnapshot(element)
    });
  });
}

function requestPlayback(element: HTMLElement): Promise<void> {
  const requestId = createSessionId();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (failed: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener(TENCENT_WASM_RESULT_EVENT, onResult);
      if (failed) reject(new Error('wasm-play-failed'));
      else resolve();
    };
    const onResult = (event: Event) => {
      const message = parseDetail((event as CustomEvent<string>).detail) as WasmMessage | null;
      if (!message || message.requestId !== requestId) return;
      finish(message.failed === true || coerceTencentWasmSnapshot(message.state) == null);
    };
    const timer = window.setTimeout(() => finish(true), 5000);
    window.addEventListener(TENCENT_WASM_RESULT_EVENT, onResult);
    try {
      post(TENCENT_WASM_COMMAND_EVENT, {
        requestId,
        elementId: elementId(element),
        op: 'play'
      });
    } catch {
      finish(true);
    }
  });
}

function callBridge(element: HTMLElement, op: WasmOp, value?: number | boolean): TencentWasmSnapshot | null {
  const requestId = createSessionId();
  let snapshot: TencentWasmSnapshot | null = null;
  const onResult = (event: Event) => {
    const message = parseDetail((event as CustomEvent<string>).detail) as WasmMessage | null;
    const state = coerceTencentWasmSnapshot(message?.state);
    if (!message || message.requestId !== requestId || !state) return;
    snapshot = state;
  };
  window.addEventListener(TENCENT_WASM_RESULT_EVENT, onResult);
  try {
    post(TENCENT_WASM_COMMAND_EVENT, {
      requestId,
      elementId: elementId(element),
      op,
      value
    });
  } finally {
    window.removeEventListener(TENCENT_WASM_RESULT_EVENT, onResult);
  }
  return snapshot;
}

export function pageWasmTransport(): WasmTransport {
  return {
    read(element) {
      if (tencentWasmApiVisible(element)) return readTencentWasmSnapshot(element);
      return callBridge(element, 'snapshot');
    },
    command(element, op, value) {
      if (op === 'play') return;
      if (tencentWasmApiVisible(element)) {
        applyCommand(element, { requestId: '', elementId: elementId(element), op, value });
        return;
      }
      callBridge(element, op, value);
    },
    play(element) {
      if (tencentWasmApiVisible(element)) return startPlayback(element);
      return requestPlayback(element);
    },
    subscribe(element, onEvent) {
      if (tencentWasmApiVisible(element)) {
        const handlers = TENCENT_WASM_MEDIA_EVENTS.map((type) => {
          const handler = () => onEvent(type, readTencentWasmSnapshot(element));
          element.addEventListener(type, handler);
          return () => element.removeEventListener(type, handler);
        });
        return () => handlers.forEach((remove) => remove());
      }
      const id = elementId(element);
      const onMirror = (event: Event) => {
        const message = parseDetail((event as CustomEvent<string>).detail) as WasmMessage | null;
        const state = coerceTencentWasmSnapshot(message?.state);
        if (!message || message.elementId !== id || !message.type || !state) return;
        onEvent(message.type, state);
      };
      window.addEventListener(TENCENT_WASM_MIRROR_EVENT, onMirror);
      callBridge(element, 'watch');
      return () => {
        window.removeEventListener(TENCENT_WASM_MIRROR_EVENT, onMirror);
        callBridge(element, 'unwatch');
      };
    }
  };
}

export class TencentWasmSurface implements PlaybackSurface {
  readonly element: HTMLElement;
  readonly nativeMedia = null;
  logicalVolume?: number;
  lastAudibleVolume?: number;
  private cache: TencentWasmSnapshot;
  private pendingSeek: number | null = null;
  private readonly emitter = new EventTarget();
  private readonly clock: ReturnType<typeof createWasmClock>;
  private readonly stopEvents: () => void;
  private disposed = false;

  constructor(element: HTMLElement, private readonly transport: WasmTransport) {
    this.element = element;
    this.stopEvents = transport.subscribe(element, (type, state) => this.onMirror(type, state));
    this.cache = coerceTencentWasmSnapshot(transport.read(element)) || emptyWasmSnapshot();
    this.clock = createWasmClock({
      schedule: (fn, ms) => window.setTimeout(fn, ms),
      cancel: (id) => window.clearTimeout(id),
      poll: () => this.poll()
    });
    if (!this.cache.paused) this.clock.notePlaying();
  }

  get capabilities() {
    return {
      nativeMedia: false,
      textTracks: false,
      volumeBoost: false,
      pictureInPicture: false,
      objectFit: false
    };
  }

  get paused() { return this.cache.paused; }
  get ended() { return this.cache.ended; }
  get seeking() { return this.cache.seeking; }
  get currentTime() { return this.cache.currentTime; }
  set currentTime(value: number) {
    if (this.disposed) return;
    this.pendingSeek = value;
    this.cache.currentTime = value;
    this.cache.seeking = true;
    this.clock.noteSeek();
    this.transport.command(this.element, 'seek', value);
    this.dispatch('seeking');
  }
  get duration() { return this.cache.duration; }
  get volume() { return this.cache.volume; }
  set volume(value: number) {
    const next = Math.min(1, Math.max(0, value));
    this.cache.volume = next;
    this.transport.command(this.element, 'volume', next);
  }
  get muted() { return this.cache.muted; }
  set muted(value: boolean) {
    this.cache.muted = value;
    this.transport.command(this.element, 'muted', value);
  }
  get playbackRate() { return this.cache.playbackRate; }
  set playbackRate(value: number) {
    this.cache.playbackRate = value;
    this.transport.command(this.element, 'rate', value);
  }
  get readyState() { return this.cache.readyState; }
  get buffered() { return rangesFromPairs(this.cache.buffered); }

  play(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return this.transport.play(this.element).then(() => {
      if (this.disposed) return;
      this.cache.paused = false;
      this.clock.notePlaying();
      this.dispatch('play');
    });
  }

  pause(): void {
    if (this.disposed) return;
    this.cache.paused = true;
    this.clock.notePause();
    this.transport.command(this.element, 'pause');
    this.dispatch('pause');
  }

  requestPictureInPicture(): Promise<unknown> {
    return Promise.reject(new Error('picture-in-picture-unavailable'));
  }

  addEventListener(type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): void {
    this.emitter.addEventListener(type, listener, options);
  }

  removeEventListener(type: string, listener: EventListener, options?: boolean | EventListenerOptions): void {
    this.emitter.removeEventListener(type, listener, options);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clock.dispose();
    this.stopEvents();
  }

  private poll(): void {
    if (this.disposed) return;
    const state = coerceTencentWasmSnapshot(this.transport.read(this.element));
    if (!state) return;
    this.apply(state);
    this.dispatch('timeupdate');
    if (!this.cache.buffered.length) this.dispatch('progress');
    if (state.paused) this.clock.notePause();
  }

  private onMirror(type: string, state: TencentWasmSnapshot): void {
    if (this.disposed || !coerceTencentWasmSnapshot(state)) return;
    this.clock.noteEvent();
    this.apply(state);
    if (type === 'pause' || type === 'ended') this.clock.notePause();
    else if (type === 'play' || type === 'playing') this.clock.notePlaying();
    else if (type === 'seeking') this.clock.noteSeek();
    else if (type === 'seeked' && !state.paused) this.clock.notePlaying();
    this.dispatch(type);
  }

  private apply(state: TencentWasmSnapshot): void {
    const snapshot = coerceTencentWasmSnapshot(state);
    if (!snapshot) return;
    this.cache = { ...snapshot };
    if (this.pendingSeek == null) return;
    const arrived = Math.abs(state.currentTime - this.pendingSeek) <= 1.25;
    if (state.seeking && !arrived) {
      this.cache.currentTime = this.pendingSeek;
      return;
    }
    this.pendingSeek = null;
  }

  private dispatch(type: string): void {
    this.emitter.dispatchEvent(new Event(type));
  }
}

export function openTencentWasmSurface(element: HTMLElement, transport: WasmTransport = pageWasmTransport()): TencentWasmSurface {
  if (!isTencentWasmPlayerElement(element)) {
    throw new Error('not a tencent wasm player');
  }
  return new TencentWasmSurface(element, transport);
}
