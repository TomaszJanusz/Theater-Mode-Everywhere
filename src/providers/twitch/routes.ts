/**
 * Single-segment paths that are Twitch's own pages rather than channels. Twitch does not let an
 * account take one of these names, so treating a rare legacy collision as "not a channel" only
 * leaves that page manual.
 */
const RESERVED = new Set([
  'activate',
  'admin',
  'annual-recap',
  'bits',
  'broadcast',
  'browse',
  'checkout',
  'clips',
  'collections',
  'creatorcamp',
  'dashboard',
  'directory',
  'downloads',
  'drops',
  'embed',
  'event',
  'following',
  'friends',
  'inventory',
  'jobs',
  'legal',
  'login',
  'logout',
  'messages',
  'moderation',
  'moderator',
  'p',
  'payments',
  'popout',
  'prime',
  'privacy',
  'products',
  'redeem',
  'search',
  'security',
  'settings',
  'signup',
  'store',
  'subs',
  'subscriptions',
  'team',
  'turbo',
  'u',
  'user',
  'videos',
  'wallet'
]);

/** Twitch logins: letters, digits and underscores, at most 25 characters. */
export const isTwitchLogin = (value: string): boolean => /^\w{1,25}$/.test(value);

/** The lowercased channel a single path segment names, or null for Twitch's own routes. */
export function twitchChannelSegment(segment: string): string | null {
  const login = segment.toLowerCase();
  return isTwitchLogin(login) && !RESERVED.has(login) ? login : null;
}
