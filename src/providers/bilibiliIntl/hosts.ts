import { descriptorMatchesHost } from '../descriptor-hosts';

import descriptor from './provider.json';

/** International Bilibili.tv. This is not bilibili.com and must not share that adapter. */
export function isBilibiliIntlHost(hostname = typeof window === 'undefined' ? '' : window.location.hostname): boolean {
  return descriptorMatchesHost(descriptor.hosts, hostname);
}
