import { sanitizeContentTitle, type ContentAuthor } from '../../media-features/content-title';
import { youtubeRecord as record } from '../../media-features/parsers/youtube-player-response';

type HostNode = HTMLElement & { data?: unknown; polymerController?: { data?: unknown } };

const CHANNEL_ID = /^UC[\w-]{22}$/;
const VERIFIED_BADGES = new Set(['BADGE_STYLE_TYPE_VERIFIED', 'BADGE_STYLE_TYPE_VERIFIED_ARTIST']);
/** The card shows the avatar at 40 px; this covers it at 2x. */
const AVATAR_SIZE = 88;

function simpleText(value: unknown): string | null {
  const data = record(value);
  if (typeof data?.simpleText === 'string') return data.simpleText.slice(0, 80);
  const run = Array.isArray(data?.runs) ? record(data.runs[0]) : null;
  return typeof run?.text === 'string' ? run.text.slice(0, 80) : null;
}

/**
 * The channel a player response names: `videoDetails.author` and `channelId`, linked to the microformat's profile URL
 * (upgraded to https) or else the channel page. Read with the title, from the same response.
 */
export function readYoutubeOwner(response: unknown): ContentAuthor | null {
  const data = record(response);
  const details = record(data?.videoDetails);
  const id = typeof details?.channelId === 'string' ? details.channelId : '';
  const name = sanitizeContentTitle(details?.author);
  if (!CHANNEL_ID.test(id) || !name) return null;
  const profile = record(record(data?.microformat)?.playerMicroformatRenderer)?.ownerProfileUrl;
  const https = typeof profile === 'string' ? profile.replace(/^http:\/\//, 'https://') : '';
  const url = /^https:\/\/(?:www\.)?youtube\.com\/[@\w./%-]+$/.test(https) ? https : `https://www.youtube.com/channel/${id}`;
  return { id, name: name.slice(0, 80), url, avatarUrl: null, verified: false, stat: null };
}

/** The smallest thumbnail at least `AVATAR_SIZE` wide, else the largest; protocol-relative URLs become https. */
function avatarUrl(value: unknown): string | null {
  const thumbnails = (Array.isArray(value) ? value : []).slice(0, 12).flatMap(item => {
    const thumbnail = record(item);
    const url = typeof thumbnail?.url === 'string' ? thumbnail.url : '';
    const width = typeof thumbnail?.width === 'number' ? thumbnail.width : 0;
    return url ? [{ url: url.startsWith('//') ? `https:${url}` : url, width }] : [];
  }).sort((left, right) => left.width - right.width);
  return (thumbnails.find(item => item.width >= AVATAR_SIZE) ?? thumbnails.at(-1))?.url ?? null;
}

/**
 * Adds the avatar, verified badge and subscriber count from the watch page's owner renderer, whose Polymer model only
 * MAIN can read. After an in-app navigation that renderer can still describe the previous video, so it counts only
 * when it names the same channel as the player response.
 */
export function withOwnerRenderer(owner: ContentAuthor, root: ParentNode = document): ContentAuthor {
  const node = root.querySelector<HostNode>('ytd-watch-metadata ytd-video-owner-renderer');
  const data = record(node?.data ?? node?.polymerController?.data);
  if (!data || record(record(data.navigationEndpoint)?.browseEndpoint)?.browseId !== owner.id) return owner;
  const verified = (Array.isArray(data.badges) ? data.badges : [])
    .some(badge => VERIFIED_BADGES.has(String(record(record(badge)?.metadataBadgeRenderer)?.style)));
  return { ...owner, avatarUrl: avatarUrl(record(data.thumbnail)?.thumbnails), verified, stat: simpleText(data.subscriberCountText) };
}
