import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFrameMessage } from '../../protocol/frame-messages';
import { isTrustedFrameEnvelope } from '../../protocol/frame-messages';
import { createWasmEventWatch, createWasmIdWatch, openTencentWasmSurface, type WasmTransport } from './wasm-bridge';
import {
  createWasmClock,
  emptyWasmSnapshot,
  isTencentWasmFrameDocument,
  isTencentWasmFrameUrl,
  ordinaryChildWindows,
  readTencentWasmHostToggle,
  replacementTencentWasmHost,
  selectTencentTheaterTarget
} from './wasm-player';

const WASM_URL = 'https://vm.gtimg.cn/thumbplayer/txv/wasm/1.0.53/fake-video-element-iframe.html';

describe('tencent wasm target selection', () => {
  it('prefers a real switchable video, then a usable fake, and drops the wasm-frame fallback', () => {
    const real = { id: 'video' } as unknown as HTMLElement;
    const fake = { id: 'wasm' } as unknown as HTMLElement;
    const empty = { id: 'empty' } as unknown as HTMLElement;
    assert.equal(selectTencentTheaterTarget({
      switchable: real,
      wasm: fake,
      fallback: empty,
      wasmFrameDocument: false
    }), real);
    assert.equal(selectTencentTheaterTarget({
      switchable: null,
      wasm: fake,
      fallback: empty,
      wasmFrameDocument: false
    }), fake);
    assert.equal(selectTencentTheaterTarget({
      switchable: null,
      wasm: null,
      fallback: empty,
      wasmFrameDocument: true
    }), null);
    assert.equal(selectTencentTheaterTarget({
      switchable: null,
      wasm: null,
      fallback: empty,
      wasmFrameDocument: false
    }), empty);
  });

  it('recognizes only the known wasm iframe document', () => {
    assert.equal(isTencentWasmFrameUrl(WASM_URL), true);
    assert.equal(isTencentWasmFrameDocument(WASM_URL), true);
    assert.equal(isTencentWasmFrameUrl('https://evil.example/fake-video-element-iframe.html'), false);
    assert.equal(isTencentWasmFrameUrl('https://vm.gtimg.cn/thumbplayer/txv/wasm/1.0.53/other.html'), false);
  });

  it('replaces a disconnected host and ignores a host that is still connected', () => {
    const first = { connected: true } as HTMLElement & { connected: boolean };
    const second = { connected: true } as HTMLElement & { connected: boolean };
    const third = { connected: false } as HTMLElement & { connected: boolean };
    const connected = (element: HTMLElement) => (element as HTMLElement & { connected: boolean }).connected;
    assert.equal(replacementTencentWasmHost(first, [first, second, third], connected), null);
    first.connected = false;
    assert.equal(replacementTencentWasmHost(first, [first, second, third], connected), second);
    second.connected = false;
    third.connected = true;
    assert.equal(replacementTencentWasmHost(second, [first, second, third], connected), third);
  });
});

describe('tencent wasm clock', () => {
  it('polls only while playing and stale, and stops on pause, seek, and dispose', () => {
    let now = 0;
    const scheduled: { fn: (() => void) | null } = { fn: null };
    let polls = 0;
    const clock = createWasmClock({
      intervalMs: 250,
      staleMs: 400,
      now: () => now,
      schedule: (fn) => {
        scheduled.fn = fn;
        return 1;
      },
      cancel: () => {
        scheduled.fn = null;
      },
      poll: () => {
        polls += 1;
      }
    });
    clock.notePlaying();
    assert.equal(typeof scheduled.fn, 'function');
    now = 100;
    scheduled.fn?.();
    assert.equal(polls, 0);
    now = 1000;
    scheduled.fn?.();
    assert.equal(polls, 1);
    clock.notePause();
    assert.equal(scheduled.fn, null);
    clock.notePlaying();
    clock.noteSeek();
    assert.equal(scheduled.fn, null);
    clock.noteEvent();
    clock.dispose();
    clock.notePlaying();
    assert.equal(scheduled.fn, null);
    assert.equal(polls, 1);
  });
});

