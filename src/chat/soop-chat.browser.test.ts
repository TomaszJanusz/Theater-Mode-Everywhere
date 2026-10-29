import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import type { Page } from 'playwright';

import { sharedEngineBrowsers } from '../test-utils/engine-browsers';
import { bundleModules } from '../test-utils/player-boot';
import { testEngines } from '../test-utils/test-engines';

const bundle = bundleModules(["export * from './chat/index';",
  "export { exposeFixtureRuntime } from './test-utils/provider-runtime';"], 'NativeChat');
const provider = bundleModules(["import './providers/soop/isolated';"]);
const main = bundleModules(["export { exposeFixtureRuntime } from './test-utils/provider-runtime';",
  "export { installMainWorldRuntime } from './platform/main-world-runtime';",
  "export { ENTRY_SHORTCUT_ATTRIBUTE, ENTRY_SHORTCUT_EVENT } from './ui/entry-shortcuts';"], 'MainChat');
const mainProvider = bundleModules(["import './providers/soop/main';"]);
const browsers = sharedEngineBrowsers();

const LIVE = 'https://play.sooplive.com/battleland/297994793';
const VOD = 'https://vod.sooplive.com/player/211006561';

// Structure recorded from sooplive.com: the panel `#chatbox` lives in the column `#chatting_area`
// inside the player's own layout, and the player carries `chat_open` while the panel is shown.
// The player bar's chat button toggles it; in the fixture a click flips the class like the host.
const page = (open: boolean) => `<!doctype html><body>
<div id="webplayer" class="${open ? 'chat_open ' : ''}list_open"><div id="webplayer_contents">
  <div id="player_area"><div id="player"><video id="livePlayer"></video>
    <ul><li class="btn_chat"><button id="chatToggle" type="button" onclick="document.getElementById('webplayer').classList.toggle('chat_open'); window.nativeClicks = (window.nativeClicks || 0) + 1">Chat window on/off</button></li></ul></div></div>
  <div class="wrapping side"><section class="chatting_box"><div id="chatting_area"><div id="chatbox" class="chatbox"><div id="chat_area"></div><input id="draft"><button id="send" type="button">Send</button></div></div></section></div>
</div></div></body>`;

