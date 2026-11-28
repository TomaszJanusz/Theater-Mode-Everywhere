import { sanitizeContentTitle, type ContentAuthor } from '../../media-features/content-title';
import { youtubeWatchJsonVideoId } from '../../media-features/parsers/youtube-heatmap';
import { youtubeRecord as record } from '../../media-features/parsers/youtube-player-response';
import { MAX_AUTHORS } from '../author-byline';

const CHANNEL_ID = /^UC[\w-]{22}$/;
const VERIFIED_BADGES = new Set(['BADGE_STYLE_TYPE_VERIFIED', 'BADGE_STYLE_TYPE_VERIFIED_ARTIST']);
/** The card shows the avatar at 40 px; this covers it at 2x. */
const AVATAR_SIZE = 88;

const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

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
  const thumbnails = list(value).slice(0, 12).flatMap(item => {
    const thumbnail = record(item);
    const url = typeof thumbnail?.url === 'string' ? thumbnail.url : '';
    const width = typeof thumbnail?.width === 'number' ? thumbnail.width : 0;
    return url ? [{ url: url.startsWith('//') ? `https:${url}` : url, width }] : [];
  }).sort((left, right) => left.width - right.width);
  return (thumbnails.find(item => item.width >= AVATAR_SIZE) ?? thumbnails.at(-1))?.url ?? null;
}

/** A channel page path from YouTube's own data, or the channel id's page. */
function channelUrl(path: unknown, id: string): string {
  return typeof path === 'string' && /^\/[@\w./%-]+$/.test(path) && !path.startsWith('//')
    ? `https://www.youtube.com${path}`
    : `https://www.youtube.com/channel/${id}`;
}

const browseEndpoint = (command: unknown) => record(record(record(command)?.innertubeCommand)?.browseEndpoint);
/** Bidirectional isolates and marks YouTube wraps around the handle and the count. */
const BIDI_MARKS = /[\u200e\u200f\u2066-\u2069]/g;

/**
 * One row of YouTube's "Collaborators" dialog: the channel the title links to, the avatar's handle link, the verified
 * check YouTube attaches to the title, and the subscriber count after the handle in "@handle • 324K subscribers".
 */
function collaborator(value: unknown): ContentAuthor | null {
  const item = record(record(value)?.listItemViewModel);
  const title = record(item?.title);
  const name = sanitizeContentTitle(title?.content);
  const avatar = record(record(item?.leadingAccessory)?.avatarViewModel);
  const id = browseEndpoint(record(list(title?.commandRuns)[0])?.onTap)?.browseId ?? browseEndpoint(avatar?.endpoint)?.browseId;
  if (typeof id !== 'string' || !CHANNEL_ID.test(id) || !name) return null;
  const verified = list(title?.attachmentRuns).some(run => {
    const image = record(record(record(record(record(run)?.element)?.type)?.imageType)?.image);
    return list(image?.sources).some(source => record(record(source)?.clientResource)?.imageName === 'CHECK_CIRCLE_FILLED');
  });
  const subtitle = record(item?.subtitle)?.content;
  const parts = (typeof subtitle === 'string' ? subtitle : '').replace(BIDI_MARKS, '').split('•');
  const stat = parts.length > 1 ? parts.at(-1)!.trim().slice(0, 80) : '';
  return {
    id, name: name.slice(0, 80),
    url: channelUrl(browseEndpoint(avatar?.endpoint)?.canonicalBaseUrl, id),
    avatarUrl: avatarUrl(record(avatar?.image)?.sources),
    verified,
    stat: stat || null
  };
}

/** The first watch-next response (ytInitialData, a navigation's) that describes `videoId`. */
const watchResponse = (videoId: string, responses: readonly unknown[]) =>
  responses.find(candidate => youtubeWatchJsonVideoId(candidate) === videoId);

/** The owner renderer of the watch-next response that describes `videoId`. */
function watchOwnerRenderer(videoId: string, responses: readonly unknown[]): Record<string, unknown> | null {
  const response = watchResponse(videoId, responses);
  const results = record(record(record(record(response)?.contents)?.twoColumnWatchNextResults)?.results)?.results;
  for (const item of list(record(results)?.contents).slice(0, 8)) {
    const owner = record(record(record(record(item)?.videoSecondaryInfoRenderer)?.owner)?.videoOwnerRenderer);
    if (owner) return owner;
  }
  return null;
}

