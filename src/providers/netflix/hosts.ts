import { descriptorMatchesHost } from '../descriptor-hosts';

import descriptor from './provider.json';

/** netflix.com and its subdomains, as the descriptor declares them. */
export function isNetflixHost(hostname = typeof window === 'undefined' ? '' : window.location.hostname): boolean {
  return descriptorMatchesHost(descriptor.hosts, hostname);
}
