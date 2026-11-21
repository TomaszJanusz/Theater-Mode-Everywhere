import { sanitizeContentTitle } from '../../media-features/content-title';

import { twitchChannelSegment } from './routes';

/** The name, avatar and stream title in the channel header above a live stream or a VOD; observed for the title row. */
export const TWITCH_CHANNEL_HEADER = '.channel-info-content h1, .channel-info-content img.tw-image-avatar, .channel-info-content [data-a-target="stream-title"]';

/** The channel a live page shows: `twitch.tv/<channel>`, nothing for VODs, clips, listings or Twitch's own routes. */
export function twitchLiveChannel(href: string): string | null {
  try {
    const url = new URL(href);
    const segments = url.pathname.split('/').filter(Boolean);
    return /^(?:www\.|m\.)?twitch\.tv$/i.test(url.hostname) && segments.length === 1 ? twitchChannelSegment(segments[0]) : null;
  } catch {
    return null;
  }
}

function headerLink(root: ParentNode) {
  const info = root.querySelector('.channel-info-content');
  const link = info?.querySelector('h1')?.closest('a[href]');
  const segments = (link?.getAttribute('href') ?? '').split(/[?#]/)[0].split('/').filter(Boolean);
  return info && link && segments.length === 1 ? { info, link, channel: twitchChannelSegment(segments[0]) } : null;
}

/** The channel the header names, or null without one; after in-app navigation it can still be the previous channel. */
export function twitchHeaderChannel(root: ParentNode = document): string | null {
  return headerLink(root)?.channel ?? null;
}

/**
 * The header's display name, avatar, partner badge and stream title, only while its channel link names `channel`:
 * Twitch is a single-page app, so the header can still show the previous channel. The badge is matched by its place
 * next to the name, since its label is in the viewer's language.
 */
export function readTwitchChannelHeader(channel: string, root: ParentNode = document): { name: string; avatarUrl: string | null; verified: boolean; title: string | null } | null {
  const header = headerLink(root);
  const name = sanitizeContentTitle(header?.link.querySelector('h1')?.textContent);
  if (!header || header.channel !== channel || !name) return null;
  const avatar = header.info.querySelector<HTMLImageElement>('img.tw-image-avatar')?.src || null;
  const stream = header.info.querySelector('[data-a-target="stream-title"]');
  return {
    name, avatarUrl: avatar, verified: Boolean(header.link.parentElement?.querySelector('.tw-svg svg')),
    title: sanitizeContentTitle(stream?.getAttribute('title')) || sanitizeContentTitle(stream?.textContent)
  };
}
