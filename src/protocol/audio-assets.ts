/**
 * Hands the web-accessible audio worklet URLs from the isolated world (which has `runtime.getURL`)
 * to the MAIN world (which runs the audio graph). Chromium serves them only under a per-session
 * dynamic id; Firefox's per-profile UUID would identify the browser if the URL leaked, so it never
 * goes into the DOM or a later message. Both content scripts run at document_start, before any page
 * script, and these events are dispatched synchronously then: no page listener exists to read them.
 * Either world may start first, so MAIN asks and the isolated world offers, each exactly once.
 */
const OFFER = 'theater-everywhere-audio-assets';
const REQUEST = 'theater-everywhere-audio-assets-request';
const ACCEPTED = 'theater-everywhere-audio-assets-accepted';

export const ECHO_WORKLET_PATH = 'audio/echo-reduction.js';
export const ECHO_WASM_PATH = 'audio/echo-reduction.wasm';

export type AudioAssets = { worklet: string; wasm: string };

/** Only this extension's two files, as `getURL` returns them. */
export function parseAudioAssets(detail: unknown): AudioAssets | null {
  if (typeof detail !== 'string') return null;
  const [worklet, wasm, extra] = detail.split(' ');
  const base = /^[a-z]+-extension:\/\/[\w-]+\//;
  const valid = (url: string | undefined, path: string): url is string => !!url && base.test(url) && url.replace(base, '') === path;
  return extra === undefined && valid(worklet, ECHO_WORKLET_PATH) && valid(wasm, ECHO_WASM_PATH) ? { worklet, wasm } : null;
}

/** Isolated world, at document_start. */
export function offerAudioAssets(assets: AudioAssets): void {
  const detail = `${assets.worklet} ${assets.wasm}`;
  let accepted = false;
  const offer = () => {
    document.removeEventListener(REQUEST, offer);
    document.dispatchEvent(new CustomEvent(OFFER, { detail }));
  };
  const accept = () => { accepted = true; };
  document.addEventListener(ACCEPTED, accept, { once: true });
  offer();
  document.removeEventListener(ACCEPTED, accept);
  // MAIN has not started yet: answer its one request.
  if (!accepted) document.addEventListener(REQUEST, offer);
}

/** MAIN world, at document_start; the returned reader yields the URLs once they have arrived. */
export function receiveAudioAssets(): () => AudioAssets | null {
  let assets: AudioAssets | null = null;
  const receive = (event: Event) => {
    const parsed = parseAudioAssets((event as CustomEvent<unknown>).detail);
    if (!parsed) return;
    assets = parsed;
    document.removeEventListener(OFFER, receive);
    document.dispatchEvent(new CustomEvent(ACCEPTED));
  };
  document.addEventListener(OFFER, receive);
  document.dispatchEvent(new CustomEvent(REQUEST));
  return () => assets;
}
