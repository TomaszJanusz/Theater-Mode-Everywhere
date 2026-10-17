/** Window event published by the MAIN-world hook below, which isolated-world listeners can observe. */
export const PATREON_NAVIGATE_EVENT = 'theater-everywhere-patreon-navigate';

const HISTORY_HOOKED = Symbol.for('theater-everywhere.patreon-history');

/**
 * Patreon is a pushState SPA: `popstate` and `hashchange` never fire when a feed link opens a post,
 * and the isolated world cannot see page-world history calls. Publishes one event per route change.
 */
export function installPatreonNavigation(): void {
  const historyRef = window.history as History & { [HISTORY_HOOKED]?: true };
  if (historyRef[HISTORY_HOOKED]) return;
  const wrap = (original: History['pushState']) => function (this: History, ...args: Parameters<History['pushState']>) {
    const result = original.apply(this, args);
    window.dispatchEvent(new Event(PATREON_NAVIGATE_EVENT));
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
