export function descriptorMatchesHost(hosts: readonly { domain: string; includeSubdomains: boolean }[], hostname: string): boolean {
  // Unlike blacklist normalization, manifest admission must preserve an exact www host.
  const host = hostname.replace(/\.$/, '').toLowerCase();
  return hosts.some(rule => host === rule.domain || (rule.includeSubdomains && host.endsWith(`.${rule.domain}`)));
}
