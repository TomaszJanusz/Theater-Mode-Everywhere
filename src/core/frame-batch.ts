/** Reads layout or host state and returns the DOM writes it decided on, if any. */
export type FrameMeasure = () => (() => void) | void;

type Entry = { measure: FrameMeasure; live: boolean };
type Batch = {
  entries: Entry[];
  /** The animation frame that arms the observer, or the fallback frame once it is armed. */
  frame: number;
  observer: ResizeObserver | null;
  armed: boolean;
};

const batches = new WeakMap<Window, Batch>();

/**
 * Runs `measure` in the next frame's read phase. Every measurement queued for that frame runs
 * before any of the writes they return. While a host such as YouTube rebuilds its page, the first
 * layout read pays for its pending restyle and each read after another reader's write forces one
 * more; one read phase per frame lets the readers share a single style and layout.
 *
 * The phase starts after the browser's own style and layout of the frame, so the reads find them
 * clean: a resize observation of the root, armed from an animation frame, is delivered after layout
 * and before paint. Writes still reach that frame's paint. A request made while a phase runs, or
 * from another resize observer callback, waits for the next frame: observing the root then would
 * leave the observation undelivered. A document that does not lay out runs the phase from the
 * following animation frame instead.
 *
 * Returns a cancel. A cancelled entry neither measures nor writes, even when a write earlier in the
 * same phase cancels it after its measurement.
 */
export function measureNextFrame(view: Window, measure: FrameMeasure): () => void {
  let batch = batches.get(view);
  if (!batch) {
    batch = { entries: [], frame: 0, observer: null, armed: false };
    batches.set(view, batch);
  }
  const queued = batch;
  const entry: Entry = { measure, live: true };
  queued.entries.push(entry);
  if (!queued.frame) arm(view, queued);
  return () => {
    entry.live = false;
    // A frame left with nothing to measure is not requested at all, e.g. once a document hides.
    if (queued.entries.every(other => !other.live)) {
      disarm(view, queued);
      queued.entries = [];
    }
  };
}

function arm(view: Window, batch: Batch): void {
  batch.frame = view.requestAnimationFrame(() => {
    const root = view.document.documentElement;
    const Observer = (view as Window & typeof globalThis).ResizeObserver as typeof ResizeObserver | undefined;
    if (!root || typeof Observer !== 'function') {
      batch.frame = 0;
      run(batch);
      return;
    }
    const observer = batch.observer ??= new Observer(() => { disarm(view, batch); run(batch); });
    observer.observe(root);
    batch.armed = true;
    batch.frame = view.requestAnimationFrame(() => { disarm(view, batch); run(batch); });
  });
}

function disarm(view: Window, batch: Batch): void {
  if (batch.frame) view.cancelAnimationFrame(batch.frame);
  batch.frame = 0;
  // Observing only while armed: the root's own size changes never start a phase.
  if (batch.armed) batch.observer?.disconnect();
  batch.armed = false;
}

function run(batch: Batch): void {
  const entries = batch.entries;
  batch.entries = [];
  const writes: Array<{ entry: Entry; write: () => void }> = [];
  for (const entry of entries) {
    if (!entry.live) continue;
    try {
      const write = entry.measure();
      if (typeof write === 'function') writes.push({ entry, write });
    } catch (error) {
      report(error);
    }
  }
  for (const { entry, write } of writes) {
    if (!entry.live) continue;
    try { write(); } catch (error) { report(error); }
  }
}

// One failing reader must not drop the other readers' writes; the error still surfaces.
function report(error: unknown): void {
  if (typeof reportError === 'function') reportError(error);
  else setTimeout(() => { throw error; });
}
