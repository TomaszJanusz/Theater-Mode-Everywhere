/**
 * Hostname of the page, or null when a window exists but has no location.
 * Event-target stubs are not a provider host, and reading their hostname throws.
 */
export function providerHostname(): string | null {
  const candidate = (globalThis as { window?: { location?: { hostname?: unknown } } }).window;
  if (!candidate) return '';
  const hostname = candidate.location?.hostname;
  return typeof hostname === 'string' ? hostname : null;
}
