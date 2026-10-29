import { descriptorMatchesHost } from '../descriptor-hosts';

import descriptor from './provider.json';

export function isVikiHost(hostname = typeof window === 'undefined' ? '' : window.location.hostname): boolean {
  return descriptorMatchesHost(descriptor.hosts, hostname);
}