/**
 * Every channel behind `videoId`, in YouTube's order, from the owner renderer of that video's watch-next response: one
 * channel gains its avatar, verified badge and subscriber count; a collaboration (the renderer opens a "Collaborators"
 * dialog instead of the channel) lists each collaborator. The renderer may name another channel than the player
 * response: on an Official Artist Channel the player names the uploading VEVO or Topic channel and the renderer the
 * artist, as YouTube's own byline does, linked like its name (the renderer's own path still leads to the uploader).
 * Without a usable renderer, just the player response's channel. The responses, not the page's rendered model, because
 * after an in-app navigation that model still describes the previous video until after YouTube's page events.
 */
export function youtubeAuthors(owner: ContentAuthor, videoId: string, responses: readonly unknown[]): ContentAuthor[] {
  const data = watchOwnerRenderer(videoId, responses);
  const endpoint = record(data?.navigationEndpoint);
  const id = record(endpoint?.browseEndpoint)?.browseId;
  if (typeof id === 'string' && CHANNEL_ID.test(id)) {
    const verified = list(data?.badges)
      .some(badge => VERIFIED_BADGES.has(String(record(record(badge)?.metadataBadgeRenderer)?.style)));
    const details = { avatarUrl: avatarUrl(record(data?.thumbnail)?.thumbnails), verified, stat: simpleText(data?.subscriberCountText) };
    if (id === owner.id) return [{ ...owner, ...details }];
    const run = record(list(record(data?.title)?.runs)[0]);
    const name = sanitizeContentTitle(run?.text);
    if (!name) return [owner];
    const link = record(record(run?.navigationEndpoint)?.browseEndpoint);
    const url = channelUrl(link?.browseId === id ? link.canonicalBaseUrl : null, id);
    return [{ id, name: name.slice(0, 80), url, ...details }];
  }
  const dialog = record(record(record(record(endpoint?.showDialogCommand)?.panelLoadingStrategy)?.inlineContent)?.dialogViewModel);
  const items = record(record(dialog?.customContent)?.listViewModel)?.listItems;
  const authors = list(items).slice(0, MAX_AUTHORS * 2).flatMap(item => collaborator(item) ?? []);
  return authors.some(author => author.id === owner.id) ? authors.slice(0, MAX_AUTHORS) : [owner];
}

/** The channel a suggestion is by, keyed by the suggested video's id. */
export type YouTubeSuggestionChannel = { videoId: string; name: string; url: string };

/**
 * The channels of the suggestions YouTube shows when `videoId` ends, from that video's watch-next end screen, the data
 * its player builds those tiles from. Only a byline of one run that opens a channel: a collaboration's "A and B"
 * opens a dialog and names no single channel, so it stays text.
 */
export function youtubeEndScreenChannels(videoId: string, responses: readonly unknown[]): YouTubeSuggestionChannel[] {
  const overlay = record(record(record(watchResponse(videoId, responses))?.playerOverlays)?.playerOverlayRenderer);
  const results = record(record(overlay?.endScreen)?.watchNextEndScreenRenderer)?.results;
  return list(results).slice(0, 24).flatMap(result => {
    const video = record(record(result)?.endScreenVideoRenderer);
    const runs = list(record(video?.shortBylineText ?? video?.longBylineText)?.runs);
    const run = runs.length === 1 ? record(runs[0]) : null;
    const endpoint = record(record(run?.navigationEndpoint)?.browseEndpoint);
    const id = endpoint?.browseId;
    const name = sanitizeContentTitle(run?.text);
    if (typeof video?.videoId !== 'string' || typeof id !== 'string' || !CHANNEL_ID.test(id) || !name) return [];
    return [{ videoId: video.videoId.slice(0, 20), name: name.slice(0, 80), url: channelUrl(endpoint?.canonicalBaseUrl, id) }];
  });
}
