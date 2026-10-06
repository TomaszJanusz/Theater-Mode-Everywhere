import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { isNetflixHost } from '../hosts';
import { providerHostname } from './page-host';
import type { HostSeekDispatch, HostSeekInput, ProviderTimeline } from './types';

function onNetflixHost(): boolean {
  const hostname = providerHostname();
  if (hostname == null) return false;
  return isNetflixHost(hostname);
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
