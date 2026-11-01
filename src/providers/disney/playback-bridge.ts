import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';

/**
 * Isolated -> MAIN: pause or play through Hive, which only MAIN can reach. The request is a cancelable event whose
 * detail is the action as a string (Firefox hides objects of the content-script compartment from page code); MAIN
 * cancels it once Hive was asked, and the dispatch returns at once, so the caller knows whether to act on the element.
 */
export const DISNEY_PLAYBACK_REQUEST = 'theater-everywhere-disney-playback';

export const isDisneyPlaybackAction = (value: unknown): value is 'play' | 'pause' => value === 'play' || value === 'pause';

export function requestDisneyPlayback(action: 'play' | 'pause'): boolean {
  return mediaProviderIntegrationEnabled('disney') && !window.dispatchEvent(new CustomEvent(DISNEY_PLAYBACK_REQUEST, { cancelable: true, detail: action }));
}