async function open(t: TestContext, engine: keyof typeof browsers, url: string, body: string): Promise<Page> {
  const tab = await (await browsers[engine].newContext(t, { viewport: { width: 1280, height: 800 } })).newPage();
  await tab.route('https://*.sooplive.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body }));
  await tab.goto(url);
  await tab.addScriptTag({ content: bundle });
  await tab.evaluate("NativeChat.exposeFixtureRuntime('isolated');");
  await tab.addScriptTag({ content: provider });
  return tab;
}

for (const engine of testEngines()) describe(`${engine} SOOP native chat`, () => {
  it('refreshes identity and native visibility on the registered history event without URL polling', async t => {
    const tab = await open(t, engine, LIVE, page(true));
    const time = new Date('2026-01-01T00:00:00Z');
    await tab.clock.install({ time });
    await tab.clock.pauseAt(new Date(time.getTime() + 1000));
    await tab.evaluate(`(() => {
      window.__href = location.href;
      window.__controller = new NativeChat.ChatController({ document, href: () => window.__href, onChange() {}, onLayoutChange() {} });
      window.__controller.hide();
    })()`);
    const read = () => tab.evaluate(`({ identity: window.__controller.state.surface?.contentKey, visible: window.__controller.state.visible })`);
    const first = await read();
    assert.deepEqual(first, { identity: 'battleland/297994793', visible: false });
    await tab.evaluate(`window.__href = 'https://play.sooplive.com/lolglobal/298189961'`);
    await tab.clock.runFor(10000);
    assert.deepEqual(await read(), first, 'nothing polls the URL');
    await tab.evaluate(`window.dispatchEvent(new Event('theater-everywhere-soop-navigate'))`);
    await tab.clock.runFor(80);
    assert.deepEqual(await read(), { identity: 'lolglobal/298189961', visible: true });
    await tab.evaluate('window.__controller.dispose()');
  });

  it('finds the panel for a live broadcast and a recording, reading the player\'s own open state', async t => {
    const tab = await open(t, engine, LIVE, page(true));
    const report = await tab.evaluate(`(() => {
      const live = NativeChat.detectChatSurface(document, ${JSON.stringify(LIVE)});
      const vod = NativeChat.detectChatSurface(document, ${JSON.stringify(VOD)});
      document.getElementById('webplayer').classList.remove('chat_open');
      const closed = NativeChat.detectChatSurface(document, ${JSON.stringify(LIVE)});
      const out = {
        live: [live.provider, live.kind, live.contentKey, live.root.id, live.contentRoot.id, live.initiallyVisible, live.revealAncestors.map(e => e.id || e.className).slice(0, 3)],
        vod: [vod.kind, vod.contentKey], closed: closed.initiallyVisible,
        channel: NativeChat.detectChatSurface(document, 'https://play.sooplive.com/battleland'),
        catchClip: NativeChat.detectChatSurface(document, 'https://vod.sooplive.com/player/catch')
      };
      document.querySelector('.chatbox').remove();
      out.noPanel = NativeChat.detectChatSurface(document, ${JSON.stringify(LIVE)});
      return out;
    })()`);
    assert.deepEqual(report, {
      live: ['soop', 'live', 'battleland/297994793', 'chatting_area', 'chatbox', true, ['chatting_box', 'wrapping side', 'webplayer_contents']],
      vod: ['replay', '211006561'], closed: false, channel: null, catchClip: null, noPanel: null
    });
  });

  it('finds a recording panel by its class, since the id differs from the live page', async t => {
    const tab = await open(t, engine, VOD, page(true).replace('id="chatbox"', 'id="chatbox_height"'));
    const report = await tab.evaluate(`(() => {
      const surface = NativeChat.detectChatSurface(document, ${JSON.stringify(VOD)});
      return surface && [surface.kind, surface.root.id, surface.contentRoot.id, surface.initiallyVisible];
    })()`);
    assert.deepEqual(report, ['replay', 'chatting_area', 'chatbox_height', true]);
  });

  it('shows and hides the original panel without moving it, and keeps its message list out of the way', async t => {
    const tab = await open(t, engine, LIVE, page(true));
    const report = await tab.evaluate(`(() => {
      const root = document.getElementById('chatting_area');
      const parent = root.parentElement;
      const controller = new NativeChat.ChatController({ document, href: () => ${JSON.stringify(LIVE)}, onChange() {}, onLayoutChange() {} });
      controller.start();
      document.documentElement.classList.add('theater-everywhere-html-active');
      controller.show();
      const shown = [root.hasAttribute('data-theater-chat'), root.hasAttribute('data-theater-chat-hidden'), controller.state.visible, document.documentElement.hasAttribute('data-theater-chat-visible')];
      const ancestors = [...document.querySelectorAll('[data-theater-chat-ancestor]')].map(e => e.id || e.className);
      for (let i = 0; i < 50; i++) document.getElementById('chat_area').append(document.createElement('p'));
      const sameSurface = controller.state.surface.root === root;
      controller.hide();
      const hidden = [root.hasAttribute('data-theater-chat-hidden'), root.hasAttribute('inert'), controller.state.visible];
      const result = { shown, ancestors, sameSurface, hidden, unmoved: root.parentElement === parent && root.isConnected };
      controller.dispose();
      result.released = [root.hasAttribute('data-theater-chat'), root.hasAttribute('inert'), document.documentElement.hasAttribute('data-theater-chat-active')];
      return result;
    })()`);
    const { ancestors, ...rest } = report as { ancestors: string[] } & Record<string, unknown>;
    assert.deepEqual(rest, { shown: [true, false, true, true], sameSurface: true, hidden: [true, true, false], unmoved: true, released: [false, false, false] });
    assert.deepEqual([...ancestors].sort(), ['chatting_box', 'webplayer', 'webplayer_contents', 'wrapping side']);
  });

  it('starts hidden while the player has the panel closed, and opens it through the player button on an explicit show', async t => {
    const tab = await open(t, engine, LIVE, page(false));
    const report = await tab.evaluate(`(async () => {
      const href = ${JSON.stringify(LIVE)};
      const control = document.getElementById('chatToggle');
      const offered = NativeChat.detectChatActivation(document, href, null);
      let changed = () => {};
      const controller = new NativeChat.ChatController({ document, href: () => href, onChange: () => changed(), onLayoutChange() {} });
      controller.start();
      const seeded = [controller.state.available, controller.state.visible];
      // The host opens by flipping a class: no mutation the controller watches. It must still notice.
      controller.show();
      controller.show();
      while (!controller.state.visible) await new Promise(resolve => { changed = resolve; });
      const result = { offered: offered && [offered.provider, offered.contentKey, offered.control === control], seeded, clicks: window.nativeClicks,
        opened: document.getElementById('webplayer').classList.contains('chat_open'), shown: !document.getElementById('chatting_area').hasAttribute('data-theater-chat-hidden') };
      result.whenOpen = NativeChat.detectChatActivation(document, href, null);
      document.getElementById('webplayer').classList.remove('chat_open');
      control.disabled = true;
      result.disabled = NativeChat.detectChatActivation(document, href, null);
      controller.dispose();
      return result;
    })()`);
    assert.deepEqual(report, { offered: ['soop', 'battleland/297994793', true], seeded: [true, false], clicks: 1, opened: true, shown: true, whenOpen: null, disabled: null });
  });

  it('keeps the requested theme but leaves SOOP its own appearance', async t => {
    const tab = await open(t, engine, LIVE, page(true));
    const report = await tab.evaluate(`(() => {
      const controller = new NativeChat.ChatController({ document, href: () => ${JSON.stringify(LIVE)}, onChange() {}, onLayoutChange() {} });
      controller.start();
      controller.setTheme('dark');
      const state = [controller.state.theme, controller.state.themeStatus, [...document.documentElement.attributes].some(a => /theme/.test(a.name))];
      controller.dispose();
      return state;
    })()`);
    assert.deepEqual(report, ['dark', 'unavailable', false]);
  });

  it('treats events inside the SOOP chat as chat events and leaves the player to the page shortcuts', async t => {
    const tab = await open(t, engine, LIVE, page(true));
    const report = await tab.evaluate(`(() => {
      const caught = target => { let hit = null; const listener = event => { hit = NativeChat.isNativeChatEvent(event); }; document.addEventListener('keydown', listener, true); target.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true, composed: true })); document.removeEventListener('keydown', listener, true); return hit; };
      return [caught(document.getElementById('draft')), caught(document.getElementById('chat_area')), caught(document.getElementById('livePlayer'))];
    })()`);
    assert.deepEqual(report, [true, true, false]);
  });

  it('keeps the entry shortcut typed in the SOOP chat out of the MAIN-world capture', async t => {
    const tab = await (await browsers[engine].newContext(t, { viewport: { width: 1280, height: 800 } })).newPage();
    await tab.route('https://*.sooplive.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: page(true) }));
    await tab.goto(LIVE);
    await tab.addScriptTag({ content: main });
    await tab.evaluate("MainChat.exposeFixtureRuntime('main');");
    await tab.addScriptTag({ content: mainProvider });
    await tab.evaluate(`(() => {
      MainChat.installMainWorldRuntime();
      document.documentElement.setAttribute(MainChat.ENTRY_SHORTCUT_ATTRIBUTE, JSON.stringify({ toggle: 'T' }));
      // The content world claims every relayed entry key, as it does with a video to enter.
      window.__relayed = [];
      window.addEventListener(MainChat.ENTRY_SHORTCUT_EVENT, event => { window.__relayed.push(document.activeElement.id); event.preventDefault(); });
      window.__page = [];
      document.addEventListener('keydown', event => window.__page.push(event.target.id));
    })()`);
    // The chat input is editable and was never captured; the send button is a chat control that is not.
    for (const id of ['draft', 'send', 'chatToggle']) {
      await tab.focus(`#${id}`);
      await tab.keyboard.press('t');
    }
    assert.deepEqual(await tab.evaluate('({ relayed: window.__relayed, page: window.__page })'),
      { relayed: ['chatToggle'], page: ['draft', 'send'] }, 'only the key outside the chat is captured for theater');
  });
});
