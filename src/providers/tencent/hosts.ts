import { normalizeHost } from '../../platform/domain-policy';

/** Tencent Video and WeTV pages: v.qq.com and wetv.vip with their subdomains. */
export function isTencentHost(hostname = typeof window === 'undefined' ? '' : window.location.hostname): boolean {
  const host = normalizeHost(hostname);
  return host === 'v.qq.com' || host.endsWith('.v.qq.com')
    || host === 'wetv.vip' || host.endsWith('.wetv.vip');
}
