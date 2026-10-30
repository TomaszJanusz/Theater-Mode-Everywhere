import { readBoundedBytes } from './bounded-body';

/** A host Blob body is metadata only if it is read promptly; a stalled read is dropped, never published later. */
export const BLOB_READ_TIMEOUT_MS = 15_000;

/**
 * Reads a host Blob as UTF-8 text through the bounded stream reader: at most `maxBytes`, within the deadline, and
 * only while the page visit it began in lasts (`visit()` returns the same signal). The visit's end or the deadline
 * cancels the reader, which removes its own listeners; a late chunk or completion afterwards is ignored. Resolves
 * to null for anything not read in full; rejects only if the Blob cannot be streamed.
 */
export async function readCurrentBlobText(blob: Blob, maxBytes: number, visit: () => AbortSignal): Promise<string | null> {
  if (blob.size > maxBytes) return null;
  const started = visit();
  const buffer = await readBoundedBytes({ body: blob.stream() }, maxBytes, started, BLOB_READ_TIMEOUT_MS, () => visit() === started);
  return buffer && new TextDecoder().decode(buffer);
}
