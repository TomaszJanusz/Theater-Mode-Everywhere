import { encodeProbeAsyncReply, parseProbeAsyncRequest, PROBE_ASYNC_EVENT, PROBE_ASYNC_REPLY_EVENT } from '../protocol/page-requests';
import type { ProviderHooks } from '../providers/provider-api';

/**
 * Answers the isolated world's `requestProviderProbe` from MAIN's own registry, once per request. A provider not
 * registered here (refused, failed or late) or without `probeAsync` answers null at once rather than letting the
 * request time out. A newer request for the same provider supersedes the older: its late result is dropped.
 */
export function answerProviderProbes(target: EventTarget, hooksFor: (id: string) => Pick<ProviderHooks, 'probeAsync'> | undefined): () => void {
  const latest = new Map<string, number>();
  const reply = (requestId: number, provider: string, value: unknown) => {
    if (latest.get(provider) !== requestId) return;
    latest.delete(provider);
    const detail = encodeProbeAsyncReply({ requestId, provider, value })
      ?? encodeProbeAsyncReply({ requestId, provider, value: null });
    target.dispatchEvent(new CustomEvent(PROBE_ASYNC_REPLY_EVENT, { detail }));
  };
  const onRequest = (event: Event) => {
    const request = parseProbeAsyncRequest((event as CustomEvent<unknown>).detail);
    if (!request) return;
    const { requestId, provider } = request;
    latest.set(provider, requestId);
    let pending: Promise<unknown> | null = null;
    try {
      pending = hooksFor(provider)?.probeAsync?.() ?? null;
    } catch {
      pending = null;
    }
    if (!pending) {
      reply(requestId, provider, null);
      return;
    }
    Promise.resolve(pending).then(value => reply(requestId, provider, value), () => reply(requestId, provider, null));
  };
  target.addEventListener(PROBE_ASYNC_EVENT, onRequest);
  return () => target.removeEventListener(PROBE_ASYNC_EVENT, onRequest);
}
