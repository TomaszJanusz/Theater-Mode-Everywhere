import '../content.css';
import { parseCaptionPayload } from '../media-features/parsers/captions';
import { requestMediaProbe, requestPageFetch } from '../media-features/probe';
import { observeProviderDom } from '../providers/dom-watch';
import { serviceElementToken } from '../providers/native-service-actions';
import { exposeProviderRuntime } from '../providers/provider-api';
import { providerRegistry } from '../providers/runtime-registration';
import { bootstrapPlayerRuntime } from '../ui/player-runtime';
import { setPlayerUiCss } from '../ui/root';
import playerUiCss from '../ui/shadow.css?inline';

exposeProviderRuntime('isolated', {
  contractVersion: 1, register: providerRegistry.register, services: {
    requestPageFetch, requestMediaProbe: () => requestMediaProbe(), serviceElementToken, observeProviderDom, parseCaptionPayload
  },
  start() {
    if (!providerRegistry.start()) return;
    setPlayerUiCss(playerUiCss);
    bootstrapPlayerRuntime();
  }
});
