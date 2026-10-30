import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

import { chromium, firefox } from 'playwright';

import { LANGUAGES } from './language';
import { bundleModules } from './test-utils/player-boot';
import { sharedTestBrowser } from './test-utils/test-browser';
import { testEngines } from './test-utils/test-engines';

const bundle = bundleModules(
  ["export { localizedMarkup } from './localized-markup'; export { createSvgIcon } from './ui/svg-icon'; export { createHud } from './ui/hud'; export { definePrivacyThingLogo } from '@privacy-thing/brand';"], 'SafeDom');

for (const engine of testEngines()) {
  const shared = sharedTestBrowser(({ chromium, firefox })[engine]);
  it(`keeps locale formatting and rejects executable markup in ${engine}`, async t => {
    const page = await (await shared.newContext(t)).newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<body></body>');
    await page.addScriptTag({ content: bundle });
    const catalogs = LANGUAGES.map(({ locale }) => JSON.parse(readFileSync(path.join(__dirname, '../_locales', locale, 'messages.json'), 'utf8')));
    const result = await page.evaluate(`(() => {
      const { localizedMarkup, createSvgIcon, createHud } = SafeDom;
      const messages = ${JSON.stringify(catalogs)};
      const keys = ['createdByHtml', 'madeInPoland', 'aboutLetterFreeHtml', 'aboutLetterStoresHtml', 'aboutSignoffHtml', 'copyrightHtml'];
      const unchanged = messages.every(catalog => keys.every(key => {
        const value = catalog[key].message;
        const expected = new DOMParser().parseFromString(value, 'text/html');
        const actual = document.createElement('div');
        actual.append(localizedMarkup(value, document));
        const comparison = document.createElement('div');
        comparison.append(...expected.body.childNodes);
        return actual.isEqualNode(comparison);
      }));
      const malicious = '<a href="javascript:alert(1)" onclick="alert(1)" target="_blank">link</a><span class="heart" style="background:url(https://invalid.test)">❤</span><img src=x onerror="alert(1)"><svg onload="alert(1)"><script>alert(1)</script></svg><a href="data:text/html,test">data</a>';
      const host = document.createElement('div');
      host.append(localizedMarkup(malicious, document));
      document.body.append(host);
      const sanitized = !host.querySelector('script,img,svg,[onclick],[style],[href]') && host.textContent === 'link❤data';
      const icon = createSvgIcon('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path d="M0 0" onclick="alert(1)"/></svg>');
      const svgSafe = !icon.hasAttribute('onload') && !icon.firstElementChild.hasAttribute('onclick');
      let rejectsScript = false;
      try { createSvgIcon('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'); } catch { rejectsScript = true; }
      const hud = createHud({ session: { element: document.body }, queryPlayerUi: selector => document.querySelector(selector),
        mountPlayerUi: node => document.body.append(node), paintOverlay() {}, t: () => malicious }, () => {});
      hud.triggerStatusIndicator(malicious, '');
      const literalHud = document.querySelector('.volume-hud-text').textContent === malicious
        && !document.querySelector('.volume-hud-content a');
      hud.removeCenteredHud();
      // The package patch must retain styles, SVG namespaces and its animated composite.
      SafeDom.definePrivacyThingLogo();
      const logo = document.createElement('privacy-thing-logo');
      logo.configure({ variant: 'logo', animateIcon: true, animateCursor: true });
      document.body.append(logo);
      const shadow = logo.shadowRoot;
      const brandIntact = !!shadow.querySelector('style').textContent
        && shadow.querySelector('.pt-brand-base > svg').namespaceURI === 'http://www.w3.org/2000/svg'
        && !!shadow.querySelector('mask path[data-thing-head]')
        && !!shadow.querySelector('.pt-brand-thing > svg[part="svg thing"]')
        && !!shadow.querySelector('animateTransform');
      logo.remove();
      return { unchanged, sanitized, svgSafe, rejectsScript, literalHud, brandIntact };
    })()`);
    assert.deepEqual(errors, []);
    assert.deepEqual(result, { unchanged: true, sanitized: true, svgSafe: true, rejectsScript: true, literalHud: true, brandIntact: true });
  });
}
