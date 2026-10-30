import { encodeProbeAsyncReply, parseProbeAsyncRequest, PROBE_ASYNC_EVENT, PROBE_ASYNC_REPLY_EVENT } from '../protocol/page-requests';
import type { ProviderHooks } from '../providers/provider-api';

/**
 * Answers the isolated world's `requestProviderProbe` from MAIN's own registry, once per request. `hooksFor` returns
 * nothing for a provider that is not registered here (refused, failed or late) or whose integration is off; it, like
 * a provider without `probeAsync`, answers null promptly rather than letting the request time out. A newer request for
 * the same provider supersedes the older: its signal aborts and its late result is dropped.
 */
export function answerProviderProbes(target: EventTarget, hooksFor: (id: string) => Pick<ProviderHooks, 'probeAsync'> | undefined): () => void {
  const latest = new Map<string, AbortController>();
  const onRequest = (event: Event) => {
    const request = parseProbeAsyncRequest((event as CustomEvent<unknown>).detail);
    if (!request) return;
    const { provider } = request;
    const controller = new AbortController();
    latest.get(provider)?.abort();
    latest.set(provider, controller);
    const reply = (value: unknown) => {
      if (latest.get(provider) !== controller) return;
      latest.delete(provider);
      target.dispatchEvent(new CustomEvent(PROBE_ASYNC_REPLY_EVENT, { detail: encodeProbeAsyncReply({ ...request, value }) }));
    };
    // A refusal answers null too, one microtask later; a throwing hook rejects like a failing read.
    Promise.resolve().then(() => hooksFor(provider)?.probeAsync?.(controller.signal)).then(reply, () => reply(null));
  };
  target.addEventListener(PROBE_ASYNC_EVENT, onRequest);
  return () => target.removeEventListener(PROBE_ASYNC_EVENT, onRequest);
}
