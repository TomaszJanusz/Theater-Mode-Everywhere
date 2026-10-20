const counts = new Map<string, number>();

/**
 * Records a failure of our own side-effect inside a page-facing wrapper. The page call itself
 * has already succeeded or is about to run untouched, so nothing is rethrown. Warns once per
 * kind (never per call) with a stable prefix, so a broken hook is visible without DevTools luck.
 * Local only: no reporting leaves the page.
 */
export function noteWrapperFailure(kind: string, error: unknown): void {
  const seen = (counts.get(kind) ?? 0) + 1;
  counts.set(kind, seen);
  if (seen !== 1) return;
  // Page code owns `console` and may have replaced or removed it: reporting must never throw.
  try {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Theater Everywhere] wrapper failure (${kind}): ${message}`);
  } catch { /* diagnostics only */ }
}

export function wrapperFailureCount(kind: string): number {
  return counts.get(kind) ?? 0;
}
