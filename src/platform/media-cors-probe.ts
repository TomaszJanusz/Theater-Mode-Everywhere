const PROBE_TIMEOUT_MS = 8000;

/**
 * Whether the server answers a CORS request for this media URL, tested on a detached element so the
 * host's player never sees a failed load: hosts treat a source error on their own element as fatal.
 * Resolves false on refusal, timeout or abort.
 */
export function probeMediaCors(
  url: string,
  signal: AbortSignal,
  create: () => HTMLVideoElement = () => document.createElement('video')
): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const probe = create();
    let timer = 0;
    const finish = (ok: boolean) => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      probe.removeEventListener('loadedmetadata', onLoaded);
      probe.removeEventListener('error', onError);
      probe.removeAttribute('src');
      try { probe.load(); } catch { /* releasing the request is best effort */ }
      resolve(ok);
    };
    const onLoaded = () => finish(true);
    const onError = () => finish(false);
    const onAbort = () => finish(false);
    probe.addEventListener('loadedmetadata', onLoaded);
    probe.addEventListener('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
    timer = window.setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
    probe.muted = true;
    probe.preload = 'metadata';
    probe.crossOrigin = 'anonymous';
    probe.src = url;
  });
}
