import { descriptorMatchesHost } from '../descriptor-hosts';

import descriptor from './provider.json';

export function isBilibiliHost(hostname = typeof window === 'undefined' ? '' : window.location.hostname): boolean {
  return descriptorMatchesHost(descriptor.hosts, hostname);
}
