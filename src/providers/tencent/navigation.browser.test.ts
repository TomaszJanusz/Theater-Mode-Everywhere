import assert from 'node:assert/strict';
import { it } from 'node:test';

import type * as PlaylistNav from '../../playlist-nav';
import { sharedEngineBrowsers } from '../../test-utils/engine-browsers';
import { PROVIDER_ENTRIES, bundleModules } from '../../test-utils/player-boot';
import { testEngines } from '../../test-utils/test-engines';

const bundle = bundleModules([...PROVIDER_ENTRIES, "export { findPlaylistActions } from './playlist-nav';"], 'TencentNav');
const browsers = sharedEngineBrowsers();

for (const engine of testEngines()) it(`${engine}: Tencent owns disabled and placeholder navigation controls only on its hosts`, async t => {
  const page = await (await browsers[engine].newContext(t)).newPage();
  for (const host of ['v.qq.com', 'wetv.vip', 'wetv.vip.evil.test']) {
    await page.route(`https://${host}/`, route => route.fulfill({ contentType: 'text/html', body: '<button class="txp_btn_next_u">Next</button>' }));
    await page.goto(`https://${host}/`);
    await page.addScriptTag({ content: bundle });
    const directions = () => page.evaluate(() => (window as unknown as { TencentNav: typeof PlaylistNav }).TencentNav.findPlaylistActions(document).map(action => action.direction));
    const expected = host === 'wetv.vip.evil.test' ? [] : ['next'];
    assert.deepEqual(await directions(), expected);
    await page.locator('button').evaluate(button => button.classList.add('txp_disabled'));
    assert.deepEqual(await directions(), [], 'disabled class is translated by the provider');
    await page.locator('button').evaluate(button => button.setAttribute('class', 'txp_btn_next_u txp_none'));
    assert.deepEqual(await directions(), [], 'placeholder is never navigable');
    await page.locator('button').evaluate(button => button.setAttribute('class', 'txp_btn_next_u'));
    assert.deepEqual(await directions(), expected);
    await page.evaluate(() => document.documentElement.setAttribute('data-te-tencent-integration-off', ''));
    assert.deepEqual(await directions(), expected, 'native navigation remains available with RTE off');
  }
});
