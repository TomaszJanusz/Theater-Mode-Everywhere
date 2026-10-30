/**
 * Isolated -> MAIN requests that expect a correlated reply (media probe, provider probe, Twitch and
 * YouTube caption toggles), and the provider probe's reply. Firefox hides objects created in the content-script compartment from page
 * code (`Permission denied to access property`), so each `detail` crosses worlds as a JSON
 * string and MAIN validates it on receipt. A request that does not parse is dropped, so a
 * stale or foreign dispatch can never change page state or be answered.
 */
const MAX_REQUEST_CHARS = 1000;
const MAX_FIELD_CHARS = 200;

function parseRecord(raw: unknown, maxChars = MAX_REQUEST_CHARS): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw.length > maxChars) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
}

function requestString(value: unknown): string | null {
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
  const record = parseRecord(raw);
  return record ? requestNumber(record.requestId) : null;
}

export const PROBE_ASYNC_EVENT = 'theater-everywhere-probe-async';
export const PROBE_ASYNC_REPLY_EVENT = `${PROBE_ASYNC_EVENT}-reply`;

/** A registered provider's asynchronous probe; `provider` is looked up in MAIN's own registry. */
export type ProbeAsyncRequest = { requestId: number; provider: string };

/** MAIN -> isolated. `value` is the provider's own snapshot, still unvalidated: the provider parses it. */
export type ProbeAsyncReply = ProbeAsyncRequest & { value: unknown };

/** Snapshots carry metadata (track lists, storyboards), never media; anything larger is dropped. */
const MAX_PROBE_REPLY_CHARS = 1024 * 1024;

export function encodeProbeAsyncRequest(request: ProbeAsyncRequest): string {
  return JSON.stringify(request);
}

/** `provider` is only shaped here: MAIN's registry lookup decides whether it names a registered provider. */
export function parseProbeAsyncRequest(raw: unknown): ProbeAsyncRequest | null {
  const record = parseRecord(raw);
  const requestId = record && requestNumber(record.requestId);
  const provider = record && requestString(record.provider);
  return requestId && provider ? { requestId, provider } : null;
}

/** A value that does not serialize or is too large is answered as null. */
export function encodeProbeAsyncReply(reply: ProbeAsyncReply): string {
  const { requestId, provider } = reply;
  try {
    const text = JSON.stringify({ requestId, provider, value: reply.value ?? null });
    if (text.length <= MAX_PROBE_REPLY_CHARS) return text;
  } catch {
    // Circular or BigInt values: answered as null below.
  }
  return JSON.stringify({ requestId, provider, value: null });
}

/** The reply's value when `raw` answers exactly `request`, else null: a reply to another request or provider never resolves this one. */
export function parseProbeAsyncReply(raw: unknown, request: ProbeAsyncRequest): { value: unknown } | null {
  const record = parseRecord(raw, MAX_PROBE_REPLY_CHARS);
  return record?.requestId === request.requestId && record.provider === request.provider && 'value' in record ? { value: record.value } : null;
}

export type TwitchCaptionsRequest = { enabled: boolean; requestId: string };

export function encodeTwitchCaptions(request: TwitchCaptionsRequest): string {
  return JSON.stringify(request);
}

export function parseTwitchCaptions(raw: unknown): TwitchCaptionsRequest | null {
  const record = parseRecord(raw);
  const requestId = record && requestString(record.requestId);
  if (!record || !requestId || typeof record.enabled !== 'boolean') return null;
  return { enabled: record.enabled, requestId };
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
  const record = parseRecord(raw);
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
