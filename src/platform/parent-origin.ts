export function discoverParentOrigin(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    if (window === window.top) return null;
  } catch {
    // Cross-origin top access throws; we are nested.
  }
  try {
    const ancestors = window.location.ancestorOrigins;
    if (ancestors && ancestors.length > 0) {
      return new URL(ancestors[0]).origin;
    }
  } catch {
    // Firefox and opaque origins omit ancestorOrigins.
  }
  try {
    if (typeof document !== 'undefined' && document.referrer) {
      return new URL(document.referrer).origin;
    }
  } catch {
    // Invalid referrer.
  }
  return null;
}

/**
 * Selects a parent postMessage target, rejecting conflicting origins and using a wildcard only
 * while neither a stored nor discoverable origin is available.
 */
export function resolveParentMessageTarget(stored: string | null, discovered: string | null): string | null {
  if (stored && discovered && stored !== discovered) return null;
  return stored || discovered || '*';
}
