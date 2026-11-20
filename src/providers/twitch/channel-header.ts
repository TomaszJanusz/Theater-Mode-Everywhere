import { sanitizeContentTitle } from '../../media-features/content-title';

import { twitchChannelSegment } from './routes';

/** The name and avatar in the channel header above a live stream or a VOD; observed for the byline. */
export const TWITCH_CHANNEL_HEADER = '.channel-info-content h1, .channel-info-content img.tw-image-avatar';

/** The channel a live page shows: `twitch.tv/<login>`, nothing for VODs, clips, listings or Twitch's own routes. */
export function twitchLiveLogin(href: string): string | null {
  try {
    const url = new URL(href);
    const segments = url.pathname.split('/').filter(Boolean);
    return /^(?:www\.|m\.)?twitch\.tv$/i.test(url.hostname) && segments.length === 1 ? twitchChannelSegment(segments[0]) : null;
  } catch {
    return null;
  }
}

/**
 * The header's display name, avatar and partner badge, only while its channel link names `login`: Twitch is a
 * single-page app, so the header can still show the previous channel. The badge is matched by its place next to the
 * name, since its label is in the viewer's language.
 */
export function readTwitchChannelHeader(login: string, root: ParentNode = document): { name: string; avatarUrl: string | null; verified: boolean } | null {
  const info = root.querySelector('.channel-info-content');
  const heading = info?.querySelector('h1');
  const link = heading?.closest('a[href]');
  const href = link?.getAttribute('href') ?? '';
  const segments = href.split(/[?#]/)[0].split('/').filter(Boolean);
  const name = sanitizeContentTitle(heading?.textContent);
  if (!info || !link || segments.length !== 1 || twitchChannelSegment(segments[0]) !== login || !name) return null;
  const avatar = info.querySelector<HTMLImageElement>('img.tw-image-avatar')?.src || null;
  return { name, avatarUrl: avatar, verified: Boolean(link.parentElement?.querySelector('.tw-svg svg')) };
}
