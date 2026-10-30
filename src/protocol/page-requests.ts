/**
 * Isolated -> MAIN requests that expect a correlated reply (media probe, caption toggles; a provider's
 * own requests use the same parsers). Firefox hides objects created in the content-script compartment from page
 * code (`Permission denied to access property`), so each `detail` crosses worlds as a JSON
 * string and MAIN validates it on receipt. A request that does not parse is dropped, so a
 * stale or foreign dispatch can never change page state or be answered.
 */
const MAX_REQUEST_CHARS = 1000;
const MAX_FIELD_CHARS = 200;

export function parseRequestRecord(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw.length > MAX_REQUEST_CHARS) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
}

export function requestString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_FIELD_CHARS ? value : null;
}

/** Optional string field: `undefined` when absent, `null` when present but not a short string. */
function optionalString(value: unknown): string | undefined | null {
  return value === undefined ? undefined : requestString(value);
}

function requestNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function encodeProbeRequest(requestId: number): string {
  return JSON.stringify({ requestId });
}

/** Returns the probe's request id, else null. */
export function parseProbeRequest(raw: unknown): number | null {
  const record = parseRequestRecord(raw);
  return record ? requestNumber(record.requestId) : null;
}

export type YoutubeCaptionsRequest = {
  requestId: number;
  enabled: boolean;
  language?: string;
  /** `null` selects the default (non-ASR) track kind. */
  kind?: string | null;
  translation?: string;
};

export function encodeYoutubeCaptions(request: YoutubeCaptionsRequest): string {
  return JSON.stringify(request);
}

export function parseYoutubeCaptions(raw: unknown): YoutubeCaptionsRequest | null {
  const record = parseRequestRecord(raw);
  const requestId = record && requestNumber(record.requestId);
  if (!record || !requestId || typeof record.enabled !== 'boolean') return null;
  const request: YoutubeCaptionsRequest = { requestId, enabled: record.enabled };
  const language = optionalString(record.language);
  const translation = optionalString(record.translation);
  if (language === null || translation === null) return null;
  if (language !== undefined) request.language = language;
  if (translation !== undefined) request.translation = translation;
  if (record.kind === null) request.kind = null;
  else {
    const kind = optionalString(record.kind);
    if (kind === null) return null;
    if (kind !== undefined) request.kind = kind;
  }
  return request;
}
