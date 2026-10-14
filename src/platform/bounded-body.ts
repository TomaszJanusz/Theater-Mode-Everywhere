/** Only pass an owned fetch response, clone, or Blob stream, never the page's body. */
export type BoundedResponse = {
  headers?: { get(name: string): string | null };
  body?: ReadableStream<Uint8Array> | null;
};

function advertisedBytes(headers: BoundedResponse['headers']): number | null {
  const length = Number(headers?.get('content-length'));
  return Number.isFinite(length) && length >= 0 ? length : null;
}

export function advertisedOverCap(headers: BoundedResponse['headers'], maxBytes: number): boolean {
  const length = advertisedBytes(headers);
  return length != null && length > maxBytes;
}

export function abandonBody(body: ReadableStream<Uint8Array> | null | undefined): void {
  if (!body || typeof body.cancel !== 'function') return;
  try {
    void Promise.resolve(body.cancel()).catch(() => {});
  } catch {
    // Cancel can wait on another reader. Harvest must not.
  }
}

type StreamRead = { done: boolean; value?: Uint8Array; aborted: boolean };

function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal
): Promise<StreamRead> {
  if (signal?.aborted) return Promise.resolve({ done: true, aborted: true });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: StreamRead) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () => finish({ done: true, aborted: true });
    signal?.addEventListener('abort', onAbort);
    reader.read().then(
      (result) => finish({ done: Boolean(result.done), value: result.value, aborted: false }),
      () => finish({ done: true, aborted: true })
    );
  });
}

/**
 * Retains at most maxBytes while reading. The first overflowing chunk must
 * arrive to detect the limit; browser/tee buffers are outside this budget.
 * Crossing the cap drops every chunk, including the
 * one that overflowed, and cancels the reader without waiting on that promise.
 * A real body without a stream is rejected; arrayBuffer() is not a fallback.
 */
export async function readBoundedBytes(
  response: BoundedResponse,
  maxBytes: number,
  signal?: AbortSignal,
  timeoutMs?: number,
  isCurrent: () => boolean = () => true
): Promise<ArrayBuffer | null> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || signal?.aborted || !isCurrent()
    || advertisedOverCap(response.headers, maxBytes)) {
    abandonBody(response.body);
    return null;
  }
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') return null;
  const own = timeoutMs && timeoutMs > 0 ? new AbortController() : null;
  const timer = own ? setTimeout(() => own.abort(), timeoutMs) : null;
  const onAbort = () => own?.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const used = own?.signal ?? signal;
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = body.getReader();
  } catch {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    return null;
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  let early = false;
  try {
    while (!used?.aborted) {
      const next = await readStreamChunk(reader, used);
      if (next.aborted || used?.aborted || !isCurrent()) {
        early = true;
        break;
      }
      if (next.done) break;
      const value = next.value;
      if (!value?.byteLength) continue;
      if (received >= maxBytes || received + value.byteLength > maxBytes) {
        early = true;
        break;
      }
      // A small view can share a huge backing buffer or be reused by its source.
      chunks.push(value.slice());
      received += value.byteLength;
    }
  } catch {
    early = true;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    try {
      if (early || used?.aborted) void Promise.resolve(reader.cancel()).catch(() => {});
      reader.releaseLock();
    } catch {
      // Stopping this reader must not surface on the page's original response.
    }
  }
  if (early || used?.aborted || !isCurrent() || received === 0 || received > maxBytes) {
    chunks.length = 0;
    return null;
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  chunks.length = 0;
  return out.buffer;
}
