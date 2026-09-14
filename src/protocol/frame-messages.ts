export const FRAME_CHANNEL = 'theater-everywhere';
export const FRAME_PROTOCOL_V = 1 as const;

export type FrameMessageType =
  | 'FRAME_TOGGLE'
  | 'FRAME_ENTER'
  | 'FRAME_EXIT'
  | 'FRAME_EXITED'
  | 'PLAYBACK_COMMAND';

export type FrameEnvelope = {
  v: typeof FRAME_PROTOCOL_V;
  channel: typeof FRAME_CHANNEL;
  sessionId: string;
  requestId: string;
  origin: string;
  nonce: string;
  type: FrameMessageType;
  payload: Record<string, unknown>;
};

export type FrameTrustContext = {
  eventOrigin: string;
  fromParent: boolean;
  fromChild: boolean;
  activeSessionId: string | null;
  activeNonce: string | null;
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

export function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `te-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createFrameMessage(
  type: FrameMessageType,
  sessionId: string,
  payload: Record<string, unknown> = {},
  nonce = createSessionId(),
  origin = currentOrigin()
): FrameEnvelope {
  return {
    v: FRAME_PROTOCOL_V,
    channel: FRAME_CHANNEL,
    sessionId,
    requestId: createSessionId(),
    origin,
    nonce,
    type,
    payload
  };
}

function isFrameMessageType(value: unknown): value is FrameMessageType {
  return (
    value === 'FRAME_TOGGLE'
    || value === 'FRAME_ENTER'
    || value === 'FRAME_EXIT'
    || value === 'FRAME_EXITED'
    || value === 'PLAYBACK_COMMAND'
  );
}

export function parseFrameMessage(data: unknown): FrameEnvelope | null {
  if (!data || typeof data !== 'object') return null;
  const msg = data as Record<string, unknown>;
  if (msg.channel !== FRAME_CHANNEL || msg.v !== FRAME_PROTOCOL_V) return null;
  if (typeof msg.sessionId !== 'string' || !msg.sessionId) return null;
  if (typeof msg.requestId !== 'string' || !msg.requestId) return null;
  if (typeof msg.origin !== 'string' || !msg.origin) return null;
  if (typeof msg.nonce !== 'string' || !msg.nonce) return null;
  if (!isFrameMessageType(msg.type)) return null;
  const payload = msg.payload;
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  return {
    v: FRAME_PROTOCOL_V,
    channel: FRAME_CHANNEL,
    sessionId: msg.sessionId,
    requestId: msg.requestId,
    origin: msg.origin,
    nonce: msg.nonce,
    type: msg.type,
    payload: payload as Record<string, unknown>
  };
}

export function readFrameEnvelope(data: unknown): FrameEnvelope | null {
  return parseFrameMessage(data);
}

export function isTrustedFrameSource(
  event: MessageEvent,
  childWindows: Array<Window | null | undefined>
): { fromParent: boolean; fromChild: boolean } {
  let fromParent = false;
  try {
    fromParent = window !== window.top && event.source === window.parent;
  } catch {
    fromParent = event.source === window.parent;
  }
  const fromChild = childWindows.some((win) => Boolean(win) && event.source === win);
  return { fromParent, fromChild };
}

export function originMatchesIframe(event: MessageEvent, iframe: HTMLIFrameElement): boolean {
  try {
    if (!iframe.src) return false;
    return event.origin === new URL(iframe.src, window.location.href).origin;
  } catch {
    return false;
  }
}

export function isTrustedFrameEnvelope(envelope: FrameEnvelope, context: FrameTrustContext): boolean {
  if (!context.fromParent && !context.fromChild) return false;
  if (envelope.origin !== context.eventOrigin) return false;
  if (envelope.type === 'FRAME_TOGGLE' || envelope.type === 'FRAME_ENTER') return true;
  if (envelope.type === 'FRAME_EXIT' || envelope.type === 'FRAME_EXITED') {
    if (!context.activeSessionId) return true;
    return envelope.sessionId === context.activeSessionId;
  }
  if (context.activeSessionId && envelope.sessionId !== context.activeSessionId) return false;
  if (context.activeNonce && envelope.nonce !== context.activeNonce) return false;
  return true;
}
