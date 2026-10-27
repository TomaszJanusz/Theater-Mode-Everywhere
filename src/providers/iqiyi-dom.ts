/** iq.com selectors shared by the iQIYI provider and the shared playlist navigation. */
export const IQIYI_PLAYER_SELECTOR = 'iqpdiv.iqp-player';
export const IQIYI_SELECTED_EPISODE = 'ul.intl-episodes-list li.selected';

/** The playing episode in the host's episode list, when the list is rendered. */
export function selectedIqiyiEpisode(doc: Document): HTMLLIElement | null {
  const item = doc.querySelector(IQIYI_SELECTED_EPISODE);
  return item instanceof HTMLLIElement ? item : null;
}
