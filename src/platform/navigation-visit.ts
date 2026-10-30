type VisitWindow = Pick<Window, 'addEventListener'> & { history: History; location: { href: string }; navigation?: EventTarget };

/**
 * The page visit, as an AbortSignal that aborts when the visit ends; work begun in a visit is current only while
 * `visit()` still returns the signal it began with. A visit ends on a committed navigation (push, traverse, reload,
 * or a replace that moves the URL; a return to the same URL is a new visit), a URL that differs from the visit's,
 * back/forward, a hash change and page hide/show. A state-only `replaceState` keeps the visit.
 *
 * With the Navigation API every committed entry change is seen, whichever method or API made it. Without it (Firefox
 * versions our minimum still allows) the history methods are wrapped, and every `visit()` call, which a read makes at
 * its start, for each chunk and at completion, checks the wrappers are still in place: if the host replaced either,
 * the visit ends (so reads begun before cannot complete) and the wrappers are re-installed. Residual without the
 * Navigation API: an A→B→A round trip through a native history method the host reached without replacing the
 * property (`History.prototype.pushState.call(history, …)`) ends on the visit's URL and goes unseen.
 */
export function installVisitSignal(win: VisitWindow = window): () => AbortSignal {
  const { history, location, navigation } = win;
  let visit = new AbortController();
  let href = location.href;
  const next = () => {
    visit.abort();
    visit = new AbortController();
    href = location.href;
  };
  // A replace that kept the visit's URL only changed state.
  const moved = () => { if (location.href !== href) next(); };
  for (const type of ['popstate', 'hashchange', 'pagehide', 'pageshow']) win.addEventListener(type, next, true);
  // Without the Navigation API these wrappers stand in; `own` holds what was installed, to notice a replacement.
  const after = { pushState: next, replaceState: moved };
  const names = ['pushState', 'replaceState'] as const;
  const own: Partial<Record<keyof typeof after, unknown>> = {};
  const cover = () => {
    for (const name of names) {
      const original = history[name];
      try {
        history[name] = function (this: History, ...args: Parameters<History['pushState']>) {
          const result = original.apply(this, args);
          after[name]();
          return result;
        };
      } catch {
        // Sealed history: the URL comparison and events remain.
      }
      own[name] = history[name];
    }
  };
  if (navigation) {
    // The entry is already current here.
    navigation.addEventListener('currententrychange', event => {
      ((event as Event & { navigationType: string }).navigationType === 'replace' ? moved : next)();
    });
  } else cover();
  return () => {
    if (!navigation && names.some(name => history[name] !== own[name])) {
      cover();
      next();
    }
    moved();
    return visit.signal;
  };
}
