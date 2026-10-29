export function descriptorMatchesHost(hosts: readonly { domain: string; includeSubdomains: boolean }[], hostname: string): boolean {
  // Unlike blacklist normalization, manifest admission must preserve an exact www host.
  const host = hostname.replace(/\.$/, '').toLowerCase();
  return hosts.some(rule => host === rule.domain || (rule.includeSubdomains && host.endsWith(`.${rule.domain}`)));
}

/** Canonical home declarations use the same host admission as provider loading. */
export function descriptorHomeUrl(
  descriptors: readonly { hosts: readonly { domain: string; includeSubdomains: boolean }[]; home?: string }[],
  hostname: string
): string | null {
  return descriptors.find(item => item.home && descriptorMatchesHost(item.hosts, hostname))?.home ?? null;
}
