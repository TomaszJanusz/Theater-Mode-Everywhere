import { readBoundedBytes, type BoundedResponse } from './bounded-body';

/**
 * A page read owns only its branch; navigation must not publish old metadata. `navigationStart` names the
 * host's own SPA navigation events (window or document), which abort the read like `popstate`.
 */
export async function readPageResponseBytes(
  response: BoundedResponse,
  maxBytes: number,
  signal?: AbortSignal,
  { isCurrent = () => true, navigationStart = [] }: { isCurrent?: () => boolean; navigationStart?: readonly string[] } = {}
): Promise<ArrayBuffer | null> {
  const href = window.location.href;
  const controller = new AbortController();
  const abort = () => controller.abort();
  const events = ['pagehide', 'popstate', ...navigationStart];
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  for (const event of events) window.addEventListener(event, abort);
  for (const event of navigationStart) document.addEventListener(event, abort);
  try {
    const current = () => window.location.href === href && isCurrent();
    const buffer = await readBoundedBytes(response, maxBytes, controller.signal, 15_000, current);
    return !controller.signal.aborted && current() ? buffer : null;
  } finally {
    signal?.removeEventListener('abort', abort);
    for (const event of events) window.removeEventListener(event, abort);
    for (const event of navigationStart) document.removeEventListener(event, abort);
  }
}
