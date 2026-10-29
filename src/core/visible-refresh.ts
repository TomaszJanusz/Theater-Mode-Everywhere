import { measureNextFrame, type FrameMeasure } from './frame-batch';

export type VisibleRefresh = { request(): void; refresh(): void; dispose(): void };

/**
 * Coalesced reads with a bounded fallback; hidden documents do no scheduled work. Requested and
 * fallback reads run in the frame's shared read phase: writes a read returns are applied after every
 * other reader of that frame has measured. `refresh` reads and writes at once.
 */
export function createVisibleRefresh(doc: Document, read: FrameMeasure, options: {
  active?: () => boolean;
  pollMs?: number;
  events?: readonly string[];
} = {}): VisibleRefresh {
  const view = doc.defaultView!;
  let disposed = false;
  let cancelFrame: (() => void) | null = null;
  let timer = 0;
  let generation = 0;
  const cancel = () => {
    cancelFrame?.();
    cancelFrame = null;
    view.clearTimeout(timer);
    timer = 0;
  };
  const rearm = () => {
    if (disposed || doc.hidden) return;
    if (options.active?.() === false) { view.clearTimeout(timer); timer = 0; }
    else if (!timer) timer = view.setTimeout(() => { timer = 0; request(); }, Math.max(1000, options.pollMs ?? 1000));
  };
  const measure = (): (() => void) | void => {
    if (disposed || doc.hidden) return;
    cancelFrame?.();
    cancelFrame = null;
    const current = ++generation;
    const write = read();
    if (typeof write !== 'function') { rearm(); return; }
    return () => {
      // A newer read, such as a synchronous refresh from another reader's write, supersedes this one.
      if (disposed || current !== generation) return;
      write();
      rearm();
    };
  };
  const refresh = () => { measure()?.(); };
  const request = () => {
    if (disposed || doc.hidden || cancelFrame) return;
    cancelFrame = measureNextFrame(view, () => { cancelFrame = null; return measure(); });
  };
  const visibility = () => { cancel(); if (!doc.hidden) refresh(); };
  doc.addEventListener('visibilitychange', visibility);
  for (const event of options.events ?? []) view.addEventListener(event, request, true);
  return {
    request, refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel();
      doc.removeEventListener('visibilitychange', visibility);
      for (const event of options.events ?? []) view.removeEventListener(event, request, true);
    }
  };
}
