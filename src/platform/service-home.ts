import { isDisneyHost, isPatreonHost, isTwitchHost, isVimeoHost, isYouTubeHost } from '../providers/hosts';

/** Resolve the service homepage, including hosts used only for embedded players. */
export function serviceHomeUrl(pageUrl: string): string | null {
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (isYouTubeHost(url.hostname)) return 'https://www.youtube.com/';
    if (isVimeoHost(url.hostname)) return 'https://vimeo.com/';
    if (isTwitchHost(url.hostname)) return 'https://www.twitch.tv/';
    if (isPatreonHost(url.hostname)) return 'https://www.patreon.com/';
    if (isDisneyHost(url.hostname)) return 'https://www.disneyplus.com/';
    return `${url.origin}/`;
  } catch {
    return null;
  }
}
