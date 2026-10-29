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

export function isVimeoHost(hostname = currentHost()): boolean {
  const host = normalizeHost(hostname);
  return host === 'vimeo.com' || host.endsWith('.vimeo.com');
}

export function isPatreonHost(hostname = currentHost()): boolean {
  const host = normalizeHost(hostname);
  return host === 'patreon.com' || host.endsWith('.patreon.com');
}

export function isTwitchHost(hostname = currentHost()): boolean {
  const host = normalizeHost(hostname);
  return host === 'twitch.tv' || host.endsWith('.twitch.tv');
}

export function isDisneyHost(hostname = currentHost()): boolean {
  const host = normalizeHost(hostname);
  return host === 'disneyplus.com' || host.endsWith('.disneyplus.com');
}

export function isNetflixHost(hostname = currentHost()): boolean {
  const host = normalizeHost(hostname);
  return host === 'netflix.com' || host.endsWith('.netflix.com');
}

export function isBilibiliHost(hostname = currentHost()): boolean {
  const host = normalizeHost(hostname);
  return host === 'bilibili.com' || host.endsWith('.bilibili.com');
}

/** International Bilibili.tv. This is not bilibili.com and must not share that adapter. */
export function isBilibiliIntlHost(hostname = currentHost()): boolean {
  const host = normalizeHost(hostname);
  return host === 'bilibili.tv' || host.endsWith('.bilibili.tv');
}

export function isTencentHost(hostname = currentHost()): boolean {
  const host = normalizeHost(hostname);
  return host === 'v.qq.com' || host.endsWith('.v.qq.com')
    || host === 'wetv.vip' || host.endsWith('.wetv.vip');
}

/** International iQIYI (iq.com). The domestic iqiyi.com is a different site and is not matched. */
export function isIqiyiHost(hostname = currentHost()): boolean {
  const host = normalizeHost(hostname);
  return host === 'iq.com' || host.endsWith('.iq.com');
}

/** SOOP (formerly AfreecaTV) international: www., play. and vod. under sooplive.com. */
export function isSoopHost(hostname = currentHost()): boolean {
  return catalogHost('soop', hostname);
}
/** viki.com and its real subdomains. */
export function isVikiHost(hostname = currentHost()): boolean {
  const host = normalizeHost(hostname);
  return host === 'viki.com' || host.endsWith('.viki.com');
}

/** crunchyroll.com and its real subdomains, including the static player host. */
export function isCrunchyrollHost(hostname = currentHost()): boolean {
  const host = normalizeHost(hostname);
  return host === 'crunchyroll.com' || host.endsWith('.crunchyroll.com');
}
