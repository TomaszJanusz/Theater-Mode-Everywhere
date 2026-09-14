import { FRAME_CHANNEL, FRAME_PROTOCOL_V, createSessionId } from './frame-messages';

export type WorldMessageType = 'PAGE_FETCH' | 'PAGE_FETCH_RESULT';

export type WorldEnvelope = {
  v: typeof FRAME_PROTOCOL_V;
  channel: typeof FRAME_CHANNEL;
  requestId: string;
  origin: string;
  nonce: string;
  type: WorldMessageType;
  payload: Record<string, unknown>;
};

function currentOrigin(): string {
  try {
    if (typeof window !== 'undefined' && window.location && window.location.origin) {
      return window.location.origin;
    }
  } catch {
    // Node tests and detached windows have no location.
  }
  return '';
}

export function createWorldMessage(
  type: WorldMessageType,
  payload: Record<string, unknown>,
  requestId = createSessionId(),
  nonce = createSessionId(),
  origin = currentOrigin()
): WorldEnvelope {
  return {
    v: FRAME_PROTOCOL_V,
    channel: FRAME_CHANNEL,
    requestId,
    origin,
    nonce,
    type,
    payload
  };
}

export function parseWorldMessage(data: unknown): WorldEnvelope | null {
  if (!data || typeof data !== 'object') return null;
  const msg = data as Record<string, unknown>;
  if (msg.channel !== FRAME_CHANNEL || msg.v !== FRAME_PROTOCOL_V) return null;
  if (typeof msg.requestId !== 'string' || !msg.requestId) return null;
  if (typeof msg.origin !== 'string' || !msg.origin) return null;
  if (typeof msg.nonce !== 'string' || !msg.nonce) return null;
  if (msg.type !== 'PAGE_FETCH' && msg.type !== 'PAGE_FETCH_RESULT') return null;
  const payload = msg.payload;
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (msg.type === 'PAGE_FETCH' && typeof (payload as Record<string, unknown>).url !== 'string') return null;
  return {
    v: FRAME_PROTOCOL_V,
    channel: FRAME_CHANNEL,
    requestId: msg.requestId,
    origin: msg.origin,
    nonce: msg.nonce,
    type: msg.type,
    payload: payload as Record<string, unknown>
  };
}

export function parseLegacyWorldFetch(data: unknown): WorldEnvelope | null {
  if (!data || typeof data !== 'object') return null;
  const msg = data as Record<string, unknown>;
  if (msg.type !== 'theater-everywhere-media-fetch') return null;
  if (typeof msg.url !== 'string' || !msg.url) return null;
  return createWorldMessage(
    'PAGE_FETCH',
    { url: msg.url, legacy: true },
    typeof msg.requestId === 'string' && msg.requestId ? msg.requestId : String(msg.requestId ?? createSessionId()),
    'legacy',
    'legacy'
  );
}

export function readWorldEnvelope(data: unknown): WorldEnvelope | null {
  return parseWorldMessage(data) || parseLegacyWorldFetch(data);
}

export function isSameWindowMessage(event: MessageEvent): boolean {
  return event.source === window;
}
