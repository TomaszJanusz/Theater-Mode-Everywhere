import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { providerRuntime } from '../provider-api';

import { VikiAdapter } from './adapter';
import { readVikiCaptionLayout } from './host-captions';
import { readVikiControls } from './navigation';
import { createVikiServiceActions } from './service-actions';
import { vikiTheaterStage } from './stage';
import { vikiWatchPlayback } from './watch-playback';

const api = providerRuntime('isolated');
const services = api?.services;
if (services) api?.register({
  id: 'viki', contractVersion: 1, watchPlayback: vikiWatchPlayback,
  createAdapter: () => new VikiAdapter(services.requestPageFetch, services.parseCaptionPayload),
  titleFromPage: true,
  stage: vikiTheaterStage,
  hostCaptions: () => ({ read: readVikiCaptionLayout }),
  navigation: { playerSelector: '#vmplayer_id.video-js', readControls: readVikiControls },
  serviceActions(options) {
    const source = createVikiServiceActions(options);
    const doc = options.document ?? document;
    const root = options.element?.getRootNode();
    return { ...source, subscribe: changed => services.observeProviderDom({
      root: root instanceof ShadowRoot ? root : doc, selector: '#vmplayer_id', changed,
      enabled: () => mediaProviderIntegrationEnabled('viki'),
      relevant: record => {
        const element = record.target instanceof Element ? record.target : record.target.parentElement;
        return record.type === 'childList' || Boolean(element?.closest('button, a'));
      }
    }) };
  }
});
