import type { Page } from 'playwright';

import type { PageSignals } from '../classify';

/** A generic stand-in for "an ad is playing"; page types with other markers are classified by text. */
const AD_SELECTOR = '[class*="ad-showing"], [class*="ad-break"], [class*="ad-interrupt"], [data-ad-break]';
const TEXT_LIMIT = 6000;

export async function collectSignals(page: Page, status: number): Promise<PageSignals> {
  const dom = await page.evaluate(({ adSelector, limit }) => ({
    text: (document.body?.innerText ?? '').slice(0, limit).toLowerCase(),
    frameSources: [...document.querySelectorAll('iframe[src], script[src]')].map(el => el.getAttribute('src') ?? ''),
    adMarker: Boolean(document.querySelector(adSelector))
  }), { adSelector: AD_SELECTOR, limit: TEXT_LIMIT });
  return { status, ...dom };
}
