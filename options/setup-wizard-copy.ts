import { t as pageMessage } from '../src/i18n';
import { translateMessage } from '../src/i18n-runtime';

const FALLBACKS: Record<string, string> = {
  setupTitle: 'Set up Theater Mode Everywhere',
  setupProgress: 'Step $1 of $2',
  setupBack: 'Back',
  setupNext: 'Next',
  setupFinish: 'Finish',
  setupSkip: 'Skip setup',
  setupWelcome: 'Thanks for installing! A few choices decide what the extension does on the sites you visit. Nothing is saved until you finish.',
  setupServicesTitle: 'Services with extra features',
  setupServicesDescription: 'On supported services, theater mode can add subtitles, chapters, thumbnails and playlists. To do that, the extension requests subtitle and preview files from the service itself. Nothing goes to the developer or to other companies.',
  setupServicesAll: 'All supported services',
  setupServicesAllDescription: 'Turn on extra features wherever they are available.',
  setupServicesChoose: 'Choose services',
  setupServicesChooseDescription: 'Pick the services where you want the extra features.',
  setupServicesNone: 'None',
  setupServicesNoneDescription: 'Plain theater mode only. Every video still gets theater mode and its controls.',
  setupServicesFooter: 'You can change this later in Settings → Features → Rich Theater Experience.',
  setupSummaryTitle: 'You’re all set',
  setupSummaryDescription: 'Here is what you chose. Your choices are saved when you finish.',
  setupSummaryServicesSome: '$1 of $2 services',
  setupSummaryFinishAndOpen: 'Or finish and open:',
  setupProfileFound: 'Your Theater Mode Everywhere settings arrived from another device, so setup is not needed.',
  setupOpenSettings: 'Open settings'
};

/** Setup copy stays out of content.js; existing labels use the page catalog. */
export function setupMessage(key: string, substitutions?: string | string[]): string {
  const message = translateMessage(FALLBACKS, key, substitutions);
  return message === key ? pageMessage(key, substitutions) : message;
}
