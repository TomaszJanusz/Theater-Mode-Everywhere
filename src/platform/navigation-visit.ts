type VisitWindow = Pick<Window, 'addEventListener'> & { history: History; location: { href: string } };

/**
 * The generation of the page visit, as an AbortSignal that aborts when the visit ends. A visit ends on a history
 * entry (`pushState`, or a `replaceState` that moves the URL), back/forward, a hash change or page hide; a return to
 * the same URL is a new visit, which a URL comparison cannot tell apart. Work begun in a visit carries its signal.
 */
export function installVisitSignal(win: VisitWindow = window): () => AbortSignal {
  let visit = new AbortController();
  const next = () => {
    visit.abort();
    visit = new AbortController();
  };
  for (const type of ['popstate', 'hashchange', 'pagehide']) win.addEventListener(type, next, true);
  const history = win.history;
  const wrap = (original: History['pushState'], always: boolean) => function (this: History, ...args: Parameters<History['pushState']>) {
    const before = win.location.href;
    const result = original.apply(this, args);
    if (always || win.location.href !== before) next();
    return result;
  };
  try {
    history.pushState = wrap(history.pushState, true);
    history.replaceState = wrap(history.replaceState, false);
  } catch {
    // Sealed history: back/forward, hash changes and page hide still end the visit.
  }
  return () => visit.signal;
}
