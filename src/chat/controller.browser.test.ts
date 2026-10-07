import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import type { Browser, Page } from 'playwright';

const require = createRequire(import.meta.url);

function bundle(): string {
  const esbuild = require('esbuild') as {
    buildSync: (options: {
      entryPoints: string[];
      bundle: boolean;
      write: boolean;
      format: 'iife';
      globalName: string;
      platform: 'browser';
      target: string;
      logLevel: 'silent';
    }) => { outputFiles: Array<{ text: string }> };
  };
  return esbuild.buildSync({
    entryPoints: [new URL('./index.ts', import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'NativeChat',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent'
  }).outputFiles[0].text;
}

const TWITCH = `<div id="layout" style="width:1000px">
  <div class="persistent-player" id="player"></div>
  <div class="right-column" data-a-target="right-column-chat-bar" id="column" style="width:360px;color:rgb(1, 2, 3)">
    <section class="chat-room" data-test-selector="chat-room-component-layout" data-a-target="chat-theme-light">
      <div class="chat-shell chat-shell__expanded">
        <textarea class="chat-input" id="draft"></textarea>
        <div id="lines"></div>
      </div>
    </section>
  </div>
</div>`;

const YOUTUBE = `<div id="columns">
  <div id="primary"><div id="related">related</div></div>
  <div id="secondary">
    <div id="chat">
      <ytd-live-chat-frame>
        <iframe id="chatframe" src="https://www.youtube.com/live_chat?v=AbCdEfGhIjK"></iframe>
      </ytd-live-chat-frame>
      <textarea id="draft"></textarea>
    </div>
    <button id="recommendation" type="button">up next</button>
  </div>
</div>`;

describe('native chat controller', () => {
  let browser: Browser | null = null;
  let code = '';

  before(async () => {
    const { chromium } = await import('playwright');
    if (!existsSync(chromium.executablePath())) return;
    code = bundle();
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
  });

  async function pageWith(html: string, viewport = { width: 1280, height: 800 }): Promise<Page> {
    if (!browser) throw new Error('browser unavailable');
    const page = await browser.newPage({ viewport });
    await page.setContent(`<!doctype html><html><body>${html}<button id="toggle" type="button">chat</button></body></html>`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: code });
    return page;
  }

  it('detects the current Twitch or YouTube chat and ignores chat documents, mismatches, and new embeds', async () => {
    if (!browser) return;
    const page = await pageWith(`${TWITCH}${YOUTUBE}<iframe id="foreign" src="https://www.youtube.com/live_chat?v=ZZZZZZZZZZZ"></iframe>`);
    try {
      const report = await page.evaluate(`(() => {
        const api = window.NativeChat;
        const column = document.getElementById('column');
        const twitch = api.detectChatSurface(document, 'https://www.twitch.tv/SomeChannel');
        const replay = api.detectChatSurface(document, 'https://www.twitch.tv/videos/55');
        const youtube = api.detectChatSurface(document, 'https://www.youtube.com/watch?v=AbCdEfGhIjK');
        const live = api.detectChatSurface(document, 'https://www.youtube.com/live/AbCdEfGhIjK');
        const embed = api.detectChatSurface(document, 'https://www.youtube.com/embed/AbCdEfGhIjK');
        const mismatch = api.detectChatSurface(document, 'https://www.youtube.com/watch?v=OtherVideo1');
        const chatDoc = api.detectChatSurface(document, 'https://www.youtube.com/live_chat?v=AbCdEfGhIjK');
        const popout = api.detectChatSurface(document, 'https://www.twitch.tv/popout/SomeChannel/chat');
        const foreign = api.detectChatSurface(document, 'https://example.com/watch?v=AbCdEfGhIjK');
        const shorts = api.detectChatSurface(document, 'https://www.youtube.com/shorts/AbCdEfGhIjK');
        document.querySelector('#chat iframe').setAttribute('src', 'https://www.youtube.com/live_chat_replay?continuation=abc');
        const structural = api.detectChatSurface(document, 'https://www.youtube.com/watch?v=AbCdEfGhIjK');
        document.querySelector('#chat iframe').setAttribute('src', 'https://www.youtube.com/live_chat?continuation=abc');
        const bareLive = api.detectChatSurface(document, 'https://www.youtube.com/watch?v=AbCdEfGhIjK');
        return {
          twitchRoot: twitch && twitch.root === column,
          twitchKey: twitch && twitch.contentKey,
          twitchKind: twitch && twitch.kind,
          twitchAncestors: twitch ? twitch.revealAncestors.map((node) => node.id) : [],
          replayKind: replay && replay.kind,
          replayKey: replay && replay.contentKey,
          youtubeRoot: youtube && youtube.root.id,
          youtubeAncestors: youtube ? youtube.revealAncestors.map((node) => node.id) : [],
          youtubeFrame: youtube && youtube.iframe && youtube.iframe.id,
          youtubeKind: youtube && youtube.kind,
          liveKey: live && live.contentKey,
          embedKey: embed && embed.contentKey,
          mismatch: mismatch,
          chatDoc: chatDoc,
          popout: popout,
          foreign: foreign,
          shorts: shorts,
          structural: structural && structural.kind,
          bareLive: bareLive,
          initiallyVisible: twitch && twitch.initiallyVisible
        };
      })()`) as {
        twitchRoot: boolean;
        twitchKey: string;
        twitchKind: string;
        twitchAncestors: string[];
        replayKind: string;
        replayKey: string;
        youtubeRoot: string;
        youtubeAncestors: string[];
        youtubeFrame: string;
        youtubeKind: string;
        liveKey: string;
        embedKey: string;
        mismatch: null;
        chatDoc: null;
        popout: null;
        foreign: null;
        shorts: null;
        structural: string;
        bareLive: null;
        initiallyVisible: boolean;
      };
      assert.equal(report.twitchRoot, true);
      assert.equal(report.twitchKey, 'somechannel');
      assert.equal(report.twitchKind, 'live');
      assert.deepEqual(report.twitchAncestors, ['layout']);
      assert.equal(report.replayKind, 'replay');
      assert.equal(report.replayKey, '55');
      assert.equal(report.youtubeRoot, 'chat');
      assert.deepEqual(report.youtubeAncestors, ['secondary', 'columns']);
      assert.equal(report.youtubeFrame, 'chatframe');
      assert.equal(report.youtubeKind, 'live');
      assert.equal(report.liveKey, 'AbCdEfGhIjK');
      assert.equal(report.embedKey, 'AbCdEfGhIjK');
      assert.equal(report.mismatch, null);
      assert.equal(report.chatDoc, null);
      assert.equal(report.popout, null);
      assert.equal(report.foreign, null);
      assert.equal(report.shorts, null);
      assert.equal(report.structural, 'replay');
      assert.equal(report.bareLive, null);
      assert.equal(report.initiallyVisible, true);
    } finally {
      await page.close();
    }
  });

  it('shows and hides the original Twitch node without moving it, reloading it, or scanning each message', async () => {
    if (!browser) return;
    const page = await pageWith(TWITCH);
    try {
      const report = await page.evaluate(`(async () => {
        const column = document.getElementById('column');
        const draft = document.getElementById('draft');
        const parent = column.parentNode;
        const next = column.nextSibling;
        draft.value = 'keep this draft';
        const styleBefore = column.getAttribute('style');
        let scans = 0;
        const original = Document.prototype.querySelector;
        Document.prototype.querySelector = function(selector) {
          scans += 1;
          return original.call(this, selector);
        };
        const persisted = [];
        window.__href = 'https://www.twitch.tv/SomeChannel';
        const controller = new window.NativeChat.ChatController({
          document,
          href: () => window.__href,
          onChange() {},
          onLayoutChange() {},
          focusToggle() { document.getElementById('toggle').focus(); },
          persistPreference(provider, preference) { persisted.push({ provider, visible: preference.visible, width: preference.width }); }
        });
        scans = 0;
        const lines = document.getElementById('lines');
        for (let index = 0; index < 30; index += 1) {
          const line = document.createElement('div');
          line.className = 'chat-line__message';
          line.textContent = 'hello ' + index;
          lines.append(line);
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
        const duringMessages = scans;
        draft.focus();
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        const beforeHide = {
          video: document.documentElement.style.getPropertyValue('--theater-video-width'),
          chat: document.documentElement.style.getPropertyValue('--theater-chat-width'),
          left: document.documentElement.style.getPropertyValue('--theater-chat-left')
        };
        controller.hide();
        const hidden = {
          active: document.documentElement.hasAttribute('data-theater-chat-active'),
          visible: document.documentElement.hasAttribute('data-theater-chat-visible'),
          hidden: column.hasAttribute('data-theater-chat-hidden'),
          inert: column.hasAttribute('inert'),
          marked: column.hasAttribute('data-theater-chat'),
          playerMarked: document.getElementById('player').hasAttribute('data-theater-chat'),
          focus: document.activeElement && document.activeElement.id,
          draft: draft.value,
          parent: column.parentNode === parent,
          next: column.nextSibling === next,
          style: column.getAttribute('style') === styleBefore,
          video: document.documentElement.style.getPropertyValue('--theater-video-width'),
          chat: document.documentElement.style.getPropertyValue('--theater-chat-width'),
          dock: controller.state.dock,
          available: controller.state.available
        };
        controller.show();
        controller.setWidth(410);
        controller.setWidth(410);
        const shown = {
          hidden: column.hasAttribute('data-theater-chat-hidden'),
          inert: column.hasAttribute('inert'),
          visibleAttr: document.documentElement.hasAttribute('data-theater-chat-visible'),
          width: controller.state.width,
          video: document.documentElement.style.getPropertyValue('--theater-video-width'),
          chat: document.documentElement.style.getPropertyValue('--theater-chat-width'),
          parent: column.parentNode === parent,
          draft: draft.value
        };
        const old = column;
        old.remove();
        window.__href = 'https://www.twitch.tv/videos/42';
        const replacement = column.cloneNode(true);
        replacement.id = 'next-column';
        document.getElementById('layout').append(replacement);
        await new Promise((resolve) => setTimeout(resolve, 200));
        const replaced = {
          oldMarked: old.hasAttribute('data-theater-chat'),
          nextMarked: replacement.hasAttribute('data-theater-chat'),
          nextHidden: replacement.hasAttribute('data-theater-chat-hidden'),
          key: controller.state.surface && controller.state.surface.contentKey,
          kind: controller.state.surface && controller.state.surface.kind,
          visible: controller.state.visible,
          root: controller.state.surface && controller.state.surface.root === replacement
        };
        document.documentElement.style.setProperty('--keep-me', '7');
        document.documentElement.style.setProperty('--theater-video-width', '12px');
        replacement.style.outline = '1px solid red';
        replacement.setAttribute('data-theater-chat', 'site');
        controller.dispose();
        controller.dispose();
        return {
          duringMessages,
          viewport,
          beforeHide,
          hidden,
          shown,
          replaced,
          persisted,
          disposed: {
            keep: document.documentElement.style.getPropertyValue('--keep-me'),
            video: document.documentElement.style.getPropertyValue('--theater-video-width'),
            chatTop: document.documentElement.style.getPropertyValue('--theater-chat-top'),
            active: document.documentElement.hasAttribute('data-theater-chat-active'),
            site: replacement.getAttribute('data-theater-chat'),
            outline: replacement.style.outline,
            color: replacement.style.color,
            inert: replacement.hasAttribute('inert')
          }
        };
      })()`) as {
        duringMessages: number;
        viewport: { width: number; height: number };
        beforeHide: { video: string; chat: string; left: string };
        hidden: {
          active: boolean; visible: boolean; hidden: boolean; inert: boolean; marked: boolean;
          playerMarked: boolean; focus: string; draft: string; parent: boolean; next: boolean;
          style: boolean; video: string; chat: string; dock: string; available: boolean;
        };
        shown: {
          hidden: boolean; inert: boolean; visibleAttr: boolean; width: number; video: string;
          chat: string; parent: boolean; draft: string;
        };
        replaced: {
          oldMarked: boolean; nextMarked: boolean; nextHidden: boolean; key: string; kind: string;
          visible: boolean; root: boolean;
        };
        persisted: Array<{ provider: string; visible: boolean; width: number }>;
        disposed: {
          keep: string; video: string; chatTop: string; active: boolean; site: string;
          outline: string; color: string; inert: boolean;
        };
      };

      assert.equal(report.duringMessages, 0);
      assert.equal(report.beforeHide.chat, '360px');
      assert.equal(report.beforeHide.video, `${report.viewport.width - 360}px`);
      assert.equal(report.beforeHide.left, `${report.viewport.width - 360}px`);
      assert.equal(report.hidden.active, true);
      assert.equal(report.hidden.visible, false);
      assert.equal(report.hidden.hidden, true);
      assert.equal(report.hidden.inert, true);
      assert.equal(report.hidden.marked, true);
      assert.equal(report.hidden.playerMarked, false);
      assert.equal(report.hidden.focus, 'toggle');
      assert.equal(report.hidden.draft, 'keep this draft');
      assert.equal(report.hidden.parent, true);
      assert.equal(report.hidden.next, true);
      assert.equal(report.hidden.style, true);
      assert.equal(report.hidden.video, `${report.viewport.width}px`);
      assert.equal(report.hidden.chat, '360px');
      assert.equal(report.hidden.dock, 'right');
      assert.equal(report.hidden.available, true);
      assert.equal(report.shown.hidden, false);
      assert.equal(report.shown.inert, false);
      assert.equal(report.shown.visibleAttr, true);
      assert.equal(report.shown.width, 410);
      assert.equal(report.shown.chat, '410px');
      assert.equal(report.shown.video, `${report.viewport.width - 410}px`);
      assert.equal(report.shown.parent, true);
      assert.equal(report.shown.draft, 'keep this draft');
      assert.equal(report.replaced.oldMarked, false);
      assert.equal(report.replaced.nextMarked, true);
      assert.equal(report.replaced.nextHidden, false);
      assert.equal(report.replaced.key, '42');
      assert.equal(report.replaced.kind, 'replay');
      assert.equal(report.replaced.visible, true);
      assert.equal(report.replaced.root, true);
      assert.deepEqual(report.persisted, [
        { provider: 'twitch', visible: false, width: 360 },
        { provider: 'twitch', visible: true, width: 360 },
        { provider: 'twitch', visible: true, width: 410 }
      ]);
      assert.equal(report.disposed.keep, '7');
      assert.equal(report.disposed.video, '12px');
      assert.equal(report.disposed.chatTop, '');
      assert.equal(report.disposed.active, false);
      assert.equal(report.disposed.site, 'site');
      assert.match(report.disposed.outline, /red/);
      assert.equal(report.disposed.color, 'rgb(1, 2, 3)');
      assert.equal(report.disposed.inert, false);
    } finally {
      await page.close();
    }
  });

  it('keeps a collapsed Twitch chat available, then honors a stored override across width clamps', async () => {
    if (!browser) return;
    const page = await pageWith(`<div id="layout" style="width:800px"><div class="right-column" data-a-target="right-column-chat-bar" id="column" style="width:0"><section data-test-selector="chat-room-component-layout"><div class="chat-shell chat-shell__expanded"></div></section></div></div>`);
    try {
      const collapsed = await page.evaluate(`(() => {
        const persisted = [];
        const controller = new window.NativeChat.ChatController({
          document,
          href: () => 'https://www.twitch.tv/SomeChannel',
          onChange() {},
          onLayoutChange() {},
          initialPreferences: { twitch: { visible: true, width: 10 } },
          persistPreference(provider, preference) { persisted.push(preference.visible + ':' + preference.width); }
        });
        const column = document.getElementById('column');
        return {
          available: controller.state.available,
          visible: controller.state.visible,
          width: controller.state.width,
          hidden: column.hasAttribute('data-theater-chat-hidden'),
          persisted: persisted.slice()
        };
      })()`) as { available: boolean; visible: boolean; width: number; hidden: boolean; persisted: string[] };
      assert.equal(collapsed.available, true);
      assert.equal(collapsed.visible, true);
      assert.equal(collapsed.width, 280);
      assert.equal(collapsed.hidden, false);
      assert.deepEqual(collapsed.persisted, []);
    } finally {
      await page.close();
    }
  });

  it('preserves a YouTube frame and reveals #secondary while messages inside #chat do not rescan', async () => {
    if (!browser) return;
    const page = await pageWith(YOUTUBE);
    try {
      const report = await page.evaluate(`(async () => {
        const frame = document.getElementById('chatframe');
        const chat = document.getElementById('chat');
        const parent = frame.parentNode;
        const next = frame.nextSibling;
        const src = frame.getAttribute('src');
        let writes = 0;
        const proto = HTMLIFrameElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'src');
        Object.defineProperty(proto, 'src', {
          configurable: true,
          get() { return descriptor.get.call(this); },
          set(value) { writes += 1; descriptor.set.call(this, value); }
        });
        let scans = 0;
        const queryAll = Document.prototype.querySelectorAll;
        Document.prototype.querySelectorAll = function(selector) {
          scans += 1;
          return queryAll.call(this, selector);
        };
        const draft = document.getElementById('draft');
        draft.value = 'youtube draft';
        const controller = new window.NativeChat.ChatController({
          document,
          href: () => 'https://www.youtube.com/watch?v=AbCdEfGhIjK',
          onChange() {},
          onLayoutChange() {}
        });
        scans = 0;
        for (let index = 0; index < 20; index += 1) chat.append(document.createElement('div'));
        await new Promise((resolve) => setTimeout(resolve, 180));
        const duringMessages = scans;
        controller.toggle();
        controller.toggle();
        controller.setWidth(900);
        const before = {
          writes,
          parent: frame.parentNode === parent,
          next: frame.nextSibling === next,
          draft: draft.value,
          width: controller.state.width,
          secondary: document.getElementById('secondary').hasAttribute('data-theater-chat-ancestor'),
          columns: document.getElementById('columns').hasAttribute('data-theater-chat-ancestor'),
          src: frame.getAttribute('src')
        };
        frame.setAttribute('src', 'https://www.youtube.com/live_chat?v=OtherVideo1');
        await new Promise((resolve) => setTimeout(resolve, 1100));
        return {
          duringMessages,
          before,
          afterRetarget: {
            available: controller.state.available,
            marked: chat.hasAttribute('data-theater-chat'),
            secondary: document.getElementById('secondary').hasAttribute('data-theater-chat-ancestor'),
            src: frame.getAttribute('src')
          }
        };
      })()`) as {
        duringMessages: number;
        before: {
          writes: number; parent: boolean; next: boolean; draft: string; width: number;
          secondary: boolean; columns: boolean; src: string;
        };
        afterRetarget: { available: boolean; marked: boolean; secondary: boolean; src: string };
      };
      assert.equal(report.duringMessages, 0);
      assert.equal(report.before.writes, 0);
      assert.equal(report.before.src, 'https://www.youtube.com/live_chat?v=AbCdEfGhIjK');
      assert.equal(report.before.parent, true);
      assert.equal(report.before.next, true);
      assert.equal(report.before.draft, 'youtube draft');
      assert.equal(report.before.width, 600);
      assert.equal(report.before.secondary, true);
      assert.equal(report.before.columns, true);
      assert.equal(report.afterRetarget.available, false);
      assert.equal(report.afterRetarget.marked, false);
      assert.equal(report.afterRetarget.secondary, false);
      assert.equal(report.afterRetarget.src, 'https://www.youtube.com/live_chat?v=OtherVideo1');
    } finally {
      await page.close();
    }
  });

  it('docks to the bottom under 900px and finds a chat that mounts later', async () => {
    if (!browser) return;
    const page = await pageWith('<div id="layout" style="width:800px"></div>', { width: 899, height: 700 });
    try {
      const report = await page.evaluate(`(async () => {
        window.__href = 'https://www.twitch.tv/laterchannel';
        let layouts = 0;
        const controller = new window.NativeChat.ChatController({
          document,
          href: () => window.__href,
          onChange() {},
          onLayoutChange() { layouts += 1; }
        });
        const missing = { available: controller.state.available, dock: controller.state.dock };
        document.getElementById('layout').insertAdjacentHTML('beforeend', '<div class="right-column" data-a-target="right-column-chat-bar" id="column"><section data-test-selector="chat-room-component-layout"><div class="chat-shell chat-shell__collapsed"></div></section></div>');
        await new Promise((resolve) => setTimeout(resolve, 200));
        const found = {
          available: controller.state.available,
          visible: controller.state.visible,
          hidden: document.getElementById('column').hasAttribute('data-theater-chat-hidden'),
          dock: controller.state.dock,
          video: document.documentElement.style.getPropertyValue('--theater-video-height'),
          chat: document.documentElement.style.getPropertyValue('--theater-chat-height'),
          top: document.documentElement.style.getPropertyValue('--theater-chat-top'),
          widthVar: document.documentElement.style.getPropertyValue('--theater-chat-width')
        };
        return { missing, found, height: window.innerHeight, width: window.innerWidth, layouts };
      })()`) as {
        missing: { available: boolean; dock: string };
        found: {
          available: boolean; visible: boolean; hidden: boolean; dock: string;
          video: string; chat: string; top: string; widthVar: string;
        };
        height: number;
        width: number;
        layouts: number;
      };
      assert.equal(report.missing.available, false);
      assert.equal(report.missing.dock, 'bottom');
      assert.equal(report.found.available, true);
      assert.equal(report.found.visible, false);
      assert.equal(report.found.hidden, true);
      assert.equal(report.found.dock, 'bottom');
      assert.equal(report.width, 899);
      assert.equal(report.found.video, `${report.height}px`);
      assert.notEqual(report.found.chat, '0px');
      assert.equal(report.found.top, `${report.height - Number.parseInt(report.found.chat, 10)}px`);
      assert.equal(report.found.widthVar, `${report.width}px`);
      assert.ok(report.layouts > 0);
    } finally {
      await page.close();
    }
  });

  it('adopts YouTube programmatic chat frames and rejects stale watch identities', async () => {
    if (!browser) return;
    const page = await pageWith(`<ytd-watch-flexy video-id="AbCdEfGhIjK"><div id="secondary">
      <ytd-live-chat-frame id="chat"><iframe id="chatframe"></iframe></ytd-live-chat-frame>
    </div></ytd-watch-flexy>`);
    try {
      const report = await page.evaluate(`(async () => {
        const api = window.NativeChat;
        const frame = document.getElementById('chatframe');
        const watch = document.querySelector('ytd-watch-flexy');
        const originalDocument = frame.contentDocument;
        let loads = 0;
        frame.addEventListener('load', () => loads++);
        await new Promise(resolve => setTimeout(resolve, 100));
        const beforeLoads = loads;
        const surface = api.detectChatSurface(document, 'https://www.youtube.com/@LofiGirl/live');
        const controller = new api.ChatController({document,
          href: () => 'https://www.youtube.com/watch?v=AbCdEfGhIjK', onChange() {}, onLayoutChange() {}});
        controller.hide(); controller.show();
        await new Promise(resolve => setTimeout(resolve, 120));
        const preserved = frame.contentDocument === originalDocument && loads === beforeLoads && !frame.hasAttribute('src');
        watch.setAttribute('video-id', 'OtherVideo1');
        await new Promise(resolve => setTimeout(resolve, 120));
        const staleAvailable = controller.state.available;
        const next = api.detectChatSurface(document, 'https://www.youtube.com/@LofiGirl/live');
        frame.setAttribute('src', 'https://www.youtube.com/live_chat?v=WrongVideo1');
        const mismatch = api.detectChatSurface(document, 'https://www.youtube.com/watch?v=OtherVideo1');
        controller.dispose();
        return {key: surface?.contentKey, kind: surface?.kind, preserved, staleAvailable, nextKey: next?.contentKey, mismatch: mismatch === null};
      })()`) as { key: string; kind: string; preserved: boolean; staleAvailable: boolean; nextKey: string; mismatch: boolean };
      assert.deepEqual(report, { key: 'AbCdEfGhIjK', kind: 'live', preserved: true, staleAvailable: false, nextKey: 'OtherVideo1', mismatch: true });
    } finally { await page.close(); }
  });

  it('keeps native inert state and rebinds a Twitch component inside the same column', async () => {
    if (!browser) return;
    const page = await pageWith(TWITCH);
    try {
      const report = await page.evaluate(`(async () => {
        const column = document.getElementById('column');
        column.inert = true;
        const controller = new window.NativeChat.ChatController({document,
          href: () => 'https://www.twitch.tv/SomeChannel', onChange() {}, onLayoutChange() {}});
        const originalInert = column.inert;
        controller.hide(); controller.show();
        const shownInert = column.inert;
        const old = column.querySelector('.chat-room');
        old.remove();
        await new Promise(resolve => setTimeout(resolve, 120));
        const missing = !controller.state.available;
        const next = document.createElement('section'); next.className = 'chat-room';
        column.append(next);
        await new Promise(resolve => setTimeout(resolve, 120));
        const rebound = controller.state.surface?.root === column && controller.state.surface?.contentRoot === next;
        controller.dispose();
        return {originalInert, shownInert, missing, rebound, restoredInert: column.inert};
      })()`) as { originalInert: boolean; shownInert: boolean; missing: boolean; rebound: boolean; restoredInert: boolean };
      assert.deepEqual(report, { originalInert: true, shownInert: true, missing: true, rebound: true, restoredInert: true });
    } finally { await page.close(); }
  });

  it('treats native chat, service portals, and chat documents as chat events and ignores the rest of the page', async () => {
    if (!browser) return;
    const watch = await browser.newPage();
    const twitch = await browser.newPage();
    const popout = await browser.newPage();
    try {
      await watch.route('https://www.youtube.com/**', (route) => {
        if (route.request().resourceType() !== 'document') return route.abort();
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: `<!doctype html><body>
            <div id="secondary"><button id="recommendation" type="button">next</button></div>
            <div id="chat"><button id="chat-button" type="button">chat</button></div>
            <button id="page" type="button">page</button>
            <yt-live-chat-header-renderer><button id="header" type="button">header</button></yt-live-chat-header-renderer>
          </body>`
        });
      });
      await watch.goto('https://www.youtube.com/watch?v=AbCdEfGhIjK', { waitUntil: 'domcontentloaded' });
      await watch.addScriptTag({ content: code });
      const watchReport = await watch.evaluate(`(() => {
        const api = window.NativeChat;
        const hit = (id) => {
          let value = false;
          const node = document.getElementById(id);
          node.addEventListener('keydown', (event) => { value = api.isNativeChatEvent(event); });
          node.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true, composed: true }));
          return value;
        };
        const report = {
          chat: hit('chat-button'),
          recommendation: hit('recommendation'),
          page: hit('page'),
          header: hit('header')
        };
        let body = false;
        document.body.addEventListener('keydown', (event) => { body = api.isNativeChatEvent(event); });
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true, composed: true }));
        return { ...report, body };
      })()`) as { chat: boolean; recommendation: boolean; page: boolean; header: boolean; body: boolean };

      await twitch.route('https://www.twitch.tv/**', (route) => {
        if (route.request().resourceType() !== 'document') return route.abort();
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: `<!doctype html><body>
            <div class="persistent-player"><button id="video" type="button">video</button></div>
            <div class="right-column" data-a-target="right-column-chat-bar"><button id="chat" type="button">chat</button></div>
            <div class="ReactModalPortal"><button id="emote" type="button">emote</button></div>
            <div class="tw-dialog-layer"><button id="dialog" type="button">dialog</button></div>
          </body>`
        });
      });
      await twitch.goto('https://www.twitch.tv/somechannel', { waitUntil: 'domcontentloaded' });
      await twitch.addScriptTag({ content: code });
      const twitchReport = await twitch.evaluate(`(() => {
        const api = window.NativeChat;
        const hit = (id) => {
          let value = false;
          const node = document.getElementById(id);
          node.addEventListener('keydown', (event) => { value = api.isNativeChatEvent(event); });
          node.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, composed: true }));
          return value;
        };
        return { video: hit('video'), chat: hit('chat'), emote: hit('emote'), dialog: hit('dialog') };
      })()`) as { video: boolean; chat: boolean; emote: boolean; dialog: boolean };

      await popout.route('https://www.twitch.tv/**', (route) => {
        if (route.request().resourceType() !== 'document') return route.abort();
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><body><button id="body-button" type="button">x</button></body>'
        });
      });
      await popout.goto('https://www.twitch.tv/popout/somechannel/chat', { waitUntil: 'domcontentloaded' });
      await popout.addScriptTag({ content: code });
      const popoutReport = await popout.evaluate(`(() => {
        const api = window.NativeChat;
        let body = false;
        document.body.addEventListener('keydown', (event) => { body = api.isNativeChatEvent(event); });
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true, composed: true }));
        const detected = api.detectChatSurface(document, location.href);
        return { body, detected, chatDocument: api.isChatDocument(location.href) };
      })()`) as { body: boolean; detected: null; chatDocument: boolean };

      assert.equal(watchReport.chat, true);
      assert.equal(watchReport.header, true);
      assert.equal(watchReport.recommendation, false);
      assert.equal(watchReport.page, false);
      assert.equal(watchReport.body, false);
      assert.equal(twitchReport.video, false);
      assert.equal(twitchReport.chat, true);
      assert.equal(twitchReport.emote, true);
      assert.equal(twitchReport.dialog, true);
      assert.equal(popoutReport.chatDocument, true);
      assert.equal(popoutReport.detected, null);
      assert.equal(popoutReport.body, true);
    } finally {
      await watch.close();
      await twitch.close();
      await popout.close();
    }
  });
});
