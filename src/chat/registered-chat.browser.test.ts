import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import type { Page } from 'playwright';

import { sharedEngineBrowsers } from '../test-utils/engine-browsers';
import { bundleModules } from '../test-utils/player-boot';
import { testEngines } from '../test-utils/test-engines';

const bundle = bundleModules(["export * from './chat/index';", "export { ChatThemeSession } from './chat/theme';",
  "export { exposeFixtureRuntime } from './test-utils/provider-runtime';",
  "export { providerRuntime } from './providers/provider-api';"], 'RegisteredChat');
const browsers = sharedEngineBrowsers();

// A chat on a page outside the provider's watch routes, with a menu the service renders outside it.
const BODY = `<!doctype html><body><section class="chat"><button id="send">Send</button></section><p id="outside">Text</p></body>`;

async function open(t: TestContext, engine: keyof typeof browsers, chat: string): Promise<Page> {
  const page = await (await browsers[engine].newContext(t)).newPage();
  await page.route('https://*.sooplive.com/**', route => route.fulfill({ contentType: 'text/html', body: BODY }));
  await page.goto('https://www.sooplive.com/station');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(`(() => {
    RegisteredChat.exposeFixtureRuntime('isolated');
    window.__applied = 0;
    const chat = { parseLocation: () => null, matchesHost: hostname => hostname === 'play.sooplive.com',
      detect: () => null, activation: () => null, eventSelector: '.chat', activationSelector: '#none', shellSelector: '.chat',
      navigationEvents: [], ...${chat} };
    RegisteredChat.providerRuntime('isolated').register({ id: 'soop', contractVersion: 1,
      watchPlayback: { pageIdentity: () => null, mainVideo: () => null }, chat });
  })()`);
  return page;
}

const chatKey = (page: Page, id: string) => page.evaluate(`(() => {
  let owned = null;
  const listener = event => { owned = RegisteredChat.isNativeChatEvent(event); };
  window.addEventListener('keydown', listener, true);
  document.getElementById(${JSON.stringify(id)}).dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true, composed: true }));
  window.removeEventListener('keydown', listener, true);
  return owned;
})()`);

for (const engine of testEngines()) describe(`${engine} registered chat contract`, () => {
  it('leaves chat keys to the service on its event hosts beyond the watch hosts', async t => {
    const wider = await open(t, engine, '{ matchesEventHost: hostname => hostname.endsWith(".sooplive.com") }');
    assert.equal(await chatKey(wider, 'send'), true);
    assert.equal(await chatKey(wider, 'outside'), false);
    const watchOnly = await open(t, engine, '{}');
    assert.equal(await chatKey(watchOnly, 'send'), false, 'without it, only watch hosts count');
  });

  it('re-applies the palette when a service portal is added or removed, not for other nodes', async t => {
    const page = await open(t, engine, `{ theme: { document: surface => surface.root.ownerDocument, portals: '.menu-layer',
      adapter: () => ({ apply: () => { window.__applied += 1; return true; }, restore() {} }) } }`);
    await page.evaluate(`(() => {
      const root = document.querySelector('.chat');
      window.__session = new RegisteredChat.ChatThemeSession();
      window.__session.update({ provider: 'soop', contentKey: 'x', kind: 'live', root, revealAncestors: [], initiallyVisible: true }, 'dark');
    })()`);
    assert.equal(await page.evaluate('window.__applied'), 1);
    // Observers are notified in creation order, so this later one reports once the session has seen the change.
    const mutate = (change: string) => page.evaluate(`new Promise(resolve => {
      const observer = new MutationObserver(() => { observer.disconnect(); resolve(window.__applied); });
      observer.observe(document.body, { childList: true });
      ${change};
    })`);
    assert.equal(await mutate(`document.body.append(Object.assign(document.createElement('div'), { className: 'unrelated' }))`), 1);
    assert.equal(await mutate(`document.body.append(Object.assign(document.createElement('div'), { className: 'menu-layer' }))`), 2);
    assert.equal(await mutate(`document.querySelector('.menu-layer').remove()`), 3);
    assert.equal(await mutate(`document.querySelector('.unrelated').remove()`), 3);
    await page.evaluate('window.__session.dispose()');
  });
});
