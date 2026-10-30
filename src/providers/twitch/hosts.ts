import { descriptorMatchesHost } from '../descriptor-hosts';

import descriptor from './provider.json';

/** twitch.tv and its subdomains, as the descriptor declares them. */
export function isTwitchHost(hostname = typeof window === 'undefined' ? '' : window.location.hostname): boolean {
  return descriptorMatchesHost(descriptor.hosts, hostname);
}
