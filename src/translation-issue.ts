import { LANGUAGES } from './language';

const NEW_ISSUE_URL = 'https://github.com/TomaszJanusz/Theater-Mode-Everywhere/issues/new';

/** Matches a browser or catalog locale ("pt_BR", "de-AT", "zh-CN") to a supported language. */
function supportedLanguageName(uiLocale: string): string | undefined {
  const normalized = uiLocale.replace('-', '_').toLowerCase();
  const base = normalized.split('_')[0];
  return (LANGUAGES.find(({ locale }) => locale.toLowerCase() === normalized)
    ?? LANGUAGES.find(({ locale }) => locale.toLowerCase() === base)
    ?? LANGUAGES.find(({ locale }) => locale.split('_')[0].toLowerCase() === base))?.name;
}

/**
 * Pre-fills `.github/ISSUE_TEMPLATE/translation-issue.yml`. The `language` value must equal a
 * dropdown option, so it is sent only when the locale maps to a supported language.
 */
export function translationIssueUrl(uiLocale: string, version: string): string {
  const url = new URL(NEW_ISSUE_URL);
  url.searchParams.set('template', 'translation-issue.yml');
  const language = supportedLanguageName(uiLocale);
  if (language) url.searchParams.set('language', language);
  url.searchParams.set('version', version);
  return url.toString();
}
