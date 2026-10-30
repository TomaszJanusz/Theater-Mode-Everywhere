import type { MediaProviderId } from '../media-features/provider-flags';
import { encodeProbeAsyncReply, parseProbeAsyncRequest, PROBE_ASYNC_EVENT, PROBE_ASYNC_REPLY_EVENT } from '../protocol/page-requests';
import type { ProviderHooks } from '../providers/provider-api';

/**
 * Answers the isolated world's `requestProviderProbe` from MAIN's own registry, once per request. Admission (a provider
 * registered in this world, `get`, whose integration is `enabled`) is read when a probe starts and again when it
 * settles: a provider that is not registered here (refused, failed or late), has no `probeAsync`, or whose integration
 * is off, answers null. A read ends, its signal aborted and its result dropped, when a newer request for the same
 * provider supersedes it, at the requester's own deadline, or when the returned cleanup runs.
 */
export function answerProviderProbes(
  target: EventTarget, get: (id: string) => Pick<ProviderHooks, 'id' | 'probeAsync'> | undefined, enabled: (id: MediaProviderId) => boolean
): () => void {
  const admitted = (id: string) => {
    const hooks = get(id);
    return hooks && enabled(hooks.id) && hooks;
  };
  const pending = new Map<string, (settled?: boolean) => void>();
  const onRequest = (event: Event) => {
    const request = parseProbeAsyncRequest((event as CustomEvent<unknown>).detail);
    if (!request) return;
    const { provider } = request;
    pending.get(provider)?.();
    const controller = new AbortController();
    const end = (settled?: boolean) => {
      clearTimeout(timer);
      if (pending.get(provider) === end) pending.delete(provider);
      if (!settled) controller.abort();
    };
    // The requester stops waiting at its timeout, so the read stops then too.
    const timer = setTimeout(end, request.timeoutMs);
    pending.set(provider, end);
    const reply = (value: unknown) => {
      if (controller.signal.aborted) return;
      end(true);
      target.dispatchEvent(new CustomEvent(PROBE_ASYNC_REPLY_EVENT, { detail: encodeProbeAsyncReply(request.requestId, admitted(provider) ? value : null) }));
    };
    // A refusal answers null too, one microtask later; a throwing hook rejects like a failing read.
    new Promise((resolve) => {
      const hooks = admitted(provider);
      resolve(hooks && hooks.probeAsync ? hooks.probeAsync(controller.signal) : null);
    }).then(reply, () => reply(null));
  };
  target.addEventListener(PROBE_ASYNC_EVENT, onRequest);
  return () => {
    target.removeEventListener(PROBE_ASYNC_EVENT, onRequest);
    pending.forEach(end => end());
  };
}
