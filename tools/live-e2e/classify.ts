/** Why a page cannot be judged; every non-`ok` kind is an environment problem, not an extension failure. */
export type PageKind = 'ok' | 'consent-wall' | 'captcha' | 'bot-check' | 'geo-block' | 'ad-break';

/** What the page shows before any assertion; collected once, classified without a browser. */
export interface PageSignals {
  status: number;
  /** Lowercased visible text, truncated by the collector. */
  text: string;
  /** `src` values of iframes and scripts. */
  frameSources: string[];
  /** A selector for an in-progress ad is present. */
  adMarker: boolean;
}

const TEXT_RULES: ReadonlyArray<[Exclude<PageKind, 'ok' | 'ad-break'>, readonly RegExp[]]> = [
  ['bot-check', [/confirm (that )?you['’]?re not a (bot|robot)/, /verify (that )?you(['’]re| are) (a )?human/, /unusual traffic/, /automated (queries|requests)/]],
  ['captcha', [/i['’]?m not a robot/, /complete the (captcha|security check)/, /press (and|&) hold/]],
  ['geo-block', [/not available in your (country|region|location)/, /blocked in your (country|region)/]],
  ['consent-wall', [/(accept|reject|agree to) (all )?cookies/, /before you continue/, /we value your privacy/, /manage (cookie|privacy) (preferences|settings)/]]
];
const CHALLENGE_FRAME = /recaptcha|hcaptcha|turnstile|captcha|challenge/i;

/** First matching environment problem, in order of how completely it blocks the check. */
export function classifyPage(signals: PageSignals): { kind: PageKind; reason: string } {
  if (signals.status === 451 || signals.status === 403 && /region|country|location/.test(signals.text)) {
    return { kind: 'geo-block', reason: `HTTP ${signals.status}` };
  }
  for (const [kind, rules] of TEXT_RULES) {
    if (rules.some(rule => rule.test(signals.text))) return { kind, reason: `text matched ${kind}` };
  }
  if (signals.frameSources.some(src => CHALLENGE_FRAME.test(src))) return { kind: 'captcha', reason: 'challenge frame present' };
  if (signals.adMarker || /\bskip ads?\b|ad will (end|play) in/.test(signals.text)) return { kind: 'ad-break', reason: 'ad in progress' };
  return { kind: 'ok', reason: '' };
}
