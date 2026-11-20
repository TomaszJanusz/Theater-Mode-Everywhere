import '../content.css';
import { isChatDocument } from '../chat/url';
import { parseCaptionPayload } from '../media-features/parsers/captions';
import { requestMediaProbe, requestPageFetch, requestProviderProbe } from '../media-features/probe';
import { ECHO_WASM_PATH, ECHO_WORKLET_PATH, offerAudioAssets } from '../protocol/audio-assets';
import { observeProviderDom } from '../providers/dom-watch';
import { serviceElementToken } from '../providers/native-service-actions';
import { exposeProviderRuntime } from '../providers/provider-api';
import { providerRegistry } from '../providers/runtime-registration';
import { bootstrapPlayerRuntime } from '../ui/player-runtime';
import { setPlayerUiCss } from '../ui/root';
import playerUiCss from '../ui/shadow.css?inline';

exposeProviderRuntime('isolated', {
  contractVersion: 1, register: providerRegistry.register, services: {
    requestPageFetch, requestMediaProbe: (timeoutMs?: number) => requestMediaProbe(timeoutMs), requestProviderProbe, serviceElementToken, observeProviderDom, parseCaptionPayload,
    standbyVideoSelector: () => providerRegistry.all().flatMap(hooks => hooks.discovery?.standbySelector ?? []).join(', ')
  },
  start() {
    if (!providerRegistry.start()) return;
    // Chat documents run no MAIN audio runtime to take the URLs.
    if (!isChatDocument(window.location.href)) offerAudioAssets({ worklet: chrome.runtime.getURL(ECHO_WORKLET_PATH), wasm: chrome.runtime.getURL(ECHO_WASM_PATH) });
    setPlayerUiCss(playerUiCss);
    bootstrapPlayerRuntime();
  }
});
