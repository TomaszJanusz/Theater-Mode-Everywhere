import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import type { Page } from 'playwright';

import { sharedEngineBrowsers } from '../../test-utils/engine-browsers';
import { bundleModules } from '../../test-utils/player-boot';
import { testEngines } from '../../test-utils/test-engines';

// MAIN-world wiring as in the manifest: runtime, then YouTube's MAIN entry registering into it.
const main = bundleModules(["export { exposeFixtureRuntime } from './test-utils/provider-runtime';",
  "export { installMainWorldRuntime } from './platform/main-world-runtime';",
  "export { isChatDocument, isNativeChatEvent } from './chat/index';",
  "export { ENTRY_SHORTCUT_ATTRIBUTE, ENTRY_SHORTCUT_EVENT } from './ui/entry-shortcuts';"], 'MainChat');
const provider = bundleModules(["import './providers/youtube/main';"]);
const browsers = sharedEngineBrowsers();

const WATCH = `<!doctype html><body><ytd-watch-flexy video-id="AbCdEfGhIjK"><div id="secondary"><div id="chat">
  <ytd-live-chat-frame><button id="collapse" type="button">Hide chat</button></ytd-live-chat-frame>
  <textarea id="draft"></textarea></div><button id="recommendation" type="button">Up next</button></div></ytd-watch-flexy></body>`;

async function open(t: TestContext, engine: keyof typeof browsers, url: string, body: string): Promise<Page> {
  const tab = await (await browsers[engine].newContext(t)).newPage();
  await tab.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body }));
  await tab.goto(url);
  await tab.addScriptTag({ content: main });
  await tab.evaluate("MainChat.exposeFixtureRuntime('main');");
  await tab.addScriptTag({ content: provider });
  return tab;
}

for (const engine of testEngines()) describe(`${engine} YouTube chat in MAIN`, () => {
  it('keeps the entry shortcut pressed in the native chat out of the MAIN-world capture', async t => {
    const tab = await open(t, engine, 'https://www.youtube.com/watch?v=AbCdEfGhIjK', WATCH);
    await tab.evaluate(`(() => {
      MainChat.installMainWorldRuntime();
      document.documentElement.setAttribute(MainChat.ENTRY_SHORTCUT_ATTRIBUTE, JSON.stringify({ toggle: 'T' }));
      // The content world claims every relayed entry key, as it does with a video to enter.
      window.__relayed = [];
      window.addEventListener(MainChat.ENTRY_SHORTCUT_EVENT, event => { window.__relayed.push(document.activeElement.id); event.preventDefault(); });
      window.__page = [];
      document.addEventListener('keydown', event => window.__page.push(event.target.id));
    })()`);
    for (const id of ['draft', 'collapse', 'recommendation']) {
      await tab.focus(`#${id}`);
      await tab.keyboard.press('t');
    }
    assert.deepEqual(await tab.evaluate('({ relayed: window.__relayed, page: window.__page })'),
      { relayed: ['recommendation'], page: ['draft', 'collapse'] }, 'only the key outside the chat is captured for theater');
  });

  it('recognizes the live_chat document itself through the registered chat', async t => {
    const tab = await open(t, engine, 'https://www.youtube.com/live_chat?v=AbCdEfGhIjK', '<!doctype html><body><yt-live-chat-app></yt-live-chat-app></body>');
    assert.deepEqual(await tab.evaluate(`[MainChat.isChatDocument(location.href), MainChat.isChatDocument('https://www.youtube.com/watch?v=AbCdEfGhIjK')]`), [true, false]);
  });
});
