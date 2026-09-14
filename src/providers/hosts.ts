function currentHost(): string {
  return typeof window !== 'undefined' ? window.location.hostname : '';
}

function stripWww(hostname: string): string {
  return hostname.replace(/^www\./i, '').toLowerCase();
}

export function isYouTubeHost(hostname = currentHost()): boolean {
  const host = hostname.replace(/^www\./, '');
  return host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com' || host.endsWith('.youtube.com');
}

export function isVimeoHost(hostname = currentHost()): boolean {
  const host = hostname.replace(/^www\./, '');
  return host === 'vimeo.com' || host.endsWith('.vimeo.com');
}

export function isPatreonHost(hostname = currentHost()): boolean {
  const host = hostname.replace(/^www\./, '').toLowerCase();
  return host === 'patreon.com' || host.endsWith('.patreon.com');
}

export function isTwitchHost(hostname = currentHost()): boolean {
  const host = stripWww(hostname);
  return host === 'twitch.tv' || host.endsWith('.twitch.tv');
}

export function isDisneyHost(hostname = currentHost()): boolean {
  const host = stripWww(hostname);
  return host === 'disneyplus.com' || host.endsWith('.disneyplus.com');
}
