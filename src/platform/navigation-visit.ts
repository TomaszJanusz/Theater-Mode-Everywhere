type VisitWindow = Pick<Window, 'addEventListener'> & { history: History; location: { href: string }; navigation?: EventTarget };

/**
 * A committed navigation: a new entry (`push`, also a reload), a `replace`, back/forward (`traverse`), a `hash` change,
 * page `hide`/`show`, or `unseen` when the host replaced the history wrappers and navigations may have gone unobserved.
 */
export type NavigationCommit = 'push' | 'replace' | 'traverse' | 'hash' | 'hide' | 'show' | 'unseen';

export type NavigationObserver = {
  subscribe(listener: (commit: NavigationCommit) => void): () => void;
  /** Re-checks the history wrappers: if the host replaced either, re-installs them and reports `unseen`. */
  check(): void;
};

const observers = new WeakMap<object, NavigationObserver>();

/**
 * The page's committed navigations, observed once per window: the first caller installs the watcher, and every later
 * caller shares it, so history is wrapped at most once and only on pages that need it.
 *
 * With the Navigation API every committed entry change is seen, whichever method or API made it. Without it (Firefox
 * versions our minimum still allows) the history methods are wrapped, and `check`, which readers call at their start,
 * for each chunk and at completion, notices a host that replaced either. Residual without the Navigation API: an
 * A→B→A round trip through a native history method the host reached without replacing the property
 * (`History.prototype.pushState.call(history, …)`) goes unseen.
 */
export function navigationObserver(win: VisitWindow = window): NavigationObserver {
  const existing = observers.get(win);
  if (existing) return existing;
  const { history, navigation } = win;
  const listeners = new Set<(commit: NavigationCommit) => void>();
  const emit = (commit: NavigationCommit) => { for (const listener of [...listeners]) listener(commit); };
  const events = { popstate: 'traverse', hashchange: 'hash', pagehide: 'hide', pageshow: 'show' } as const;
  for (const [type, commit] of Object.entries(events)) win.addEventListener(type, () => emit(commit), true);
  // Without the Navigation API these wrappers stand in; `own` holds what was installed, to notice a replacement.
  const names = ['pushState', 'replaceState'] as const;
  const own: Partial<Record<(typeof names)[number], unknown>> = {};
  const cover = () => {
    for (const name of names) {
      const original = history[name];
      try {
        history[name] = function (this: History, ...args: Parameters<History['pushState']>) {
          const result = original.apply(this, args);
          emit(name === 'pushState' ? 'push' : 'replace');
          return result;
        };
      } catch {
        // Sealed history: the events and the readers' own URL checks remain.
      }
      own[name] = history[name];
    }
  };
  if (navigation) {
    // The entry is already current here.
    const kinds: Record<string, NavigationCommit> = { replace: 'replace', traverse: 'traverse' };
    navigation.addEventListener('currententrychange', event => {
      emit(kinds[(event as Event & { navigationType: string }).navigationType] ?? 'push');
    });
  } else cover();
  const observer: NavigationObserver = {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    check() {
      if (navigation || names.every(name => history[name] === own[name])) return;
      cover();
      emit('unseen');
    }
  };
  observers.set(win, observer);
  return observer;
}

/**
 * The page visit, as an AbortSignal that aborts when the visit ends; work begun in a visit is current only while
 * `visit()` still returns the signal it began with. A visit ends on a committed navigation (push, traverse, reload,
 * or a replace that moves the URL; a return to the same URL is a new visit), a URL that differs from the visit's,
 * back/forward, a hash change and page hide/show. A state-only `replaceState` keeps the visit. `navigationObserver`
 * states what is observed and its residual gap; a host that replaced the history wrappers ends the visit.
 */
export function installVisitSignal(win: VisitWindow = window): () => AbortSignal {
  const { location } = win;
  const observer = navigationObserver(win);
  let visit = new AbortController();
  let href = location.href;
  const next = () => {
    visit.abort();
    visit = new AbortController();
    href = location.href;
  };
  // A replace that kept the visit's URL only changed state.
  const moved = () => { if (location.href !== href) next(); };
  observer.subscribe(commit => (commit === 'replace' ? moved : next)());
  return () => {
    observer.check();
    moved();
    return visit.signal;
  };
}
