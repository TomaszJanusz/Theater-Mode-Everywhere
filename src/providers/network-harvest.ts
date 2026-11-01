import { crunchyrollCdnFile } from '../media-features/crunchyroll-cdn';
import { crunchyrollMetadataRef, classifyCrunchyrollManifest } from '../media-features/parsers/crunchyroll';
import type { MediaProviderFlags } from '../media-features/provider-flags';

import { isCrunchyrollHost } from './hosts';

export type NetworkHarvestTarget = 'crunchyroll' | 'crunchyroll-bif' | 'crunchyroll-url';

export type NetworkHarvestContext = {
  hostname: string;
  flags: Pick<MediaProviderFlags, 'crunchyroll'>;
};

/** Select one provider before touching the body. Endpoint rules stay provider-owned. */
export function qualifyNetworkHarvest(context: NetworkHarvestContext, url: string): NetworkHarvestTarget | null {
  const { hostname, flags } = context;
  if (isCrunchyrollHost(hostname) && flags.crunchyroll) {
    const file = crunchyrollCdnFile(url);
    if (file?.kind === 'bif' && file.query === 't') return 'crunchyroll-bif';
    if (classifyCrunchyrollManifest(url, 'network') || file?.kind === 'ass') return 'crunchyroll-url';
    if (crunchyrollMetadataRef(url)) return 'crunchyroll';
  }
  return null;
}

/** `provider` stands for a registered provider's text or JSON target; its binary targets skip these checks. */
export type HarvestFormatTarget = NetworkHarvestTarget | 'provider';

export function harvestBodyFormat(target: HarvestFormatTarget | null, type: XMLHttpRequestResponseType): 'text' | 'json' | 'binary' | null {
  if (!target || target === 'crunchyroll-url') return null;
  if (target === 'crunchyroll-bif') return type === 'arraybuffer' ? 'binary' : null;
  if (type === 'json') return 'json';
  if (type === 'blob') return null;
  return type === '' || type === 'text' || type === 'arraybuffer' ? 'text' : null;
}

/** An endpoint can omit Content-Type, but an advertised media body is not JSON/text metadata. */
export function harvestFetchFormatMatches(target: HarvestFormatTarget | null, contentType: string): boolean {
  if (!target) return false;
  if (target === 'crunchyroll-bif') return true;
  return !/^(?:audio\/|video\/|image\/|font\/|text\/html\b)/i.test(contentType.trim());
}
