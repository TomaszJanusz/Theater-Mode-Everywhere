/** Window event published by the MAIN-world hook below, which isolated-world listeners can observe. */
export const BILIBILI_NAVIGATE_EVENT = 'theater-everywhere-bilibili-navigate';

const HISTORY_HOOKED = Symbol.for('theater-everywhere.bilibili-history');

/**
 * Bilibili is a pushState SPA: `popstate` and `hashchange` never fire when links switch videos or parts,
 * and the isolated world cannot see page-world history calls. Publishes one event per route change.
 */
export function installBilibiliNavigation(): void {
  const historyRef = window.history as History & { [HISTORY_HOOKED]?: true };
  if (historyRef[HISTORY_HOOKED]) return;
  const wrap = (original: History['pushState']) => function (this: History, ...args: Parameters<History['pushState']>) {
    const result = original.apply(this, args);
    window.dispatchEvent(new Event(BILIBILI_NAVIGATE_EVENT));
    return result;
  };
  try {
    historyRef.pushState = wrap(historyRef.pushState);
    historyRef.replaceState = wrap(historyRef.replaceState);
    Object.defineProperty(historyRef, HISTORY_HOOKED, { value: true });
  } catch {
    // Sealed history: entry from a feed link degrades to the next media event.
  }
}
