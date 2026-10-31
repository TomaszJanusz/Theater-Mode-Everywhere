import { t as pageMessage } from '../src/i18n';
import { translateMessage } from '../src/i18n-runtime';

const FALLBACKS: Record<string, string> = {
  providerSettingsButton: "Settings",
  providerSettingsTitle: "$1 settings",
  providerShowRecommendations: "Show recommendations",
  providerShowRecommendationsDescription: "Show suggested videos when playback ends.",
  providerAutoTheaterGlobalOff: 'AutoTheater is off globally. Enable it in Features first.',
};

/** Page-only copy stays out of content.js; existing labels use the page catalog. */
export function settingsMessage(key: string, substitutions?: string | string[]): string {
  const message = translateMessage(FALLBACKS, key, substitutions);
  return message === key ? pageMessage(key, substitutions) : message;
}
