import { encodeProbeRequest, encodeProbeAsyncRequest, parseProbeAsyncReply, PROBE_ASYNC_EVENT, PROBE_ASYNC_REPLY_EVENT } from '../protocol/page-requests';
import { createWorldMessage, readWorldEnvelope } from '../protocol/world-messages';
import type { BilibiliIntlSnapshot } from '../providers/bilibili-intl/main';
import type { CrunchyrollSnapshot } from '../providers/crunchyroll/main';
import type { TencentSnapshot } from '../providers/tencent/main';

export const MEDIA_PROBE_EVENT = 'theater-everywhere-media-probe';
export const MEDIA_PROBE_RESULT_EVENT = 'theater-everywhere-media-probe-result';
export const MEDIA_FETCH_EVENT = 'theater-everywhere-media-fetch';
export const MEDIA_FETCH_RESULT_EVENT = 'theater-everywhere-media-fetch-result';

export type DisneyCaptionMeta = {
  id: string;
  language: string;
  label: string;
  url: string;
};

export type DisneyPlayerSnapshot = {
  mediaId?: string;
  title?: string;
  duration?: number;
  masterUrl?: string;
  storyboardUrl?: string;
  bifBlobUrl?: string;
  thumbnail?: {
    width: number;
    height: number;
    intervalMs: number;
    bifUrl?: string;
  };
  captionTracks?: DisneyCaptionMeta[];
};

export type NetflixProbeSnapshot = {
  videoId?: string;
  title?: string;
  tracks?: Array<{
    id: string;
    language: string;
    label: string;
    kind?: string;
    forced?: boolean;
    none?: boolean;
  }>;
  selectedTrackId?: string;
};

export type MediaProbeSnapshot = {
  /** Registered providers' snapshots by provider id, unvalidated: each provider normalizes its own. */
  providers?: Record<string, unknown>;
  disney?: DisneyPlayerSnapshot | null;
  netflix?: NetflixProbeSnapshot | null;
  bilibiliIntl?: BilibiliIntlSnapshot | null;
  tencent?: TencentSnapshot | null;
  crunchyroll?: CrunchyrollSnapshot | null;
};

type ProbeRequest = {
  requestId: number;
};

type ProbeResponse = ProbeRequest & MediaProbeSnapshot;

let requestId = 0;

export function requestMediaProbe(timeoutMs = 800, provider?: 'bilibiliIntl'): Promise<MediaProbeSnapshot> {
  return new Promise((resolve) => {
    const id = ++requestId;
    let settled = false;
    const timer = window.setTimeout(() => finish({}), timeoutMs);

    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<ProbeResponse>).detail;
      if (!detail || detail.requestId !== id) return;
      finish(detail);
    };

    const finish = (snapshot: MediaProbeSnapshot) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener(resultEvent, onResult as EventListener);
      resolve({
        providers: plainRecord(snapshot.providers),
        disney: snapshot.disney ?? null,
        netflix: snapshot.netflix ?? null,
        bilibiliIntl: snapshot.bilibiliIntl ?? null,
        tencent: snapshot.tencent ?? null,
        crunchyroll: snapshot.crunchyroll ?? null
      });
    };

    const resultEvent = provider === 'bilibiliIntl' ? 'theater-everywhere-bilibili-intl-probe-result' : MEDIA_PROBE_RESULT_EVENT;
    window.addEventListener(resultEvent, onResult as EventListener);
    window.dispatchEvent(new CustomEvent(MEDIA_PROBE_EVENT, { detail: encodeProbeRequest(id) }));
  });
}

/** Each provider's pending probe, settled with null when a newer request supersedes it. Settling twice is a no-op. */
const pendingProviderProbes = new Map<string, (value: unknown) => void>();
let providerProbeId = 0;

/**
 * A registered provider's asynchronous MAIN-world probe (`probeAsync`), for snapshots that need page requests.
 * Resolves to the provider's unvalidated value, or null on timeout, a MAIN refusal, or when a newer request for the
 * same provider supersedes this one: only the latest request's reply is ever delivered.
 */
export function requestProviderProbe(provider: string, timeoutMs = 8000, target: EventTarget = window): Promise<unknown> {
  pendingProviderProbes.get(provider)?.(null);
  return new Promise((resolve) => {
    const request = { requestId: ++providerProbeId, provider, timeoutMs };
    const finish = (value: unknown) => {
      if (pendingProviderProbes.get(provider) === finish) pendingProviderProbes.delete(provider);
      clearTimeout(timer);
      target.removeEventListener(PROBE_ASYNC_REPLY_EVENT, onReply);
      resolve(value);
    };
    const onReply = (event: Event) => {
      const reply = parseProbeAsyncReply((event as CustomEvent<unknown>).detail, request.requestId);
      if (reply) finish(reply.value);
    };
    const timer = setTimeout(finish, timeoutMs, null);
    pendingProviderProbes.set(provider, finish);
    target.addEventListener(PROBE_ASYNC_REPLY_EVENT, onReply);
    target.dispatchEvent(new CustomEvent(PROBE_ASYNC_EVENT, { detail: encodeProbeAsyncRequest(request) }));
  });
}

function plainRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

/**
 * Requests a page resource through the MAIN-world broker.
 * Resolves to `null` when the broker rejects the request, returns an empty body, or times out.
 */
export function requestPageFetch(url: string, timeoutMs = 8000): Promise<string | null> {
  return new Promise((resolve) => {
    const request = createWorldMessage('PAGE_FETCH', { url });
    let settled = false;
    const { port1, port2 } = new MessageChannel();

    const onMessage = (event: MessageEvent) => {
      const envelope = readWorldEnvelope(event.data);
      if (!envelope || envelope.type !== 'PAGE_FETCH_RESULT') return;
      if (envelope.requestId !== request.requestId || envelope.nonce !== request.nonce || envelope.origin !== request.origin) return;
      const body = envelope.payload.body;
      finish(envelope.payload.ok === true && typeof body === 'string' ? body : null);
    };

    const finish = (body: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      port1.onmessage = null;
      port1.onmessageerror = null;
      port1.close();
      port2.close();
      resolve(body && body.trim() ? body : null);
    };

    const timer = window.setTimeout(() => finish(null), timeoutMs);
    port1.onmessage = onMessage;
    port1.onmessageerror = () => finish(null);
    try {
      // The broker lives in this same window; '/' restricts delivery to the sender's own origin,
      // including opaque origins (sandboxed frames), which have no serialized form to name.
      window.postMessage(request, '/', [port2]);
    } catch {
      finish(null);
    }
  });
}
