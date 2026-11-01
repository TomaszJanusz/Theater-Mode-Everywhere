import '../content.css';
import { parseCaptionPayload } from '../media-features/parsers/captions';
import { requestMediaProbe, requestPageFetch, requestProviderProbe } from '../media-features/probe';
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
    setPlayerUiCss(playerUiCss);
    bootstrapPlayerRuntime();
  }
});
