import { contentTitle, sanitizeContentTitle, type ContentAuthor, type ContentTitle } from '../../media-features/content-title';

import type { SoopRoute } from './dom';

const TITLE = { live: '#broadTitle', vod: '.broadcast_title' } as const;
/** The streamer's block under the player: the station link around the logo, then the nickname. */
const INFO = '.broadcast_information';
const STATION = /^https:\/\/www\.sooplive\.com\/station\/([a-z0-9_]{2,30})\/?$/i;

/** Streamer logos come from SOOP's image host only. */
export const SOOP_AVATAR_HOSTS = ['stimg.sooplive.com'];

/** What the title row watches: the title, the nickname and the streamer's logo link. */
export const SOOP_TITLE_SELECTOR = `${TITLE.live}, ${TITLE.vod}, .nickname, ${INFO} .thumbnail_box`;

/**
 * The broadcast or recording title and its streamer. Live pages fill `#broadTitle` after load, so
 * an empty heading is not a title yet. The page's `<title>` is "<streamer> - SOOP" and is not used.
 */
export function readSoopTitle(doc: Document, route: SoopRoute): ContentTitle | null {
  const title = doc.querySelector(TITLE[route.kind])?.textContent;
  return contentTitle(title, doc.querySelector('.nickname')?.textContent);
}

/**
 * The streamer from the block under the player, never from the page's other channel lists (the sidebar has logos of
 * other streamers). A live page's station must be the one its URL names; a recording names its streamer only here.
 */
export function readSoopAuthor(doc: Document, route: SoopRoute): ContentAuthor | null {
  const info = doc.querySelector(INFO);
  const link = info?.querySelector<HTMLAnchorElement>('.thumbnail_box a.thumb[href]');
  const id = STATION.exec(link?.href ?? '')?.[1].toLowerCase();
  const name = sanitizeContentTitle(info?.querySelector('.nickname')?.textContent)?.slice(0, 80);
  if (!id || !name || (route.kind === 'live' && id !== route.bj)) return null;
  return {
    id, name, url: `https://www.sooplive.com/station/${id}`,
    avatarUrl: link?.querySelector('img')?.src || null, verified: false, stat: null
  };
}
