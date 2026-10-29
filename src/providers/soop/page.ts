import { contentTitle, type ContentTitle } from '../../media-features/content-title';

import type { SoopRoute } from './dom';

const TITLE = { live: '#broadTitle', vod: '.broadcast_title' } as const;

/**
 * The broadcast or recording title and its streamer. Live pages fill `#broadTitle` after load, so
 * an empty heading is not a title yet. The page's `<title>` is "<streamer> - SOOP" and is not used.
 */
export function readSoopTitle(doc: Document, route: SoopRoute): ContentTitle | null {
  const title = doc.querySelector(TITLE[route.kind])?.textContent;
  return contentTitle(title, doc.querySelector('.nickname')?.textContent);
}