describe('tencent wasm host toggle', () => {
  const wasmWindow = { name: 'wasm' };
  const foreignWindow = { name: 'cookie' };
  const host = {
    localName: 'fake-iframe-video',
    shadowRoot: {
      querySelector: () => ({ contentWindow: wasmWindow, src: WASM_URL })
    }
  };
  const root = {
    querySelectorAll(selector: string) {
      if (selector === 'fake-iframe-video') return [host];
      if (selector === 'iframe') return [{ contentWindow: wasmWindow }, { contentWindow: foreignWindow }];
      return [];
    }
  };
  const page = { hostname: 'v.qq.com', href: 'https://v.qq.com/x/cover/mzc00200803dr6b/c4102g9a01t.html', root };

  it('matches the shadow iframe and rejects a foreign frame, origin, page, and FRAME_ENTER', () => {
    const message = createFrameMessage('FRAME_HOST_TOGGLE', 'session', { action: 'fullscreen' }, 'nonce', 'https://vm.gtimg.cn');
    const accepted = readTencentWasmHostToggle({ source: wasmWindow, origin: 'https://vm.gtimg.cn', data: message }, page);
    assert.equal(accepted?.action, 'fullscreen');
    assert.equal(accepted?.host, host);
    assert.equal(readTencentWasmHostToggle({ source: foreignWindow, origin: 'https://vm.gtimg.cn', data: message }, page), null);
    assert.equal(readTencentWasmHostToggle({ source: wasmWindow, origin: 'https://evil.example', data: message }, page), null);
    assert.equal(readTencentWasmHostToggle({
      source: wasmWindow,
      origin: 'https://vm.gtimg.cn',
      data: message
    }, { ...page, hostname: 'example.com' }), null);
    const enter = createFrameMessage('FRAME_ENTER', 'session', {}, 'nonce', 'https://vm.gtimg.cn');
    assert.equal(readTencentWasmHostToggle({ source: wasmWindow, origin: 'https://vm.gtimg.cn', data: enter }, page), null);
    assert.equal(readTencentWasmHostToggle({
      source: wasmWindow,
      origin: 'https://vm.gtimg.cn',
      data: { ...message, nonce: '' }
    }, page), null);
    assert.deepEqual(ordinaryChildWindows(root), [foreignWindow]);
    assert.equal(isTrustedFrameEnvelope(message, {
      eventOrigin: 'https://vm.gtimg.cn',
      trustedOrigin: true,
      fromParent: false,
      fromChild: true,
      activeSessionId: 'session',
      activeNonce: 'nonce'
    }), false);
  });

  it('rejects a matching window whose iframe src is not the wasm document', () => {
    const wrong = {
      localName: 'fake-iframe-video',
      shadowRoot: {
        querySelector: () => ({ contentWindow: wasmWindow, src: 'https://evil.example/player.html' })
      }
    };
    const message = createFrameMessage('FRAME_HOST_TOGGLE', 'session', { action: 'toggle' }, 'nonce', 'https://evil.example');
    assert.equal(readTencentWasmHostToggle({
      source: wasmWindow,
      origin: 'https://evil.example',
      data: message
    }, {
      ...page,
      root: { querySelectorAll: () => [wrong] }
    }), null);
  });
});

