import { readBoundedBytes, type BoundedResponse } from './bounded-body';

/** A page read owns only its branch; navigation must not publish old metadata. */
export async function readPageResponseBytes(
  response: BoundedResponse,
  maxBytes: number,
  signal?: AbortSignal,
  isCurrent: () => boolean = () => true
): Promise<ArrayBuffer | null> {
  const href = window.location.href;
  const controller = new AbortController();
  const abort = () => controller.abort();
  const events = ['pagehide', 'popstate', 'yt-navigate-start'];
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  for (const event of events) window.addEventListener(event, abort);
  document.addEventListener('yt-navigate-start', abort);
  try {
    const current = () => window.location.href === href && isCurrent();
    const buffer = await readBoundedBytes(response, maxBytes, controller.signal, 15_000, current);
    return !controller.signal.aborted && current() ? buffer : null;
  } finally {
    signal?.removeEventListener('abort', abort);
    for (const event of events) window.removeEventListener(event, abort);
    document.removeEventListener('yt-navigate-start', abort);
  }
}
