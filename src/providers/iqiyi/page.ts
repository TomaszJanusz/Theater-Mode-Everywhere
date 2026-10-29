import { contentTitle, type ContentTitle } from '../../media-features/content-title';

import { selectedIqiyiEpisode } from './dom';

/**
 * iq.com watch URLs are `/play/<slug>-<id>`; the id is the part after the last hyphen. The host
 * rewrites the slug per language, so only the id identifies the episode.
 */
export function iqiyiPlayId(pathname: string): string | null {
  return /^\/play\/(?:[^/]*-)?([a-z0-9]+)\/?$/i.exec(pathname)?.[1] ?? null;
}

/** The title heading: the series link, then the episode label as a bare text node. */
const HEADING = 'h1.intl-play-title';
const SERIES = 'a.intl-album-title .intl-album-title-word-wrap > span:first-child';

function ownText(heading: Element): string {
  return [...heading.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(' ');
}

/**
 * Series title and episode label from the play heading. The page's og:title and VideoObject carry
 * marketing copy ("… – Download APP to Enjoy Now!"), so they are deliberately not used.
 *
 * A client-side episode change updates the URL, the heading and the highlighted episode at
 * different moments; a heading whose highlighted episode is not the URL's is left over from the
 * previous episode and is rejected.
 */
export function readIqiyiTitle(doc: Document, pathname: string): ContentTitle | null {
  const heading = doc.querySelector(HEADING);
  const id = iqiyiPlayId(pathname);
  if (!heading || !id) return null;
  const selected = selectedIqiyiEpisode(doc)?.querySelector('a[href]')?.getAttribute('href');
  if (selected && iqiyiPlayId(new URL(selected, doc.baseURI).pathname) !== id) return null;
  const series = heading.querySelector(SERIES)?.textContent;
  return series ? contentTitle(series, ownText(heading)) : contentTitle(ownText(heading));
}
