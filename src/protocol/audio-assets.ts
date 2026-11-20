/**
 * Hands the web-accessible echo-reduction worklet URL from the isolated world (which has
 * `runtime.getURL`) to the MAIN world (which runs the audio graph). The DSP binary sits beside it
 * under the same origin, see `echoWasmUrl`. Chromium serves both only under its per-session dynamic
 * id, which is per extension, not per file; Firefox's per-profile UUID would identify the browser if
 * the URL leaked, so it never goes into the DOM or a later message. Both content scripts run at document_start, before any page
 * script, and this event is dispatched synchronously then: no page listener exists to read it.
 *
 * Either world may start first. The isolated world offers once; MAIN takes a valid offer by
 * cancelling it. An offer nobody took waits for MAIN's one request (the event without a detail),
 * and is answered exactly once.
 */
const EVENT = 'theater-everywhere-audio-assets';

export const ECHO_WORKLET_PATH = 'audio/echo-reduction.js';
export const ECHO_WASM_PATH = 'audio/echo-reduction.wasm';

const WORKLET_URL_RE = /^[a-z]+-extension:\/\/[\w-]+\/audio\/echo-reduction\.js$/;

/** This extension's worklet URL as `getURL` returns it, or null. */
export function parseWorkletUrl(detail: unknown): string | null {
  return typeof detail === 'string' && WORKLET_URL_RE.test(detail) ? detail : null;
}

export const echoWasmUrl = (workletUrl: string): string => workletUrl.replace(/js$/, 'wasm');

/** Isolated world, at document_start. */
export function offerAudioAssets(getURL: (path: string) => string): void {
  const detail = getURL(ECHO_WORKLET_PATH);
  const offer = () => document.dispatchEvent(new CustomEvent(EVENT, { detail, cancelable: true }));
  if (!offer()) return;
  const answer = (event: Event) => {
    if ((event as CustomEvent<unknown>).detail != null) return;
    document.removeEventListener(EVENT, answer);
    offer();
  };
  document.addEventListener(EVENT, answer);
}

/** MAIN world, at document_start; the returned reader yields the worklet URL once it has arrived. */
export function receiveAudioAssets(): () => string | null {
  let url: string | null = null;
  const receive = (event: Event) => {
    url = parseWorkletUrl((event as CustomEvent<unknown>).detail);
    if (!url) return;
    event.preventDefault();
    document.removeEventListener(EVENT, receive);
  };
  document.addEventListener(EVENT, receive);
  document.dispatchEvent(new CustomEvent(EVENT));
  return () => url;
}
