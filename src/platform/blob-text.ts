import { readBoundedBytes } from './bounded-body';

/** A host Blob body is metadata only if it is read promptly; a stalled read is dropped, never published later. */
export const BLOB_READ_TIMEOUT_MS = 15_000;

/**
 * Reads a host Blob as UTF-8 text through the bounded stream reader: at most `maxBytes`, within the deadline, and
 * only while `visit` (the page visit the read began in) lasts. Its end or the deadline cancels the reader, which
 * removes its own listeners; a late chunk or completion afterwards is ignored. Null for anything not read in full.
 */
export async function readCurrentBlobText(blob: Blob, maxBytes: number, visit: AbortSignal, timeoutMs = BLOB_READ_TIMEOUT_MS): Promise<string | null> {
  if (blob.size > maxBytes) return null;
  try {
    const buffer = await readBoundedBytes({ body: blob.stream() }, maxBytes, visit, timeoutMs, () => !visit.aborted);
    return buffer && !visit.aborted ? new TextDecoder().decode(buffer) : null;
  } catch {
    return null;
  }
}
