import { descriptorMatchesHost } from '../descriptor-hosts';

import descriptor from './provider.json';

/** disneyplus.com and its subdomains, as the descriptor declares them. */
export function isDisneyHost(hostname = typeof window === 'undefined' ? '' : window.location.hostname): boolean {
  return descriptorMatchesHost(descriptor.hosts, hostname);
}
