import '../content.css';
import { isChatDocument } from '../chat/url';
import { parseCaptionPayload } from '../media-features/parsers/captions';
import { requestMediaProbe, requestPageFetch, requestProviderProbe } from '../media-features/probe';
import { offerAudioAssets } from '../protocol/audio-assets';
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
    // Chat documents run no MAIN audio runtime to take the URLs; fixture pages have no extension API.
    const runtime = globalThis.chrome?.runtime;
    if (runtime?.getURL && !isChatDocument(window.location.href)) offerAudioAssets(path => runtime.getURL(path));
    setPlayerUiCss(playerUiCss);
    bootstrapPlayerRuntime();
  }
});
