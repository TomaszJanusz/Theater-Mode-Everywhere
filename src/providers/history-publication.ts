/**
 * pushState SPAs fire no `popstate` or `hashchange` on in-app navigation, and the isolated world
 * cannot see page-world history calls. Publishes one window event per route change from MAIN.
 */
export function publishHistoryChanges(eventName: string, markerKey: string): void {
  const marker = Symbol.for(markerKey);
  const historyRef = window.history as History & { [marker: symbol]: true };
  if (historyRef[marker]) return;
  const wrap = (original: History['pushState']) => function (this: History, ...args: Parameters<History['pushState']>) {
    const result = original.apply(this, args);
    window.dispatchEvent(new Event(eventName));
    return result;
  };
  try {
    historyRef.pushState = wrap(historyRef.pushState);
    historyRef.replaceState = wrap(historyRef.replaceState);
    Object.defineProperty(historyRef, marker, { value: true });
  } catch {
    // Sealed history: entry from an in-app link degrades to the next media event.
  }
}