describe('tencent wasm bridge lifetime', () => {
  function target() {
    const listeners = new Map<string, Set<EventListener>>();
    return {
      addEventListener(type: string, listener: EventListener) {
        const set = listeners.get(type) ?? new Set<EventListener>();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener(type: string, listener: EventListener) {
        listeners.get(type)?.delete(listener);
      },
      emit(type: string) {
        for (const listener of [...(listeners.get(type) ?? [])]) listener(new Event(type));
      }
    };
  }

  it('stops mirroring after the last release and can watch again', () => {
    const watch = createWasmEventWatch(['timeupdate']);
    const element = target();
    const seen: string[] = [];
    watch.watch(element, (type) => seen.push(type));
    watch.watch(element, () => seen.push('second'));
    element.emit('timeupdate');
    assert.deepEqual(seen, ['timeupdate']);
    watch.release(element);
    element.emit('timeupdate');
    assert.deepEqual(seen, ['timeupdate', 'timeupdate']);
    watch.release(element);
    element.emit('timeupdate');
    assert.deepEqual(seen, ['timeupdate', 'timeupdate']);
    watch.watch(element, (type) => seen.push(type));
    element.emit('timeupdate');
    assert.deepEqual(seen, ['timeupdate', 'timeupdate', 'timeupdate']);
  });

  it('releases a detached player by id without looking it up in the document', () => {
    const watch = createWasmIdWatch(['timeupdate']);
    const element = target();
    const seen: string[] = [];
    const id = 'detached-host-1';
    watch.watch(id, element, (type) => seen.push(type));
    watch.watch(id, element, () => seen.push('second'));
    element.emit('timeupdate');
    watch.release(id);
    element.emit('timeupdate');
    assert.deepEqual(seen, ['timeupdate', 'timeupdate']);
    watch.release(id);
    element.emit('timeupdate');
    assert.deepEqual(seen, ['timeupdate', 'timeupdate']);
    watch.release('not-a-watched-id');
    watch.watch('bad id', element, () => seen.push('ignored'));
    element.emit('timeupdate');
    assert.deepEqual(seen, ['timeupdate', 'timeupdate']);
  });

  it('keeps picture-in-picture off when the fake reports support', async () => {
    const commands: string[] = [];
    const transport: WasmTransport = {
      read: () => ({ ...emptyWasmSnapshot(), paused: true, pictureInPicture: true }),
      command: (_element, op) => { commands.push(op); },
      play: () => Promise.resolve(),
      subscribe: () => () => {}
    };
    const surface = openTencentWasmSurface({ localName: 'fake-iframe-video' } as HTMLElement, transport);
    assert.equal(surface.capabilities.pictureInPicture, false);
    await assert.rejects(() => surface.requestPictureInPicture(), /picture-in-picture-unavailable/);
    assert.deepEqual(commands, []);
    surface.dispose();
  });

  function pausedSnapshot(overrides: Partial<ReturnType<typeof emptyWasmSnapshot>> = {}) {
    return { ...emptyWasmSnapshot(), paused: true, duration: 120, ...overrides };
  }

  function openSurface(play: WasmTransport['play'] = () => Promise.resolve()) {
    let emit: (type: string, state: ReturnType<typeof emptyWasmSnapshot>) => void = () => {};
    const transport: WasmTransport = {
      read: () => pausedSnapshot(),
      command: () => {},
      play,
      subscribe: (_element, onEvent) => {
        emit = onEvent;
        return () => {};
      }
    };
    const surface = openTencentWasmSurface({ localName: 'fake-iframe-video' } as HTMLElement, transport);
    return { surface, emit };
  }

  it('drops a pending seek once the player settles away from the request', () => {
    const { surface, emit } = openSurface();
    surface.currentTime = 80;
    emit('timeupdate', pausedSnapshot({ currentTime: 10, seeking: true }));
    assert.equal(surface.currentTime, 80);
    emit('seeked', pausedSnapshot({ currentTime: 30, seeking: false }));
    assert.equal(surface.currentTime, 30);
    emit('timeupdate', pausedSnapshot({ currentTime: 31, seeking: false }));
    assert.equal(surface.currentTime, 31);
    surface.dispose();
  });

  it('stays paused when play() rejects and starts only after it resolves', async () => {
    const rejected = openSurface(() => Promise.reject(new Error('blocked')));
    await assert.rejects(() => rejected.surface.play(), /blocked/);
    assert.equal(rejected.surface.paused, true);
    rejected.surface.dispose();

    const previous = globalThis.window;
    globalThis.window = {
      setTimeout: ((fn: () => void, ms?: number) => setTimeout(fn, ms)) as typeof setTimeout,
      clearTimeout: ((id: ReturnType<typeof setTimeout>) => clearTimeout(id)) as typeof clearTimeout
    } as Window & typeof globalThis;
    try {
      const started = openSurface(() => Promise.resolve());
      const playing = started.surface.play();
      assert.equal(started.surface.paused, true);
      await playing;
      assert.equal(started.surface.paused, false);
      started.surface.dispose();
    } finally {
      if (previous === undefined) delete (globalThis as { window?: Window }).window;
      else globalThis.window = previous;
    }
  });
});
