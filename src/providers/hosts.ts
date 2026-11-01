import { normalizeHost } from '../platform/domain-policy';

import { PROVIDER_CATALOG } from './catalog';
import { descriptorMatchesHost } from './descriptor-hosts';

function currentHost(): string {
  return typeof window !== 'undefined' ? window.location.hostname : '';
}

const catalogHost = (id: string, hostname: string) => PROVIDER_CATALOG.some(item => item.id === id && descriptorMatchesHost(item.hosts, hostname));

/** youtube.com and youtube-nocookie.com with their subdomains, and exactly youtu.be. */
export function isYouTubeHost(hostname = currentHost()): boolean {
  return catalogHost('youtube', hostname);
}

export function isDisneyHost(hostname = currentHost()): boolean {
  const host = normalizeHost(hostname);
  return host === 'disneyplus.com' || host.endsWith('.disneyplus.com');
}

/** SOOP (formerly AfreecaTV) international: www., play. and vod. under sooplive.com. */
export function isSoopHost(hostname = currentHost()): boolean {
  return catalogHost('soop', hostname);
}
/** crunchyroll.com and its real subdomains, including the static player host. */
export function isCrunchyrollHost(hostname = currentHost()): boolean {
  const host = normalizeHost(hostname);
  return host === 'crunchyroll.com' || host.endsWith('.crunchyroll.com');
}
