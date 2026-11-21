import { providerRuntime } from '../provider-api';

import { RedditAdapter } from './adapter';
import { redditTheaterStage } from './stage';

const api = providerRuntime('isolated');
const services = api?.services;
if (services) api?.register({
  id: 'reddit', contractVersion: 1,
  createAdapter: video => new RedditAdapter(video, services),
  stage: redditTheaterStage
});
