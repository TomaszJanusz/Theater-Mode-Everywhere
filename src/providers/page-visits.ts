/**
 * The page visits a provider's MAIN reads belong to. A route change to other content (a new `key`) starts the next
 * visit and aborts the requests of the last, so a pending read never answers a later visit, including a return to the
 * same content (A→B→A). The provider calls `note` on its route events and `end` when the page hides.
 */
export function createPageVisits(key: () => string) {
  let current: { key: string; controller: AbortController } | null = null;
  const visit = () => current ??= { key: key(), controller: new AbortController() };
  const next = (force: boolean) => {
    if (!force && current?.key === key()) return;
    current?.controller.abort();
    current = null;
    visit();
  };
  return {
    /** An opaque token of the current visit: compare it to tell whether a read still belongs to it. */
    current: (): object => visit(),
    note: () => next(false),
    end: () => next(true),
    /** Aborts after `ms` or when the current visit ends. */
    signal(ms: number): AbortSignal {
      const visitSignal = visit().controller.signal;
      const controller = new AbortController();
      const abort = () => {
        clearTimeout(timer);
        visitSignal.removeEventListener('abort', abort);
        controller.abort();
      };
      const timer = setTimeout(abort, ms);
      visitSignal.addEventListener('abort', abort);
      return controller.signal;
    }
  };
}

/** `pending`'s result for one waiter, or null as soon as its `signal` aborts; the read itself goes on for the others. */
export function untilAborted<T>(pending: Promise<T | null>, signal?: AbortSignal): Promise<T | null> {
  if (!signal) return pending;
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const abort = () => resolve(null);
    signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, () => resolve(null)).finally(() => signal.removeEventListener('abort', abort));
  });
}
