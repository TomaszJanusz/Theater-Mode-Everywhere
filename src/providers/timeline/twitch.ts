import { isTwitchHost } from '../hosts';
import { providerHostname } from './page-host';
import type { ProviderTimeline } from './types';

export const twitchTimeline: ProviderTimeline = {
  mediaSeek(_video, input) {
    const hostname = providerHostname();
    if (!hostname || !isTwitchHost(hostname) || !/^\/videos\/\d+(?:\/|$)/.test(window.location.pathname)) return null;
    return { detail: { time: input.target, resumeAfterSeek: input.resumeAfterSeek }, rememberResume: true };
  }
};
