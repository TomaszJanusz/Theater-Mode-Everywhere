/**
 * Reads a native control of the YouTube player. Once the miniplayer or a queue
 * has been used, the player also holds the miniplayer's hidden copy of the
 * progress bar and live badge ahead of the main controls, and YouTube stops
 * updating that copy while the full player shows. Prefer the bottom chrome.
 */
export function youtubePlayerControl(player: ParentNode, selector: string): Element | null {
  return player.querySelector(`.ytp-chrome-bottom ${selector}`) ?? player.querySelector(selector);
}
