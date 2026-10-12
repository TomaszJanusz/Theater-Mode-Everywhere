export type VisibleRefresh = { request(): void; refresh(): void; dispose(): void };

/** Coalesced reads with a bounded fallback; hidden documents do no scheduled work. */
export function createVisibleRefresh(doc: Document, read: () => void, options: {
  active?: () => boolean;
  pollMs?: number;
  events?: readonly string[];
} = {}): VisibleRefresh {
  const view = doc.defaultView!;
  let disposed = false;
  let frame = 0;
  let timer = 0;
  const cancel = () => {
    view.cancelAnimationFrame(frame);
    view.clearTimeout(timer);
    frame = timer = 0;
  };
  const refresh = () => {
    if (disposed || doc.hidden) return;
    if (frame) view.cancelAnimationFrame(frame);
    frame = 0;
    read();
    if (disposed || doc.hidden) return;
    if (options.active?.() === false) { view.clearTimeout(timer); timer = 0; }
    else if (!timer) timer = view.setTimeout(() => { timer = 0; refresh(); }, Math.max(1000, options.pollMs ?? 1000));
  };
  const request = () => {
    if (disposed || doc.hidden || frame) return;
    frame = view.requestAnimationFrame(() => { frame = 0; refresh(); });
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
