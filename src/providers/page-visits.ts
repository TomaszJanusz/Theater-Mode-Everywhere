import type { NavigationObserver } from '../platform/navigation-visit';

/**
 * The page visits a provider's MAIN reads belong to. A committed navigation to other content (a new `key`) starts the
 * next visit and aborts the requests of the last, so a pending read never answers a later visit, including a return
 * to the same content (A→B→A). Navigations that keep the content, such as a tracking parameter or a hash, keep the
 * visit; page hide and navigations the observer may have missed (replaced history methods) always end it.
 */
export function createPageVisits(key: () => string) {
  let current: { key: string; controller: AbortController } | null = null;
  let observer: NavigationObserver | null = null;
  const start = () => current = { key: key(), controller: new AbortController() };
  const next = (force: boolean) => {
    if (!force && current?.key === key()) return;
    current?.controller.abort();
    start();
  };
  const visit = () => {
    observer?.check();
    // The key is resampled too, in case a navigation went unobserved.
    if (current?.key !== key()) next(true);
    return current ?? start();
  };
  return {
    /** An opaque token of the current visit: compare it to tell whether a read still belongs to it. */
    current: (): object => visit(),
    /** Follows the page's committed navigations; the provider's MAIN entry calls it once, at install. */
    follow(navigation: NavigationObserver): void {
      if (observer) return;
      observer = navigation;
      observer.subscribe(commit => next(commit === 'hide' || commit === 'unseen'));
    },
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
