export type DomainMatchSource = 'exact' | 'parent' | 'none';

export type DomainPolicyResult = {
  effective: boolean;
  matchedEntry: string | null;
  source: DomainMatchSource;
};

export function normalizeHost(host: string): string {
  return host.replace(/\.$/, '').replace(/^www\./i, '').toLowerCase();
}

export function parentBlockedEntry(policy: DomainPolicyResult): string | null {
  if (!policy.effective || policy.source !== 'parent') return null;
  return policy.matchedEntry;
}

export function resolveDomainPolicy(host: string, entries: readonly string[]): DomainPolicyResult {
  const hostname = normalizeHost(host);
  if (!hostname) {
    return { effective: false, matchedEntry: null, source: 'none' };
  }

  const normalized = entries
    .map((entry) => normalizeHost(entry))
    .filter((entry) => entry.length > 0);

  for (const entry of normalized) {
    if (hostname === entry) {
      return { effective: true, matchedEntry: entry, source: 'exact' };
    }
  }

  let best: string | null = null;
  for (const entry of normalized) {
    if (hostname.endsWith(`.${entry}`) && (!best || entry.length > best.length)) {
      best = entry;
    }
  }
  if (best) {
    return { effective: true, matchedEntry: best, source: 'parent' };
  }

  return { effective: false, matchedEntry: null, source: 'none' };
}

export function removeMatchingBlacklistEntry(host: string, entries: readonly string[]): string[] {
  const match = resolveDomainPolicy(host, entries);
  if (!match.matchedEntry) return [...entries];
  return entries.filter((entry) => normalizeHost(entry) !== match.matchedEntry);
}
