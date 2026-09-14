import { normalizeHost } from '../platform/domain-policy';

function currentHost(): string {
  return typeof window !== 'undefined' ? window.location.hostname : '';
}

export function isYouTubeHost(hostname = currentHost()): boolean {
  const host = normalizeHost(hostname);
  return host === 'youtube.com'
    || host === 'youtu.be'
    || host === 'youtube-nocookie.com'
    || host.endsWith('.youtube.com')
    || host.endsWith('.youtube-nocookie.com');
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
