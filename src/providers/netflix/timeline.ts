import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import type { HostSeekDispatch, HostSeekInput, ProviderTimeline } from '../timeline/types';

import { isNetflixHost } from './hosts';

function onNetflixHost(): boolean {
  // Event-target stubs carry no location and are no Netflix page; reading their hostname would throw.
  const hostname = (globalThis as { window?: { location?: { hostname?: unknown } } }).window?.location?.hostname;
  return typeof hostname === 'string' && isNetflixHost(hostname);
}

function netflixSeekEnabled(): boolean {
  return typeof document !== 'undefined'
    && Boolean(document.documentElement)
    && onNetflixHost()
    && mediaProviderIntegrationEnabled('netflix');
}

function netflixMediaSeek(_video: HTMLVideoElement, input: HostSeekInput): HostSeekDispatch | null {
  if (!netflixSeekEnabled()) return null;
  return {
    detail: { time: input.target, resumeAfterSeek: input.resumeAfterSeek },
    rememberResume: true
  };
}

export const netflixTimeline: ProviderTimeline = {
  mediaSeek: netflixMediaSeek
};
