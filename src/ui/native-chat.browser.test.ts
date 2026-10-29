import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it, type TestContext } from 'node:test';

import type { BrowserContextOptions, Frame, Page, Route } from 'playwright';

import type { ChatState } from '../chat';
import { sharedEngineBrowsers } from '../test-utils/engine-browsers';
import { PROVIDER_ENTRIES, bundleModules, playerStylesheets } from '../test-utils/player-boot';
import type { sharedTestBrowser } from '../test-utils/test-browser';
import { testEngines } from '../test-utils/test-engines';

declare global {
  interface Window {
    NativeChatTest: { nativeChatState(): ChatState | null };
  }
}

const PAGE_CSS = playerStylesheets().page;
const UI_CSS = playerStylesheets().ui;
const browsers = sharedEngineBrowsers();
const VOD = readFileSync(new URL('../../test/fixtures/vod.webm', import.meta.url));
const BUNDLE = bundleModules([
  ...PROVIDER_ENTRIES,
  "export { bootstrapPlayerRuntime } from './ui/player-runtime';",
  "export { setPlayerUiCss } from './ui/root';",
  "export { installMainWorldRuntime } from './platform/main-world-runtime';",
  "export { nativeChatState } from './ui/chat';"
], 'NativeChatTest');

const YOUTUBE_WATCH = 'https://www.youtube.com/watch?v=abcdefghijk';
const TWITCH_CHANNEL = 'https://www.twitch.tv/example';
const CHOSEN_WIDTH = 420;

const YOUTUBE_THEME_CSS = readFileSync(new URL('../../test/fixtures/youtube-chat-theme.css', import.meta.url), 'utf8');
const TWITCH_THEME_CSS = readFileSync(new URL('../../test/fixtures/twitch-chat-theme.css', import.meta.url), 'utf8');

const CHAT_FRAME = `<!doctype html><html color-version="v2_0"><head><meta charset="utf-8"><title>Live chat</title><style>${YOUTUBE_THEME_CSS}</style></head><body style="background:rgb(253,250,245)"><yt-live-chat-app></yt-live-chat-app>
<textarea id="draft" aria-label="Say something"></textarea>
<button type="button" id="send">Send</button>
<script>
  window.__buttonClicks = 0;
  document.getElementById('send').addEventListener('click', () => { window.__buttonClicks += 1; });
</script>
</body></html>`;

const PAGE_STYLE = `<style>
  html, body { margin: 0; background: #111; }
  video { width: 960px; height: 540px; background: #000; display: block; }
  #movie_player, .persistent-player { width: 960px; height: 540px; view-transition-name: picture; }
  @keyframes native-panel-slide { from { transform: translateX(20px); } to { transform: translateX(0); } }
  #secondary { view-transition-name: secondary-column; animation: native-panel-slide .01s forwards; }
  #chat, .right-column { display: block; width: 340px; height: 420px; }
  #chat-container { display: block; width: 340px; }
</style>`;

type ChatMode = 'visible' | 'collapsed' | 'none';

function youtubeDocument(mode: ChatMode): string {
  const chat = mode === 'none' ? '<div id="comments">Ordinary watch page comments</div>' : `
    <div id="chat-container">
      <ytd-live-chat-frame id="chat"${mode === 'collapsed' ? ' style="display:block;width:0;height:0;overflow:hidden"' : ' style="color: rgb(1, 2, 3)"'}>
        <iframe id="chatframe" data-fixture-identity="primary"></iframe>
      </ytd-live-chat-frame>
    </div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>YouTube fixture</title>${PAGE_STYLE}</head><body>
    <ytd-watch-flexy video-id="abcdefghijk">
      <div id="movie_player" class="html5-video-player">
        <video muted autoplay loop playsinline src="https://www.youtube.com/fixtures/vod.webm"></video>
      </div>
      <div id="secondary">${chat}</div>
      <div id="below"></div>
    </ytd-watch-flexy>
    <script>
      const frame = document.getElementById('chatframe');
      window.__chatLoads = 0;
      if (frame) {
        frame.addEventListener('load', () => { window.__chatLoads += 1; });
        frame.src = 'https://www.youtube.com/live_chat?v=abcdefghijk';
        // YouTube reparents the native panel under #below on narrow windows.
        window.addEventListener('resize', () => {
          const container = document.getElementById('chat-container');
          const target = document.getElementById(innerWidth < 900 ? 'below' : 'secondary');
          if (container.parentElement !== target) target.moveBefore(container, null);
        });
      }
    </script>
  </body></html>`;
}

function twitchDocument(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Twitch fixture</title>${PAGE_STYLE}</head><body>
    <div class="persistent-player">
      <video muted autoplay loop playsinline src="https://www.twitch.tv/fixtures/vod.webm"></video>
    </div>
    <div class="right-column" data-a-target="right-column-chat-bar">
      <button type="button" data-a-target="right-column__toggle-collapse-btn" aria-label="Collapse Chat">Native toggle</button>
      <div class="chat-shell">
        <div class="stream-chat">
          <section class="chat-room" data-test-selector="chat-room-component-layout" style="color: rgb(1, 2, 3)">
            <div id="draft" contenteditable="true" role="textbox" aria-label="Send a message"></div>
            <button type="button" id="chat-menu">Chat menu</button>
          </section>
        </div>
      </div>
    </div>
    <script>
      window.__buttonClicks = 0;
      document.getElementById('chat-menu').addEventListener('click', () => { window.__buttonClicks += 1; });
    </script>
  </body></html>`;
}

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type ChatReadout = {
  available: boolean;
  visible: boolean;
  dock: string;
  width: number;
  theme: 'light' | 'native' | 'dark' | null;
} | null;
type Layout = {
  viewport: { width: number; height: number };
  video: Rect | null;
  chat: Rect | null;
  host: Rect | null;
  bar: Rect | null;
  contain: string;
  vars: Record<string, string>;
  chatHidden: boolean;
  active: boolean;
  visibleAttr: boolean;
  hitChat: boolean;
  state: ChatReadout;
  toggleHidden: boolean | null;
  toggleExpanded: string | null;
  toggleLabel: string | null;
  separator: Rect | null;
  separatorHidden: boolean | null;
  separatorValue: string | null;
  theater: boolean;
  paused: boolean;
  muted: boolean;
  pauseCalls: number;
  loads: number;
  src: string | null;
  identity: string | null;
  connected: boolean;
  parentId: string | null;
  parentTag: string | null;
  draft: string | null;
  siteRevision: string | null;
  siteClass: boolean;
  caretColor: string;
  presetColor: string;
  videoPosition: string;
  videoMarked: boolean;
  chatPosition: string;
  secondaryHidden: boolean | null;
  secondaryAncestor: boolean;
  chatCount: number;
  generation: string | null;
  detachedConnected: boolean | null;
  replacedLoads: number;
};

/**
 * Reads theater, chat, and fixture identity from the page.
 * DOM nodes stay in the page; only JSON-safe fields come back.
 * @returns The current layout and session readout.
 */
function readLayout(): Layout {
  const rect = (element: Element | null) => {
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return {
      left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height
    };
  };
  const host = document.getElementById('theater-everywhere-ui');
  const shadow = host?.shadowRoot ?? null;
  const chat = document.querySelector('[data-theater-chat]');
  const video = document.querySelector('video');
  const bar = shadow?.querySelector('.theater-controls-wrapper') ?? null;
  const toggle = shadow?.querySelector('.theater-chat-toggle') ?? null;
  const separator = shadow?.querySelector('.theater-chat-separator') ?? null;
  const frame = document.querySelector('#chatframe');
  const iframe = frame instanceof HTMLIFrameElement ? frame : null;
  const framedDraft = iframe?.contentDocument?.querySelector('#draft') ?? null;
  const draft = framedDraft || document.querySelector('#draft');
  const draftText = draft?.tagName === 'TEXTAREA' || draft?.tagName === 'INPUT'
    ? (draft as HTMLTextAreaElement | HTMLInputElement).value
    : draft?.textContent ?? null;
  const rootStyle = getComputedStyle(document.documentElement);
  const chatBox = chat?.getBoundingClientRect();
  let hitChat = false;
  if (chat && chatBox && chatBox.width > 2 && chatBox.height > 2) {
    const x = Math.min(window.innerWidth - 1, Math.max(0, chatBox.left + chatBox.width / 2));
    const y = Math.min(window.innerHeight - 1, Math.max(0, chatBox.top + chatBox.height / 2));
    const hit = document.elementFromPoint(x, y);
    hitChat = Boolean(hit && (hit === chat || chat.contains(hit)));
  }
  const secondary = document.getElementById('secondary');
  const state = window.NativeChatTest.nativeChatState();
  const probe = window as Window & {
    __chatLoads?: number;
    __pauseCalls?: number;
    __detachedConnected?: () => boolean;
    __replacedLoads?: number;
  };
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    video: rect(video),
    chat: rect(chat),
    host: rect(host),
    bar: rect(bar),
    contain: host ? getComputedStyle(host).contain : '',
    vars: {
      videoWidth: rootStyle.getPropertyValue('--theater-video-width').trim(),
      videoHeight: rootStyle.getPropertyValue('--theater-video-height').trim(),
      chatLeft: rootStyle.getPropertyValue('--theater-chat-left').trim(),
      chatTop: rootStyle.getPropertyValue('--theater-chat-top').trim(),
      chatWidth: rootStyle.getPropertyValue('--theater-chat-width').trim(),
      chatHeight: rootStyle.getPropertyValue('--theater-chat-height').trim()
    },
    chatHidden: Boolean(chat?.hasAttribute('data-theater-chat-hidden')),
    active: document.documentElement.hasAttribute('data-theater-chat-active'),
    visibleAttr: document.documentElement.hasAttribute('data-theater-chat-visible'),
    hitChat,
    state: state ? {
      available: state.available,
      visible: state.visible,
      dock: state.dock,
      width: state.width,
      theme: state.theme === 'light' || state.theme === 'native' || state.theme === 'dark' ? state.theme : null
    } : null,
    toggleHidden: toggle instanceof HTMLElement ? Boolean(toggle.hidden) : null,
    toggleExpanded: toggle?.getAttribute('aria-expanded') ?? null,
    toggleLabel: toggle?.getAttribute('aria-label') ?? null,
    separator: separator instanceof HTMLElement && !separator.hidden ? rect(separator) : null,
    separatorHidden: separator instanceof HTMLElement ? separator.hidden === true : null,
    separatorValue: separator?.getAttribute('aria-valuenow') ?? null,
    theater: document.documentElement.classList.contains('theater-everywhere-html-active'),
    paused: video instanceof HTMLVideoElement ? video.paused : true,
    muted: video instanceof HTMLVideoElement ? video.muted : false,
    pauseCalls: probe.__pauseCalls ?? 0,
    loads: probe.__chatLoads ?? 0,
    src: iframe?.getAttribute('src') ?? null,
    identity: iframe?.dataset.fixtureIdentity ?? null,
    connected: Boolean(chat?.isConnected),
    parentId: chat?.parentElement?.id || null,
    parentTag: chat?.parentElement?.tagName ?? null,
    draft: draftText,
    siteRevision: chat?.getAttribute('data-site-revision') ?? null,
    siteClass: Boolean(chat?.classList.contains('site-chat-theme')),
    caretColor: chat instanceof HTMLElement ? chat.style.caretColor : '',
    presetColor: chat instanceof HTMLElement ? chat.style.color : '',
    videoPosition: video instanceof HTMLElement ? video.style.getPropertyValue('position') : '',
    videoMarked: Boolean(video?.classList.contains('theater-everywhere-video-active') || video?.hasAttribute('data-theater-everywhere')),
    chatPosition: chat instanceof HTMLElement ? getComputedStyle(chat).position : '',
    secondaryHidden: secondary ? getComputedStyle(secondary).visibility === 'hidden' : null,
    secondaryAncestor: Boolean(secondary?.hasAttribute('data-theater-chat-ancestor')),
    chatCount: document.querySelectorAll('[data-theater-chat]').length,
    generation: document.getElementById('chat')?.dataset.fixtureGeneration ?? null,
    detachedConnected: typeof probe.__detachedConnected === 'function' ? probe.__detachedConnected() : null,
    replacedLoads: probe.__replacedLoads ?? 0
  };
}

function pixels(value: string): number {
  const parsed = Number.parseFloat(value);
  assert.ok(Number.isFinite(parsed), `expected a shared length, received ${JSON.stringify(value)}`);
  return parsed;
}

function near(actual: number, expected: number, tolerance = 4): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function overlaps(first: Rect, second: Rect): boolean {
  const width = Math.min(first.right, second.right) - Math.max(first.left, second.left);
  const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
  return width > 2 && height > 2;
}

function inside(inner: Rect, outer: Rect): boolean {
  return inner.left >= outer.left - 2 && inner.top >= outer.top - 2
    && inner.right <= outer.right + 2 && inner.bottom <= outer.bottom + 2;
}

function assertSharedGeometry(layout: Layout, label: string): void {
  const detail = `${label} ${JSON.stringify(layout)}`;
  assert.ok(layout.video && layout.chat && layout.host && layout.bar, detail);
  const video = layout.video;
  const chat = layout.chat;
  const host = layout.host;
  const bar = layout.bar;
  assert.ok(/\blayout\b|^strict$/.test(layout.contain), detail);
  assert.ok(near(host.width, video.width) && near(host.height, video.height + bar.height), detail);
  assert.ok(near(host.left, video.left) && near(host.top, video.top), detail);
  assert.ok(inside(bar, host), detail);
  assert.ok(near(bar.top, video.bottom, 1), detail);
  assert.ok(near(bar.left, host.left, 1) && near(bar.right, host.right, 1)
    && near(bar.bottom, host.bottom, 1), detail);
  assert.ok(near(pixels(layout.vars.videoWidth), video.width), detail);
  assert.ok(near(pixels(layout.vars.videoHeight), host.height), detail);
  assert.ok(near(pixels(layout.vars.chatLeft), chat.left), detail);
  assert.ok(near(pixels(layout.vars.chatTop), chat.top), detail);
  assert.ok(near(pixels(layout.vars.chatWidth), chat.width), detail);
  assert.ok(near(pixels(layout.vars.chatHeight), chat.height), detail);
}

function assertRightDock(layout: Layout, label: string): void {
  const detail = `${label} ${JSON.stringify(layout)}`;
  assert.equal(layout.state?.dock, 'right', detail);
  if (layout.state?.visible) {
    // The separator straddles the edge between the picture and the chat and reports the chat width.
    assert.equal(layout.separatorHidden, false, detail);
    assert.ok(layout.separator && layout.chat && layout.separator.left < layout.chat.left
      && layout.separator.right > layout.chat.left, detail);
    assert.equal(layout.separatorValue, String(layout.state.width), detail);
  }
  assert.ok(layout.viewport.width >= 900, detail);
  assert.ok(layout.video && layout.chat, detail);
  assert.ok(!overlaps(layout.video, layout.chat), detail);
  assert.ok(near(layout.chat.left, layout.video.right, 2), detail);
  assert.ok(layout.video.left <= 2 && layout.video.top <= 2, detail);
  assert.ok(layout.chat.right >= layout.viewport.width - 8, detail);
  assert.ok(layout.chat.height >= layout.viewport.height - 8, detail);
  assert.equal(layout.hitChat, true, detail);
  assert.equal(layout.chatPosition, 'fixed', detail);
  assertSharedGeometry(layout, label);
}

function assertBottomDock(layout: Layout, label: string): void {
  const detail = `${label} ${JSON.stringify(layout)}`;
  assert.equal(layout.state?.dock, 'bottom', detail);
  assert.equal(layout.separatorHidden, true, detail);
  assert.ok(layout.viewport.width < 900, detail);
  assert.ok(layout.video && layout.chat, detail);
  assert.ok(!overlaps(layout.video, layout.chat), detail);
  assert.ok(near(layout.chat.top, layout.host!.bottom, 2), detail);
  assert.ok(layout.video.width >= layout.viewport.width - 8, detail);
  assert.ok(layout.chat.width >= layout.viewport.width - 8, detail);
  assert.ok(layout.video.height >= 80 && layout.chat.height >= 80, detail);
  assert.equal(layout.hitChat, true, detail);
  assert.ok(inside(layout.bar!, layout.host!), detail);
  assert.ok(near(layout.bar!.top, layout.video.bottom, 1), detail);
}

function assertFullVideo(layout: Layout, label: string): void {
  const detail = `${label} ${JSON.stringify(layout)}`;
  assert.ok(layout.video && layout.host && layout.bar, detail);
  assert.ok(layout.video.width >= layout.viewport.width - 8, detail);
  assert.ok(layout.host.height >= layout.viewport.height - 8, detail);
  assert.ok(near(layout.video.height + layout.bar.height, layout.host.height, 1), detail);
  assert.ok(inside(layout.bar, layout.host), detail);
}

async function fulfillMedia(route: Route): Promise<void> {
  const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), VOD.length - 1) : VOD.length - 1;
  await route.fulfill({
    status: range ? 206 : 200,
    contentType: 'video/webm',
    headers: {
      'accept-ranges': 'bytes',
      'content-length': String(end - start + 1),
      ...(range ? { 'content-range': `bytes ${start}-${end}/${VOD.length}` } : {})
    },
    body: VOD.subarray(start, end + 1)
  });
}

async function installRoutes(page: Page, documents: { youtube?: string; twitch?: string }): Promise<void> {
  await page.route('https://www.youtube.com/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/fixtures/vod.webm') return fulfillMedia(route);
    if (url.pathname === '/live_chat' || url.pathname === '/live_chat_replay') {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: CHAT_FRAME });
    }
    if (url.pathname === '/watch' && documents.youtube) {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: documents.youtube });
    }
    return route.fulfill({ status: 404, contentType: 'text/plain', body: 'unmapped youtube fixture' });
  });
  await page.route('https://www.twitch.tv/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/fixtures/vod.webm') return fulfillMedia(route);
    if (documents.twitch) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: documents.twitch });
    return route.fulfill({ status: 404, contentType: 'text/plain', body: 'unmapped twitch fixture' });
  });
}

async function installStorage(page: Page, seed: Record<string, unknown> = {}, navigationStorageKey?: string): Promise<{ read(): Record<string, unknown> }> {
  let storage: Record<string, unknown> = { keepControlsVisible: true, ...seed };
  await page.exposeFunction('__tmeStorageGet', () => storage);
  await page.exposeFunction('__tmeStorageSet', (patch: Record<string, unknown>) => {
    storage = { ...storage, ...patch };
  });
  const initializeStorage = (navigationStorageKey?: string) => {
    const chromeMock = {
      storage: {
        sync: {
          get: async () => (window as unknown as { __tmeStorageGet(): Promise<Record<string, unknown>> }).__tmeStorageGet(),
          set: async (data: Record<string, unknown>) => {
            const snapshot = structuredClone(data);
            await (window as unknown as { __tmeStorageSet(patch: Record<string, unknown>): Promise<void> }).__tmeStorageSet(snapshot);
          },
          onChanged: { addListener() {} }
        },
        onChanged: { addListener() {} }
      }
    };
    Object.defineProperty(window, 'chrome', { configurable: true, writable: true, value: chromeMock });
    if (navigationStorageKey) {
      // Model dispatch to extension storage during pagehide without relying on
      // Playwright bindings, which can be discarded with the unloading document.
      const storage = chromeMock.storage.sync;
      const get = storage.get;
      storage.get = async () => ({ ...await get(), ...JSON.parse(localStorage.getItem(navigationStorageKey) || '{}') });
    }
  };
  // tsx gives serialized nested functions a naming helper. Install the helper,
  // mock, and optional reload wrapper in order within one script in every frame.
  await page.addInitScript(`window.__name = target => target; (${initializeStorage.toString()})(${JSON.stringify(navigationStorageKey) ?? 'undefined'});`);
  return { read: () => storage };
}

async function boot(page: Page): Promise<void> {
  await page.addStyleTag({ content: PAGE_CSS });
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(`NativeChatTest.installMainWorldRuntime(); NativeChatTest.setPlayerUiCss(${JSON.stringify(UI_CSS)}); NativeChatTest.bootstrapPlayerRuntime();`);
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return video instanceof HTMLVideoElement && video.readyState >= 1 && video.videoWidth > 0;
  });
  await page.keyboard.press('t');
  await page.locator('.theater-controls-wrapper.visible').waitFor();
}

async function layoutOf(page: Page): Promise<Layout> {
  return page.evaluate(readLayout);
}

async function waitForSaved(
  read: () => Record<string, unknown>,
  provider: 'youtube' | 'twitch',
  accept: (preference: { visible: boolean; width: number; theme?: unknown }) => boolean
): Promise<void> {
  const deadline = Date.now() + 4000;
  let last: unknown;
  while (Date.now() < deadline) {
    const saved = read().nativeChatPreferences as Partial<Record<string, { visible: boolean; width: number; theme?: unknown }>> | undefined;
    last = saved;
    const preference = saved?.[provider];
    if (preference && accept(preference)) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`saved ${provider} chat preference was not updated: ${JSON.stringify(last)}`);
}

/** Center of the visible separator, which straddles the chat's left edge. */
async function separatorCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('.theater-chat-separator').boundingBox();
  assert.ok(box, 'the chat separator is not shown');
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
}

/** Drags the separator with the mouse; the chat follows the pointer's horizontal travel. */
async function setChatWidth(page: Page, width: number): Promise<void> {
  const before = await page.evaluate(() => window.NativeChatTest.nativeChatState()?.width ?? 0);
  const start = await separatorCenter(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + before - width, start.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(next => window.NativeChatTest.nativeChatState()?.width === next, width);
}

async function armPlaybackProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const video = document.querySelector('video');
    if (!(video instanceof HTMLVideoElement)) throw new Error('missing video');
    const pause = video.pause.bind(video);
    const probe = window as Window & { __pauseCalls?: number; __chatKeyLog?: Array<{ key: string; defaultPrevented: boolean }> };
    probe.__pauseCalls = 0;
    probe.__chatKeyLog = [];
    video.pause = () => {
      probe.__pauseCalls = (probe.__pauseCalls ?? 0) + 1;
      pause();
    };
    window.addEventListener('keydown', event => {
      const inChat = event.composedPath().some(node => node instanceof Element && Boolean(node.closest('[data-theater-chat]')));
      if (!inChat) return;
      probe.__chatKeyLog?.push({ key: event.key, defaultPrevented: event.defaultPrevented });
    }, true);
  });
}

async function installFrameRuntime(page: Page): Promise<Frame> {
  await page.waitForFunction(() => ((window as unknown as { __chatLoads?: number }).__chatLoads ?? 0) > 0);
  const frame = page.frames().find(candidate => candidate.url().includes('/live_chat'));
  assert.ok(frame, 'live chat frame did not load from the fixture route');
  await frame.addScriptTag({ content: BUNDLE });
  await frame.evaluate(`NativeChatTest.installMainWorldRuntime(); NativeChatTest.setPlayerUiCss(${JSON.stringify(UI_CSS)}); NativeChatTest.bootstrapPlayerRuntime();`);
  await frame.evaluate(() => {
    const probe = window as Window & { __chatKeyLog?: Array<{ key: string; defaultPrevented: boolean }> };
    probe.__chatKeyLog = [];
    window.addEventListener('keydown', event => {
      probe.__chatKeyLog?.push({ key: event.key, defaultPrevented: event.defaultPrevented });
    }, true);
  });
  return frame;
}

function assertKeyReached(
  log: Array<{ key: string; defaultPrevented: boolean }>,
  key: string,
  label: string
): void {
  const match = log.filter(entry => entry.key === key);
  assert.ok(match.length > 0, `${label} did not observe ${JSON.stringify(key)} after the player listeners: ${JSON.stringify(log)}`);
  assert.ok(match.every(entry => entry.defaultPrevented === false), `${label} prevented ${JSON.stringify(key)}: ${JSON.stringify(log)}`);
}

async function leaveTheater(page: Page): Promise<void> {
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    for (const frame of document.querySelectorAll('iframe')) {
      if (!(frame instanceof HTMLIFrameElement)) continue;
      const inner = frame.contentDocument?.activeElement;
      if (inner instanceof HTMLElement) inner.blur();
    }
  });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
}

/** `browser.newPage`-shaped pages from a shared browser: one context per page, closed with test `t`. */
function pagesOf(shared: ReturnType<typeof sharedTestBrowser>, t: TestContext): { newPage(options: BrowserContextOptions): Promise<Page> } {
  return { newPage: async options => (await shared.newContext(t, options)).newPage() };
}

async function openPage(browser: { newPage(options: { viewport: { width: number; height: number } }): Promise<Page> }, target: { url: string; youtube?: string; twitch?: string }, viewport: { width: number; height: number }, seed: Record<string, unknown> = {}, navigationStorageKey?: string): Promise<{ page: Page; read(): Record<string, unknown> }> {
  const page = await browser.newPage({ viewport });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  (page as Page & { __errors?: string[] }).__errors = errors;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const storage = await installStorage(page, seed, navigationStorageKey);
  await installRoutes(page, { youtube: target.youtube, twitch: target.twitch });
  await page.goto(target.url, { waitUntil: 'load' });
  return { page, read: storage.read };
}

function pageErrors(page: Page): string[] {
  return (page as Page & { __errors?: string[] }).__errors ?? [];
}

type ThemeControl = {
  hidden: boolean;
  disabled: boolean;
  value: string;
  label: string | null;
  text: string | null;
  options: Array<{ value: string; text: string }>;
  inSettings: boolean;
};

async function readThemeControl(page: Page): Promise<ThemeControl> {
  return page.evaluate(() => {
    const root = document.getElementById('theater-everywhere-ui')?.shadowRoot;
    const row = root?.querySelector('.theater-chat-theme-row');
    const select = root?.querySelector('.theater-chat-theme-select');
    if (!(row instanceof HTMLElement) || !(select instanceof HTMLSelectElement)) {
      throw new Error('missing chat theme control');
    }
    const menu = select.closest('.theater-settings-menu');
    return {
      hidden: Boolean(row.hidden),
      disabled: select.disabled,
      value: select.value,
      label: select.getAttribute('aria-label'),
      text: row.querySelector('.theater-settings-label')?.textContent ?? null,
      options: [...select.options].map(option => ({ value: option.value, text: option.text })),
      inSettings: Boolean(menu && select.closest('.theater-settings-body') && menu.parentElement?.querySelector('.player-settings-btn'))
    };
  });
}

async function chatSettingsOpen(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.getElementById('theater-everywhere-ui')?.shadowRoot;
    return Boolean(root?.querySelector('.theater-menu.is-open > .theater-settings-menu, .theater-settings-menu.visible'));
  });
}

async function revealChatSettings(page: Page): Promise<void> {
  if (!await chatSettingsOpen(page)) await page.locator('.player-settings-btn').click();
  await page.locator('.theater-chat-theme-select').waitFor({ state: 'visible' });
}

async function closeChatSettings(page: Page): Promise<void> {
  if (await chatSettingsOpen(page)) await page.locator('.player-settings-btn').click();
}

async function chooseChatTheme(page: Page, theme: 'light' | 'native' | 'dark'): Promise<void> {
  await revealChatSettings(page);
  await page.locator('.theater-chat-theme-select').selectOption(theme);
}

async function expectSavedTheme(
  read: () => Record<string, unknown>,
  provider: 'youtube' | 'twitch',
  expected: { visible: boolean; width: number; theme: string }
): Promise<void> {
  await waitForSaved(read, provider, preference =>
    preference.visible === expected.visible && preference.width === expected.width && preference.theme === expected.theme
  );
}

async function expectAppliedTheme(page: Page, theme: 'light' | 'native' | 'dark'): Promise<void> {
  await page.waitForFunction(expected => {
    const select = document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-chat-theme-select');
    return select instanceof HTMLSelectElement && select.value === expected;
  }, theme);
  try {
    await page.waitForFunction(
      expected => window.NativeChatTest.nativeChatState()?.theme === expected,
      theme,
      { timeout: 2000 }
    );
  } catch {
    const actual = await page.evaluate(() => window.NativeChatTest.nativeChatState());
    assert.equal(actual?.theme, theme, `chat state theme was not applied: ${JSON.stringify(actual)}`);
  }
}

describe('native chat browser session', () => {
  for (const engine of testEngines()) {
    it(`fixes Twitch Option+R and native toggle, and resizes the chat by dragging in ${engine}`, { timeout: 120_000 }, async t => {
      const browser = pagesOf(browsers[engine], t);
      const { page } = await openPage(browser, { url: TWITCH_CHANNEL, twitch: twitchDocument() }, { width: 1280, height: 800 });
      const nativeToggle = page.locator('[data-a-target="right-column__toggle-collapse-btn"]');
      assert.equal(await nativeToggle.isVisible(), true);
      await boot(page);
      await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.visible);
      assert.equal(await nativeToggle.isVisible(), false);
      const optionR = () => page.evaluate(() => {
        // macOS Option+R produces ®; Linux Playwright Alt+R alone cannot cover this.
        document.querySelector('video')!.dispatchEvent(new KeyboardEvent('keydown', {
          key: '®', code: 'KeyR', altKey: true, bubbles: true, cancelable: true
        }));
      });
      await optionR();
      await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.visible === false);
      await optionR();
      await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.visible === true);

      await revealChatSettings(page);
      const menu = page.locator('.theater-settings-menu');
      const before = await menu.boundingBox();
      assert.ok(before);
      await closeChatSettings(page);
      // Every drag step moves the chat with the pointer, clamped to the shared range.
      const start = await separatorCenter(page);
      const initial = (await layoutOf(page)).state!.width;
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      for (const travel of [-120, 60, -400]) {
        await page.mouse.move(start.x + travel, start.y, { steps: 8 });
        const expected = Math.min(600, Math.max(280, initial - travel));
        await page.waitForFunction(width => window.NativeChatTest.nativeChatState()?.width === width, expected);
        // The drag overlay covers the chat until release, so only the geometry is checked here.
        const moving = await layoutOf(page);
        const detail = `${engine} dragging ${travel} ${JSON.stringify(moving)}`;
        assert.ok(moving.chat && moving.video && near(moving.chat.width, expected) && near(moving.chat.left, moving.video.right, 2), detail);
        assert.ok(moving.separator && moving.separator.left < moving.chat.left && moving.separator.right > moving.chat.left, detail);
      }
      await page.mouse.up();
      const layout = await layoutOf(page);
      assert.equal(layout.state?.width, 600);
      assertRightDock(layout, `${engine} resized`);
      await revealChatSettings(page);
      const reopened = await menu.boundingBox();
      assert.ok(reopened && Math.abs(reopened.x - before.x) > 100, 'reopening did not reanchor to the resized bar');
      await closeChatSettings(page);
      await leaveTheater(page);
      assert.equal(await nativeToggle.isVisible(), true);
      assert.deepEqual(pageErrors(page), []);
    });

    it(`resizes YouTube chat across its frame, from the keyboard and by reset, and cleans up in ${engine}`, { timeout: 120_000 }, async t => {
      const browser = pagesOf(browsers[engine], t);
      // A width saved by the old Width setting is where the separator starts.
      const seed = { nativeChatPreferences: { youtube: { visible: true, width: 420, theme: 'native' } } };
      const { page, read } = await openPage(browser, { url: YOUTUBE_WATCH, youtube: youtubeDocument('visible') }, { width: 1280, height: 800 }, seed);
      await boot(page);
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-chat-visible'));
      let layout = await layoutOf(page);
      assert.equal(layout.state?.width, 420, JSON.stringify(layout.state));
      assertRightDock(layout, `${engine} migrated width`);
      const separator = page.locator('.theater-chat-separator');
      assert.deepEqual(await separator.evaluate(element => ({
        role: element.getAttribute('role'),
        orientation: element.getAttribute('aria-orientation'),
        label: element.getAttribute('aria-label'),
        min: element.getAttribute('aria-valuemin'),
        max: element.getAttribute('aria-valuemax'),
        tabIndex: (element as HTMLElement).tabIndex
      })), { role: 'separator', orientation: 'vertical', label: 'Resize chat', min: '280', max: '600', tabIndex: 0 });
      await revealChatSettings(page);
      assert.equal(await page.locator('.theater-chat-width-row').count(), 0, 'the Width row is gone from the menu');
      await closeChatSettings(page);

      // Over the chat frame the moves stay with the separator: the frame's document receives none.
      await page.waitForFunction(() => ((window as unknown as { __chatLoads?: number }).__chatLoads ?? 0) > 0);
      const chatFrame = page.frames().find(candidate => candidate.url().includes('/live_chat'));
      assert.ok(chatFrame, 'live chat frame did not load');
      await chatFrame.evaluate(() => {
        const probe = window as Window & { __moves?: number };
        probe.__moves = 0;
        window.addEventListener('pointermove', () => { probe.__moves = (probe.__moves ?? 0) + 1; }, true);
      });
      await page.evaluate(() => {
        const probe = window as Window & { __seeks?: number };
        probe.__seeks = 0;
        // The fixture loops, and a loop also fires `seeking`; count the player's own seeks instead.
        const video = document.querySelector('video')!;
        const time = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')!;
        Object.defineProperty(video, 'currentTime', {
          configurable: true,
          get() { return time.get!.call(this); },
          set(value: number) { probe.__seeks = (probe.__seeks ?? 0) + 1; time.set!.call(this, value); }
        });
      });
      const start = await separatorCenter(page);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + 260, start.y, { steps: 10 });
      await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.width === 280);
      // Past the narrowest width the pointer is well inside the frame while the drag goes on.
      layout = await layoutOf(page);
      assert.ok(layout.chat && start.x + 260 > layout.chat.left + 80, `the pointer is over the chat frame ${JSON.stringify(layout.chat)}`);
      await page.mouse.move(start.x + 300, start.y + 120, { steps: 4 });
      await page.mouse.move(start.x + 100, start.y + 120, { steps: 6 });
      await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.width === 320);
      await page.mouse.up();
      assert.equal(await chatFrame.evaluate(() => (window as Window & { __moves?: number }).__moves), 0, 'the chat frame took pointer moves');
      const afterDrag = await separator.evaluate(element => ({
        dragging: element.hasAttribute('data-dragging'),
        overlays: element.querySelectorAll('.theater-chat-separator-overlay').length,
        focused: (element.getRootNode() as ShadowRoot).activeElement === element
      }));
      assert.deepEqual(afterDrag, { dragging: false, overlays: 0, focused: false }, 'a pointer drag leaves no overlay and keeps focus where it was');
      layout = await layoutOf(page);
      assertRightDock(layout, `${engine} dragged over the frame`);
      await waitForSaved(read, 'youtube', preference => preference.width === 320);

      // The keys step the chat width instead of seeking, with a visible focus ring. Tab reaches the
      // separator as a keyboard user would: Firefox shows no ring for programmatic focus after a drag.
      await separator.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await separator.evaluate(element => (element.getRootNode() as ShadowRoot).activeElement === element), true, 'Tab reaches the separator');
      const steps: Array<[string, number]> = [['ArrowLeft', 330], ['Shift+ArrowLeft', 380], ['ArrowRight', 370], ['Home', 280], ['End', 600]];
      for (const [key, width] of steps) {
        await page.keyboard.press(key);
        await page.waitForFunction(next => window.NativeChatTest.nativeChatState()?.width === next, width);
        assert.equal(await separator.getAttribute('aria-valuenow'), String(width), key);
      }
      assert.equal(await page.evaluate(() => (window as Window & { __seeks?: number }).__seeks), 0, 'separator keys seeked the video');
      const ring = await separator.evaluate(element => ({
        visible: element.matches(':focus-visible'),
        outline: getComputedStyle(element.querySelector('.theater-chat-separator-grip')!).outlineStyle
      }));
      assert.deepEqual(ring, { visible: true, outline: 'solid' });
      assertRightDock(await layoutOf(page), `${engine} keyboard`);

      // Double-click restores the default width.
      const center = await separatorCenter(page);
      await page.mouse.dblclick(center.x, center.y);
      await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.width === 360);
      await waitForSaved(read, 'youtube', preference => preference.width === 360);

      // Chat stays on the physical right in a right-to-left UI, and the arrows still point the way it moves.
      await page.evaluate(() => document.getElementById('theater-everywhere-ui')!.setAttribute('dir', 'rtl'));
      await separator.focus();
      await page.keyboard.press('ArrowLeft');
      await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.width === 370);
      assertRightDock(await layoutOf(page), `${engine} rtl`);
      await page.evaluate(() => document.getElementById('theater-everywhere-ui')!.setAttribute('dir', 'ltr'));

      // Hiding the chat hides the separator; showing it brings it back at the same width.
      await page.keyboard.press('Alt+R');
      await page.waitForFunction(() => document.querySelector('[data-theater-chat-hidden]'));
      layout = await layoutOf(page);
      assert.equal(layout.separatorHidden, true, JSON.stringify(layout));
      await page.keyboard.press('Alt+R');
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-chat-visible'));
      assertRightDock(await layoutOf(page), `${engine} shown again`);

      // Leaving theater mid-drag leaves nothing behind; re-entry mounts one separator at the kept width.
      const held = await separatorCenter(page);
      await page.mouse.move(held.x, held.y);
      await page.mouse.down();
      await page.mouse.move(held.x - 40, held.y, { steps: 4 });
      await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.width === 410);
      await leaveTheater(page);
      await page.mouse.up();
      assert.equal(await page.evaluate(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelectorAll('.theater-chat-separator').length ?? 0), 0);
      await page.keyboard.press('t');
      await page.locator('.theater-controls-wrapper.visible').waitFor();
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-chat-visible'));
      layout = await layoutOf(page);
      assert.equal(await page.evaluate(() => document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelectorAll('.theater-chat-separator, .theater-chat-separator-overlay').length), 1);
      assert.equal(layout.state?.width, 410, JSON.stringify(layout.state));
      assertRightDock(layout, `${engine} re-entered`);
      assert.deepEqual(pageErrors(page), []);
    });

    it(`fades the separator with the idle player UI, keeps it while held or focused, and leaves the page untouched in ${engine}`, { timeout: 120_000 }, async t => {
      const browser = pagesOf(browsers[engine], t);
      const { page } = await openPage(browser, { url: TWITCH_CHANNEL, twitch: twitchDocument() }, { width: 1280, height: 800 });
      await boot(page);
      await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.visible);
      const separator = page.locator('.theater-chat-separator');
      const look = () => separator.evaluate(element => ({
        hidden: element.hasAttribute('data-chrome-hidden'),
        opacity: getComputedStyle(element).opacity,
        ring: getComputedStyle(element.querySelector('.theater-chat-separator-grip')!).boxShadow,
        hit: element.contains(element.getRootNode() instanceof ShadowRoot
          ? (element.getRootNode() as ShadowRoot).elementFromPoint(element.getBoundingClientRect().left + 4, innerHeight / 2) : null)
      }));
      // The fade is our own attribute in the player UI; the host page's root and body never change for it.
      await page.evaluate(() => {
        const probe = window as Window & { __rootMutations?: string[] };
        probe.__rootMutations = [];
        new MutationObserver(records => {
          for (const record of records) probe.__rootMutations!.push(`${(record.target as Element).tagName}.${record.attributeName}`);
        }).observe(document.documentElement, { attributes: true });
        new MutationObserver(records => {
          for (const record of records) probe.__rootMutations!.push(`${(record.target as Element).tagName}.${record.attributeName}`);
        }).observe(document.body, { attributes: true });
      });

      // Shown with the player UI, as a plain accent grip: no outline at rest.
      await page.mouse.move(300, 300);
      let state = await look();
      assert.equal(state.hidden, false);
      assert.equal(state.opacity, '1');
      assert.equal(state.ring, 'none', 'no outline at rest');

      // Idle: the separator fades with the bar but still answers the pointer.
      await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')!.shadowRoot!
        .querySelector('.theater-chat-separator')!.hasAttribute('data-chrome-hidden'), null, { timeout: 8000 });
      await page.waitForFunction(() => getComputedStyle(document.getElementById('theater-everywhere-ui')!.shadowRoot!
        .querySelector('.theater-chat-separator')!).opacity === '0');
      state = await look();
      assert.equal(state.hit, true, 'the faded separator is still where the pointer can find it');

      // Pointing at the handle brings it back, outlined.
      const box = (await separator.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
      await page.waitForFunction(() => getComputedStyle(document.getElementById('theater-everywhere-ui')!.shadowRoot!
        .querySelector('.theater-chat-separator')!).opacity === '1');
      assert.notEqual((await look()).ring, 'none', 'outlined while pointed at');
      // Fading out and back in wrote nothing on the host page's root or body (a drag writes the chat geometry there).
      assert.deepEqual(await page.evaluate(() => (window as Window & { __rootMutations?: string[] }).__rootMutations), []);

      // Held through an idle period, it stays visible.
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2, { steps: 3 });
      await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')!.shadowRoot!
        .querySelector('.theater-chat-separator')!.hasAttribute('data-chrome-hidden'), null, { timeout: 8000 });
      state = await look();
      assert.equal(state.opacity, '1', 'visible while dragged');
      await page.mouse.up();

      // Keyboard focus keeps it through an idle period too.
      await page.mouse.move(300, 300);
      await separator.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')!.shadowRoot!
        .querySelector('.theater-chat-separator')!.hasAttribute('data-chrome-hidden'), null, { timeout: 8000 });
      state = await look();
      assert.equal(state.opacity, '1', 'visible while keyboard-focused');
      assert.notEqual(state.ring, 'none', 'outlined while focused');

      assert.deepEqual(pageErrors(page), []);
    });

    it(`reaches and adjusts the Theme row with W/A/S/D in ${engine}`, { timeout: 120_000 }, async t => {
      const browser = pagesOf(browsers[engine], t);
      const { page, read } = await openPage(browser, { url: TWITCH_CHANNEL, twitch: twitchDocument() }, { width: 1280, height: 800 });
      await boot(page);
      await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.visible);
      const press = (key: string, code: string) => page.evaluate(init => {
        const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
        const target = root.activeElement ?? document.body;
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, ...init });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      }, { key, code });
      const W = () => press('w', 'KeyW'), A = () => press('a', 'KeyA'), S = () => press('s', 'KeyS'), D = () => press('d', 'KeyD');
      const focusedControl = () => page.evaluate(() => {
        const active = document.getElementById('theater-everywhere-ui')!.shadowRoot!.activeElement;
        return active ? (active.className || active.tagName) : null;
      });
      const climbTo = async (className: string) => {
        for (let step = 0; step < 30 && !(await focusedControl())?.includes(className); step++) await W();
        assert.ok((await focusedControl())?.includes(className), `W reaches ${className}; stopped on ${await focusedControl()}`);
      };

      // W starts the mode on the gear, then opens its menu on the bottom row and climbs.
      await W();
      await W();
      await climbTo('theater-chat-theme-select');
      assert.equal((await readThemeControl(page)).value, 'native');
      assert.equal(await D(), true, 'D on the theme select is consumed');
      await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.theme === 'dark');
      assert.equal((await readThemeControl(page)).value, 'dark');
      await D();
      assert.equal((await readThemeControl(page)).value, 'dark', 'D at the last option changes nothing');
      await A();
      await A();
      await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.theme === 'light');
      assert.equal(await focusedControl(), 'theater-chat-theme-select', 'focus stays on the select while it steps');
      await waitForSaved(read, 'twitch', preference => preference.theme === 'light');

      // Theme is the chat section's only row now that the separator owns the width: S leaves it, W returns.
      await S();
      assert.notEqual(await focusedControl(), 'theater-chat-theme-select');
      await climbTo('theater-chat-theme-select');
      assert.equal(await page.locator('.theater-chat-width-row').count(), 0, 'the Width row is gone from the menu');
      assert.deepEqual(pageErrors(page), []);
    });

    it(`provides the missing light palette on a dark Twitch startup in ${engine}`, { timeout: 120_000 }, async t => {
      const browser = pagesOf(browsers[engine], t);
      // Only the dark declaration is emitted on a native dark startup.
      const darkCSS = TWITCH_THEME_CSS.slice(TWITCH_THEME_CSS.indexOf('.NativeDark.NativeDark'));
      const html = twitchDocument().replace('<html>', '<html class="NativeDark tw-root--theme-dark">')
        .replace('</head>', `<style id="service-palette">${darkCSS}</style></head>`)
        .replace('class="right-column"', 'class="right-column NativeDark tw-root--theme-dark"');
      const { page, read } = await openPage(browser, { url: TWITCH_CHANNEL, twitch: html }, { width: 1280, height: 800 });
      await boot(page);
      await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.available);
      await chooseChatTheme(page, 'light');
      await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.themeStatus === 'applied');
      // Compare all 1002 native tokens with a separate full service palette,
      // including shared primitives and tokens outside the compiled bridge.
      const verify = async (selector = '[data-theater-chat]') => page.evaluate(({ css, selector }) => {
        const reference = document.createElement('div');
        const shadow = reference.attachShadow({ mode: 'open' });
        shadow.innerHTML = `<style>${css}</style><div class="NativeLight"></div>`;
        document.body.append(reference);
        const expected = getComputedStyle(shadow.querySelector('div')!);
        const actual = getComputedStyle(document.querySelector(selector)!);
        const names = [...(shadow.querySelector('style')!.sheet!.cssRules[0] as CSSStyleRule).style];
        const mismatches = names.filter(name => name.startsWith('--') &&
          actual.getPropertyValue(name).trim() !== expected.getPropertyValue(name).trim());
        reference.remove();
        return { checked: names.length, mismatches };
      }, { css: TWITCH_THEME_CSS.slice(TWITCH_THEME_CSS.indexOf('.NativeLight.NativeLight'), TWITCH_THEME_CSS.indexOf('.NativeDark.NativeDark')), selector });
      const comparison = await verify();
      assert.ok(comparison.checked >= 1002);
      assert.deepEqual(comparison.mismatches, []);
      await page.evaluate(() => {
        const portal = document.createElement('div');
        portal.className = 'ReactModalPortal';
        portal.innerHTML = '<div id="late-popup" class="NativeDark tw-root--theme-dark">Native popup</div>';
        document.body.append(portal);
      });
      await page.waitForFunction(() => document.querySelector('#late-popup')?.classList.contains('theater-chat-theme-light'));
      assert.deepEqual((await verify('#late-popup')).mismatches, []);
      const detachedPortal = await page.evaluate(async () => {
        const popup = document.getElementById('late-popup');
        const portal = popup?.parentElement;
        if (!popup || !portal) return 'missing';
        portal.remove();
        await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
        return popup.className;
      });
      assert.notEqual(detachedPortal, 'missing');
      assert.equal(String(detachedPortal).includes('theater-chat-theme-'), false, engine);
      await page.evaluate(() => {
        const portal = document.createElement('div');
        portal.className = 'ReactModalPortal';
        portal.innerHTML = '<div id="next-popup" class="NativeDark tw-root--theme-dark">Next</div>';
        document.body.append(portal);
      });
      await page.waitForFunction(() => document.querySelector('#next-popup')?.classList.contains('theater-chat-theme-light'));
      await expectSavedTheme(read, 'twitch', { visible: true, width: 360, theme: 'light' });
      await chooseChatTheme(page, 'dark');
      await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.themeStatus === 'applied');
      await chooseChatTheme(page, 'light');
      assert.deepEqual((await verify()).mismatches, []);
      await chooseChatTheme(page, 'native');
      assert.equal(await page.locator('[data-theater-chat]').evaluate(el => el.className.includes('theater-chat-theme-')), false);
      assert.equal(await page.locator('[data-theater-chat-palette]').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('tw-root--theme-dark')), true);
      await chooseChatTheme(page, 'light');
      const nativeText = await page.evaluate(() => {
        const rule = (document.querySelector<HTMLStyleElement>('#service-palette')!.sheet!.cssRules[0] as CSSStyleRule);
        const previous = rule.style.getPropertyValue('--color-text-base');
        rule.style.setProperty('--color-text-base', 'magenta');
        return previous;
      });
      await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.themeStatus === 'unavailable');
      assert.equal(await page.locator('[data-theater-chat-palette]').count(), 0);
      await page.evaluate(value => {
        const rule = document.querySelector<HTMLStyleElement>('#service-palette')!.sheet!.cssRules[0] as CSSStyleRule;
        rule.style.setProperty('--color-text-base', value);
      }, nativeText);
      await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.themeStatus === 'applied');
      assert.deepEqual((await verify()).mismatches, []);
      await leaveTheater(page);
      assert.deepEqual(pageErrors(page), []);
    });
  }

  it('keeps YouTube chat in place while docking, resizing, remembering width, and restoring the page', { timeout: 120_000 }, async t => {
    const browser = pagesOf(browsers.chromium, t);
    const { page, read } = await openPage(browser, { url: YOUTUBE_WATCH, youtube: youtubeDocument('visible') }, { width: 1280, height: 800 });
    await boot(page);
    await page.waitForFunction(() => document.querySelector('[data-theater-chat]'));
    let layout = await layoutOf(page);
    assert.equal(layout.state?.available, true, JSON.stringify(layout.state));
    assert.equal(layout.state?.visible, true, JSON.stringify(layout.state));
    assert.equal(layout.active, true, JSON.stringify(layout));
    assert.equal(layout.visibleAttr, true, JSON.stringify(layout));
    assert.equal(layout.chatHidden, false, JSON.stringify(layout));
    assert.equal(layout.toggleHidden, false, JSON.stringify(layout));
    assert.equal(layout.toggleExpanded, 'true', JSON.stringify(layout));
    assert.equal(layout.toggleLabel, 'Hide chat', JSON.stringify(layout));
    assert.equal(layout.secondaryAncestor, true, JSON.stringify(layout));
    assertRightDock(layout, 'youtube initial');
    // Hit testing ignores the pointer-free backdrop; check the composited pixels.
    // Native view-transition names must not trap a clickable chat below the stage.
    const screenshot = await page.locator('iframe#chatframe').screenshot();
    const pixel = await page.evaluate(async dataUrl => {
      const image = new Image();
      const loaded = new Promise<void>(resolve => { image.onload = () => resolve(); });
      image.src = dataUrl; await loaded;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, image.width/2, image.height/2, 1, 1, 0, 0, 1, 1);
      return [...ctx.getImageData(0,0,1,1).data];
    }, 'data:image/png;base64,' + screenshot.toString('base64'));
    assert.deepEqual(pixel, [253,250,245,255], 'native chat must paint above the TME backdrop');


    const frame = page.frameLocator('#chatframe');
    await frame.locator('#draft').fill('hello-1');
    const preserved = await layoutOf(page);
    await page.locator('.theater-chat-toggle').click();
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-chat-hidden') || document.querySelector('[data-theater-chat-hidden]'));
    layout = await layoutOf(page);
    assert.equal(layout.state?.visible, false, JSON.stringify(layout.state));
    assert.equal(layout.visibleAttr, false, JSON.stringify(layout));
    assert.equal(layout.chatHidden, true, JSON.stringify(layout));
    assert.equal(layout.toggleLabel, 'Show chat', JSON.stringify(layout));
    assert.equal(layout.connected, true, JSON.stringify(layout));
    assert.equal(layout.parentId, preserved.parentId, JSON.stringify(layout));
    assert.equal(layout.src, preserved.src, JSON.stringify(layout));
    assert.equal(layout.identity, 'primary', JSON.stringify(layout));
    assert.equal(layout.loads, preserved.loads, JSON.stringify(layout));
    assert.equal(layout.draft, 'hello-1', JSON.stringify(layout));
    assert.equal(layout.chatCount, 1, JSON.stringify(layout));
    assertFullVideo(layout, 'youtube hidden');
    await page.locator('.theater-chat-toggle').click();
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-chat-visible'));
    layout = await layoutOf(page);
    assert.equal(layout.draft, 'hello-1', JSON.stringify(layout));
    assert.equal(layout.src, preserved.src, JSON.stringify(layout));
    assert.equal(layout.loads, preserved.loads, JSON.stringify(layout));
    assert.equal(layout.parentId, preserved.parentId, JSON.stringify(layout));
    assertRightDock(layout, 'youtube shown again');
    await page.keyboard.press('c');
    layout = await layoutOf(page);
    assert.equal(layout.state?.visible, true, JSON.stringify(layout.state));
    await page.keyboard.press('Alt+R');
    await page.waitForFunction(() => document.querySelector('[data-theater-chat-hidden]'));
    layout = await layoutOf(page);
    assert.equal(layout.state?.visible, false, JSON.stringify(layout.state));
    assert.equal(layout.loads, preserved.loads, JSON.stringify(layout));
    await page.keyboard.press('Alt+R');
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-chat-visible'));

    await setChatWidth(page, CHOSEN_WIDTH);
    await page.waitForFunction(width => {
      const chat = document.querySelector('[data-theater-chat]');
      return chat !== null && Math.abs(chat.getBoundingClientRect().width - width) <= 4;
    }, CHOSEN_WIDTH);
    layout = await layoutOf(page);
    assert.equal(layout.state?.width, CHOSEN_WIDTH, JSON.stringify(layout.state));
    assert.ok(layout.chat && near(layout.chat.width, CHOSEN_WIDTH), JSON.stringify(layout));
    assertRightDock(layout, 'youtube chosen width');
    await waitForSaved(read, 'youtube', preference => preference.visible === true && preference.width === CHOSEN_WIDTH);

    await installFrameRuntime(page);
    await armPlaybackProbe(page);
    const chatFrame = page.frames().find(candidate => candidate.url().includes('/live_chat'));
    assert.ok(chatFrame);
    await chatFrame.locator('#send').focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
    assert.equal(await chatFrame.evaluate(() => (window as unknown as { __buttonClicks: number }).__buttonClicks), 2);
    await chatFrame.locator('#send').focus();
    await page.keyboard.press('t');
    await page.keyboard.press('m');
    await chatFrame.locator('#draft').focus();
    await page.keyboard.press('t');
    await page.keyboard.press('m');
    await page.keyboard.press('Space');
    layout = await layoutOf(page);
    const frameKeys = await chatFrame.evaluate(() => (window as unknown as { __chatKeyLog: Array<{ key: string; defaultPrevented: boolean }> }).__chatKeyLog);
    assert.equal(layout.theater, true, JSON.stringify(layout));
    assert.equal(layout.paused, false, JSON.stringify(layout));
    assert.equal(layout.muted, true, JSON.stringify(layout));
    assert.equal(layout.pauseCalls, 0, JSON.stringify(layout));
    assert.equal(layout.draft?.replace(/\u00a0/g, ' '), 'hello-1tm ', JSON.stringify(layout));
    for (const key of [' ', 't', 'm']) assertKeyReached(frameKeys, key, 'youtube chat frame');

    await page.setViewportSize({ width: 800, height: 720 });
    await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.dock === 'bottom');
    await page.waitForFunction(() => document.getElementById('below')?.hasAttribute('data-theater-chat-ancestor'));
    layout = await layoutOf(page);
    assertBottomDock(layout, 'youtube narrow');
    const narrowAncestor = await page.locator('#below').evaluate(element => ({
      containsChat: element.contains(document.getElementById('chat')),
      opacity: getComputedStyle(element).opacity,
      visibility: getComputedStyle(element).visibility
    }));
    assert.deepEqual(narrowAncestor, { containsChat: true, opacity: '1', visibility: 'visible' });
    const beforeNarrowToggle = await layoutOf(page);
    await page.locator('.theater-chat-toggle').click();
    await page.locator('.theater-chat-toggle').click();
    layout = await layoutOf(page);
    assert.equal(layout.src, beforeNarrowToggle.src, JSON.stringify(layout));
    assert.equal(layout.loads, beforeNarrowToggle.loads, JSON.stringify(layout));
    assert.equal(layout.parentId, beforeNarrowToggle.parentId, JSON.stringify(layout));
    assert.equal(layout.draft, beforeNarrowToggle.draft, JSON.stringify(layout));
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.dock === 'right');
    await page.waitForFunction(() => document.getElementById('secondary')?.hasAttribute('data-theater-chat-ancestor'));
    layout = await layoutOf(page);
    assert.ok(layout.chat && near(layout.chat.width, CHOSEN_WIDTH), JSON.stringify(layout));
    assertRightDock(layout, 'youtube wide again');

    await page.locator('.theater-chat-toggle').click();
    await waitForSaved(read, 'youtube', preference => preference.visible === false && preference.width === CHOSEN_WIDTH);
    await page.evaluate(() => {
      const chat = document.querySelector('[data-theater-chat]');
      if (!(chat instanceof HTMLElement)) throw new Error('missing chat');
      chat.dataset.siteRevision = 'kept';
      chat.classList.add('site-chat-theme');
      chat.style.caretColor = 'rgb(7, 8, 9)';
    });
    await leaveTheater(page);
    layout = await layoutOf(page);
    assert.equal(layout.theater, false, JSON.stringify(layout));
    assert.equal(layout.chatCount, 0, JSON.stringify(layout));
    assert.equal(layout.active, false, JSON.stringify(layout));
    assert.equal(layout.visibleAttr, false, JSON.stringify(layout));
    assert.equal(layout.videoMarked, false, JSON.stringify(layout));
    assert.equal(layout.videoPosition, '', JSON.stringify(layout));
    assert.equal(layout.vars.videoWidth, '', JSON.stringify(layout.vars));
    assert.equal(layout.vars.chatWidth, '', JSON.stringify(layout.vars));
    const restored = await page.evaluate(() => {
      const chat = document.getElementById('chat');
      return {
        revision: chat?.dataset.siteRevision ?? null,
        theme: Boolean(chat?.classList.contains('site-chat-theme')),
        caret: chat instanceof HTMLElement ? chat.style.caretColor : '',
        color: chat instanceof HTMLElement ? chat.style.color : '',
        parent: chat?.parentElement?.id ?? null
      };
    });
    assert.deepEqual(restored, {
      revision: 'kept',
      theme: true,
      caret: 'rgb(7, 8, 9)',
      color: 'rgb(1, 2, 3)',
      parent: 'chat-container'
    });

    await page.reload({ waitUntil: 'load' });
    await boot(page);
    await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.visible);
    layout = await layoutOf(page);
    assert.equal(layout.state?.visible, true, JSON.stringify(layout.state));
    assert.equal(layout.state?.width, CHOSEN_WIDTH, JSON.stringify(layout.state));
    assert.equal(pixels(layout.vars.chatWidth), CHOSEN_WIDTH, JSON.stringify(layout.vars));
    assertRightDock(layout, 'native visibility overrides the saved hidden preference');
    await page.waitForFunction(width => {
      const chat = document.querySelector('[data-theater-chat]');
      return chat !== null && !chat.hasAttribute('data-theater-chat-hidden') && Math.abs(chat.getBoundingClientRect().width - width) <= 4;
    }, CHOSEN_WIDTH);
    assertRightDock(await layoutOf(page), 'youtube restored width');
    assert.deepEqual(pageErrors(page), []);
  });

  it('keeps Twitch chat input and menu keys in the native column without pausing the video', { timeout: 120_000 }, async t => {
    const browser = pagesOf(browsers.chromium, t);
    const { page, read } = await openPage(browser, { url: TWITCH_CHANNEL, twitch: twitchDocument() }, { width: 1280, height: 800 });
    await boot(page);
    await page.waitForFunction(() => document.querySelector('[data-theater-chat]'));
    let layout = await layoutOf(page);
    assert.equal(layout.state?.available, true, JSON.stringify(layout.state));
    assert.equal(layout.state?.visible, true, JSON.stringify(layout.state));
    assert.equal(layout.parentTag, 'BODY', JSON.stringify(layout));
    assert.equal(layout.toggleLabel, 'Hide chat', JSON.stringify(layout));
    assertRightDock(layout, 'twitch initial');
    const sectionInsideColumn = await page.evaluate(() => {
      const column = document.querySelector('[data-theater-chat]');
      const section = document.querySelector('[data-test-selector="chat-room-component-layout"]');
      return Boolean(column && section && column.contains(section) && section.parentElement?.classList.contains('stream-chat'));
    });
    assert.equal(sectionInsideColumn, true);

    await page.locator('#draft').fill('hello-1');
    const preserved = await layoutOf(page);
    await page.locator('.theater-chat-toggle').click();
    await page.waitForFunction(() => document.querySelector('[data-theater-chat-hidden]'));
    layout = await layoutOf(page);
    assert.equal(layout.parentTag, 'BODY', JSON.stringify(layout));
    assert.equal(layout.connected, true, JSON.stringify(layout));
    assert.equal(layout.chatCount, 1, JSON.stringify(layout));
    assert.equal(layout.draft, preserved.draft, JSON.stringify(layout));
    assert.ok(layout.draft?.includes('hello-1'), JSON.stringify(layout));
    assertFullVideo(layout, 'twitch hidden');
    await page.locator('.theater-chat-toggle').click();
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-chat-visible'));
    layout = await layoutOf(page);
    assert.equal(layout.parentTag, preserved.parentTag, JSON.stringify(layout));
    assert.equal(layout.draft, preserved.draft, JSON.stringify(layout));
    assertRightDock(layout, 'twitch shown again');

    await setChatWidth(page, CHOSEN_WIDTH);
    await page.waitForFunction(width => {
      const chat = document.querySelector('[data-theater-chat]');
      return chat !== null && Math.abs(chat.getBoundingClientRect().width - width) <= 4;
    }, CHOSEN_WIDTH);
    await waitForSaved(read, 'twitch', preference => preference.visible === true && preference.width === CHOSEN_WIDTH);
    assertRightDock(await layoutOf(page), 'twitch chosen width');

    await armPlaybackProbe(page);
    await page.locator('#chat-menu').focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => (window as unknown as { __buttonClicks: number }).__buttonClicks), 2);
    await page.locator('#chat-menu').focus();
    await page.keyboard.press('t');
    await page.keyboard.press('m');
    await page.locator('#draft').focus();
    await page.keyboard.press('t');
    await page.keyboard.press('m');
    await page.keyboard.press('Space');
    layout = await layoutOf(page);
    const keys = await page.evaluate(() => (window as unknown as { __chatKeyLog: Array<{ key: string; defaultPrevented: boolean }> }).__chatKeyLog);
    assert.equal(layout.theater, true, JSON.stringify(layout));
    assert.equal(layout.paused, false, JSON.stringify(layout));
    assert.equal(layout.muted, true, JSON.stringify(layout));
    assert.equal(layout.pauseCalls, 0, JSON.stringify(layout));
    assert.ok(layout.draft?.replace(/\u00a0/g, ' ').includes('hello-1tm'), JSON.stringify(layout));
    for (const key of [' ', 't', 'm']) assertKeyReached(keys, key, 'twitch chat');

    await page.setViewportSize({ width: 800, height: 720 });
    await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.dock === 'bottom');
    assertBottomDock(await layoutOf(page), 'twitch narrow');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.dock === 'right');
    layout = await layoutOf(page);
    assert.ok(layout.chat && near(layout.chat.width, CHOSEN_WIDTH), JSON.stringify(layout));
    assertRightDock(layout, 'twitch wide again');

    await page.evaluate(() => {
      const chat = document.querySelector('[data-theater-chat]');
      if (!(chat instanceof HTMLElement)) throw new Error('missing chat');
      chat.dataset.siteRevision = 'kept';
      chat.classList.add('site-chat-theme');
      chat.style.caretColor = 'rgb(7, 8, 9)';
    });
    await leaveTheater(page);
    const restored = await page.evaluate(() => {
      const chat = document.querySelector('.right-column');
      const player = document.querySelector('.persistent-player');
      return {
        marked: document.querySelector('[data-theater-chat], [data-theater-chat-hidden]') !== null,
        active: document.documentElement.hasAttribute('data-theater-chat-active'),
        visible: document.documentElement.hasAttribute('data-theater-chat-visible'),
        revision: chat?.getAttribute('data-site-revision') ?? null,
        theme: Boolean(chat?.classList.contains('site-chat-theme')),
        caret: chat instanceof HTMLElement ? chat.style.caretColor : '',
        color: document.querySelector('.chat-room') instanceof HTMLElement
          ? (document.querySelector('.chat-room') as HTMLElement).style.color
          : '',
        playerPosition: player instanceof HTMLElement ? getComputedStyle(player).position : '',
        stage: document.documentElement.classList.contains('theater-everywhere-twitch-stage'),
        videoPosition: document.querySelector('video') instanceof HTMLElement
          ? (document.querySelector('video') as HTMLElement).style.getPropertyValue('position')
          : 'missing'
      };
    });
    assert.deepEqual(restored, {
      marked: false,
      active: false,
      visible: false,
      revision: 'kept',
      theme: true,
      caret: 'rgb(7, 8, 9)',
      color: 'rgb(1, 2, 3)',
      playerPosition: 'static',
      stage: false,
      videoPosition: ''
    });
    assert.deepEqual(pageErrors(page), []);
  });

  it('exposes the chat toggle before YouTube mounts a frame and opens it with Alt+R', { timeout: 120_000 }, async t => {
    const browser = pagesOf(browsers.chromium, t);
    const { page } = await openPage(browser, {url:YOUTUBE_WATCH,youtube:youtubeDocument('none')}, {width:1280,height:800});
    await page.evaluate(() => {
      const card = document.createElement('yt-video-metadata-carousel-view-model');
      card.setAttribute('role','button');card.setAttribute('aria-label','Live chat');
      card.innerHTML='<button>Open panel</button>';
      card.dataset.clicks='0';
      card.addEventListener('click',() => {
        card.dataset.clicks=String(Number(card.dataset.clicks)+1);
        const chat = document.createElement('ytd-live-chat-frame');chat.id='chat';
        const iframe=document.createElement('iframe');iframe.id='chatframe';
        iframe.src='https://www.youtube.com/live_chat?v=abcdefghijk';
        chat.append(iframe);document.querySelector('#secondary')?.append(chat);
        (card.querySelector('button') as HTMLButtonElement).disabled=true;
      });
      document.querySelector('ytd-watch-flexy')?.append(card);
    });
    await boot(page);
    const initial=await layoutOf(page);
    assert.equal(initial.state?.available,true);
    assert.equal(initial.state?.visible,false);
    assert.equal(initial.toggleHidden,false);
    assert.equal(initial.chatCount,0);
    assertFullVideo(initial,'YouTube activation card only');
    await page.keyboard.press('Alt+R');
    await page.waitForFunction(()=>window.NativeChatTest.nativeChatState()?.visible);
    await page.locator('#chatframe').contentFrame().locator('#draft').fill('keep the native draft');
    assertRightDock(await layoutOf(page),'YouTube opened through native card');
    await page.locator('.theater-chat-toggle').focus();
    await page.keyboard.press('Alt+R');
    await page.waitForFunction(()=>!window.NativeChatTest.nativeChatState()?.visible);
    await page.locator('.theater-chat-toggle').click();
    await page.waitForFunction(()=>window.NativeChatTest.nativeChatState()?.visible);
    assert.equal(await page.locator('yt-video-metadata-carousel-view-model').getAttribute('data-clicks'),'1');
    assert.equal(await page.locator('#chatframe').contentFrame().locator('#draft').inputValue(),'keep the native draft');
    assert.deepEqual(pageErrors(page),[]);
  });

  it('leaves ordinary videos alone, adopts a late chat, and rebinds when that root is replaced', { timeout: 120_000 }, async t => {
    const browser = pagesOf(browsers.chromium, t);
    const absent = await openPage(browser, { url: YOUTUBE_WATCH, youtube: youtubeDocument('none') }, { width: 1280, height: 800 });
    // Capture controller timers before boot, then observe absence across two
    // complete 500ms discovery polls without waiting for wall-clock time.
    await absent.page.clock.install();
    await boot(absent.page);
    await absent.page.clock.runFor(1000);
    let layout = await layoutOf(absent.page);
    assert.equal(layout.state?.available, false, JSON.stringify(layout.state));
    assert.equal(layout.toggleHidden, true, JSON.stringify(layout));
    assert.equal(layout.chatCount, 0, JSON.stringify(layout));
    assert.equal(layout.active, false, JSON.stringify(layout));
    assert.equal(layout.visibleAttr, false, JSON.stringify(layout));
    assert.equal(layout.secondaryAncestor, false, JSON.stringify(layout));
    assert.equal(layout.secondaryHidden, true, JSON.stringify(layout));
    assertFullVideo(layout, 'youtube without chat');
    assert.deepEqual(pageErrors(absent.page), []);
    await absent.page.close();

    const collapsed = await openPage(browser, { url: YOUTUBE_WATCH, youtube: youtubeDocument('collapsed') }, { width: 1280, height: 800 });
    await boot(collapsed.page);
    await collapsed.page.waitForFunction(() => document.querySelector('[data-theater-chat]'));
    layout = await layoutOf(collapsed.page);
    assert.equal(layout.state?.available, true, JSON.stringify(layout.state));
    assert.equal(layout.state?.visible, false, JSON.stringify(layout.state));
    assert.equal(layout.toggleHidden, false, JSON.stringify(layout));
    assert.equal(layout.toggleExpanded, 'false', JSON.stringify(layout));
    assert.equal(layout.chatHidden, true, JSON.stringify(layout));
    assert.equal(layout.visibleAttr, false, JSON.stringify(layout));
    assertFullVideo(layout, 'youtube natively collapsed');
    await collapsed.page.locator('.theater-chat-toggle').click();
    await collapsed.page.waitForFunction(() => {
      const chat = document.querySelector('[data-theater-chat]');
      return chat !== null && chat.getBoundingClientRect().width > 200 && !chat.hasAttribute('data-theater-chat-hidden');
    });
    layout = await layoutOf(collapsed.page);
    assert.equal(layout.state?.visible, true, JSON.stringify(layout.state));
    assertRightDock(layout, 'youtube opened from collapsed');
    assert.deepEqual(pageErrors(collapsed.page), []);
    await collapsed.page.close();

    const delayed = await openPage(browser, { url: YOUTUBE_WATCH, youtube: youtubeDocument('none') }, { width: 1280, height: 800 });
    await boot(delayed.page);
    await delayed.page.evaluate(() => {
      const secondary = document.getElementById('secondary');
      if (!secondary) throw new Error('missing secondary');
      const container = document.createElement('div');
      container.id = 'chat-container';
      const chat = document.createElement('ytd-live-chat-frame');
      chat.id = 'chat';
      chat.style.display = 'block';
      chat.style.width = '340px';
      chat.style.height = '420px';
      const iframe = document.createElement('iframe');
      iframe.id = 'chatframe';
      iframe.dataset.fixtureIdentity = 'delayed';
      const probe = window as Window & { __chatLoads?: number };
      probe.__chatLoads = 0;
      iframe.addEventListener('load', () => { probe.__chatLoads = (probe.__chatLoads ?? 0) + 1; });
      iframe.src = 'https://www.youtube.com/live_chat?v=abcdefghijk';
      chat.append(iframe);
      container.append(chat);
      secondary.append(container);
    });
    await delayed.page.waitForFunction(() => {
      const chat = document.querySelector('[data-theater-chat]');
      return chat?.id === 'chat' && document.documentElement.hasAttribute('data-theater-chat-visible');
    });
    layout = await layoutOf(delayed.page);
    assert.equal(layout.identity, 'delayed', JSON.stringify(layout));
    assert.equal(layout.secondaryAncestor, true, JSON.stringify(layout));
    assert.equal(layout.toggleHidden, false, JSON.stringify(layout));
    assertRightDock(layout, 'youtube delayed chat');

    const beforeReplace = await layoutOf(delayed.page);
    await delayed.page.evaluate(() => {
      const current = document.getElementById('chat');
      if (!current) throw new Error('missing chat');
      const next = document.createElement('ytd-live-chat-frame');
      next.id = 'chat';
      next.dataset.fixtureGeneration = '2';
      next.style.display = 'block';
      next.style.width = '340px';
      next.style.height = '420px';
      const iframe = document.createElement('iframe');
      iframe.id = 'chatframe';
      iframe.dataset.fixtureIdentity = 'replaced';
      const probe = window as Window & { __replacedLoads?: number; __detachedConnected?: () => boolean };
      probe.__replacedLoads = 0;
      iframe.addEventListener('load', () => { probe.__replacedLoads = (probe.__replacedLoads ?? 0) + 1; });
      iframe.src = 'https://www.youtube.com/live_chat?v=abcdefghijk&replaced=1';
      next.append(iframe);
      probe.__detachedConnected = () => current.isConnected;
      current.replaceWith(next);
    });
    await delayed.page.waitForFunction(() => {
      const chat = document.getElementById('chat');
      const frame = chat?.querySelector('#chatframe');
      return chat?.dataset.fixtureGeneration === '2'
        && chat.hasAttribute('data-theater-chat')
        && frame instanceof HTMLIFrameElement
        && frame.getAttribute('src')?.includes('replaced=1')
        && frame.contentDocument?.readyState === 'complete';
    });
    await delayed.page.frameLocator('#chatframe').locator('#draft').fill('replaced-draft');
    const replaced = await layoutOf(delayed.page);
    assert.equal(replaced.detachedConnected, false, JSON.stringify(replaced));
    assert.equal(replaced.generation, '2', JSON.stringify(replaced));
    assert.equal(replaced.identity, 'replaced', JSON.stringify(replaced));
    assert.equal(replaced.chatCount, 1, JSON.stringify(replaced));
    assert.ok(replaced.loads >= beforeReplace.loads, JSON.stringify(replaced));
    await delayed.page.locator('.theater-chat-toggle').click();
    await delayed.page.locator('.theater-chat-toggle').click();
    await delayed.page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-chat-visible'));
    layout = await layoutOf(delayed.page);
    assert.equal(layout.src, replaced.src, JSON.stringify(layout));
    assert.equal(layout.replacedLoads, replaced.replacedLoads, JSON.stringify(layout));
    assert.equal(layout.draft, 'replaced-draft', JSON.stringify(layout));
    assert.equal(layout.parentId, 'chat-container', JSON.stringify(layout));
    assert.equal(layout.detachedConnected, false, JSON.stringify(layout));
    assertRightDock(layout, 'youtube replaced chat');
    assert.deepEqual(pageErrors(delayed.page), []);
  });

  it('shares theme options and retains independent preferences for Twitch and YouTube', { timeout: 120_000 }, async t => {
    const browser = pagesOf(browsers.chromium, t);
    const themeOptions = [
      { value: 'light', text: 'Light' },
      { value: 'native', text: 'Service settings' },
      { value: 'dark', text: 'Dark' }
    ];
    const absent = await openPage(browser, { url: YOUTUBE_WATCH, youtube: youtubeDocument('none') }, { width: 1280, height: 800 });
    // Capture controller timers before boot, then observe absence across two
    // complete 500ms discovery polls without waiting for wall-clock time.
    await absent.page.clock.install();
    await boot(absent.page);
    await absent.page.clock.runFor(1000);
    const absentTheme = await readThemeControl(absent.page);
    assert.equal(absentTheme.hidden, true, JSON.stringify(absentTheme));
    assert.equal(absentTheme.disabled, true, JSON.stringify(absentTheme));
    assert.deepEqual(pageErrors(absent.page), []);
    await absent.page.close();

    const seeded = {
      nativeChatPreferences: {
        youtube: { visible: true, width: 400, theme: 'dark' },
        twitch: { visible: true, width: 380 }
      }
    };
    const { page, read } = await openPage(
      browser,
      { url: TWITCH_CHANNEL, youtube: youtubeDocument('visible'), twitch: twitchDocument() },
      { width: 1280, height: 800 },
      seeded
    );
    await boot(page);
    await page.waitForFunction(() => document.querySelector('[data-theater-chat]'));
    let theme = await readThemeControl(page);
    assert.deepEqual(theme.options, themeOptions, JSON.stringify(theme));
    assert.equal(theme.label, 'Theme', JSON.stringify(theme));
    assert.equal(theme.text, 'Theme', JSON.stringify(theme));
    await revealChatSettings(page);
    const menu = await page.evaluate(() => {
      const root = document.getElementById('theater-everywhere-ui')?.shadowRoot;
      const body = root?.querySelector('.theater-settings-body');
      const chat = body?.querySelector('[data-settings-section="chat"]');
      const width = root?.querySelector('.theater-chat-width-row') ?? null;
      const themeRow = root?.querySelector('.theater-chat-theme-row');
      const sameRow = (row: Element | null | undefined) => {
        const label = row?.querySelector('.theater-settings-label');
        const control = row?.querySelector('input, select');
        if (!(label instanceof HTMLElement) || !(control instanceof HTMLElement)) return false;
        return Math.abs(label.getBoundingClientRect().top - control.getBoundingClientRect().top) < 12;
      };
      return {
        order: [...(body?.children ?? [])].slice(0, 5).map(node =>
          node instanceof HTMLElement && node.dataset.settingsSection
            ? node.dataset.settingsSection : node.className),
        chatHeading: chat?.querySelector('.theater-settings-heading')?.textContent ?? null,
        playerHeading: body?.querySelector(':scope > .theater-settings-heading')?.textContent ?? null,
        widthRow: width !== null,
        themeInChat: Boolean(themeRow && chat?.contains(themeRow)),
        themeInline: sameRow(themeRow),
        chatActive: root?.querySelector('.theater-chat-toggle')?.classList.contains('active') ?? false,
        chatColor: (() => {
          const toggle = root?.querySelector('.theater-chat-toggle');
          return toggle instanceof HTMLElement ? getComputedStyle(toggle).color : null;
        })(),
        idleColor: (() => {
          const idle = root?.querySelector('.fullscreen-btn');
          return idle instanceof HTMLElement ? getComputedStyle(idle).color : null;
        })()
      };
    });
    assert.deepEqual(menu.order, [
      'chat',
      'theater-settings-separator',
      'audio',
      'theater-settings-separator',
      'theater-settings-heading'
    ], JSON.stringify(menu));
    assert.equal(menu.chatHeading, 'Chat');
    assert.equal(menu.playerHeading, 'Player');
    assert.equal(menu.widthRow, false, 'the separator replaces the Width row');
    assert.equal(menu.themeInChat, true);
    assert.equal(menu.themeInline, true);
    assert.equal(menu.chatActive, true);
    assert.notEqual(menu.chatColor, menu.idleColor, JSON.stringify(menu));
    await closeChatSettings(page);
    assert.equal(theme.value, 'native', JSON.stringify(theme));
    assert.equal(theme.hidden, false, JSON.stringify(theme));
    assert.equal(theme.disabled, false, JSON.stringify(theme));
    assert.equal(theme.inSettings, true, JSON.stringify(theme));
    assert.deepEqual(read().nativeChatPreferences, seeded.nativeChatPreferences);

    await page.goto(YOUTUBE_WATCH, { waitUntil: 'load' });
    await boot(page);
    await page.waitForFunction(() => document.querySelector('[data-theater-chat]'));
    theme = await readThemeControl(page);
    assert.equal(theme.value, 'dark', JSON.stringify(theme));
    assert.equal(theme.hidden, false, JSON.stringify(theme));
    assert.equal(theme.disabled, false, JSON.stringify(theme));
    assert.deepEqual(theme.options, themeOptions, JSON.stringify(theme));
    assert.deepEqual(read().nativeChatPreferences, seeded.nativeChatPreferences);
    await setChatWidth(page, 440);
    await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.themeStatus === 'applied');
    assert.equal(await page.locator('.theater-chat-theme-hint').isVisible(), false);
    await chooseChatTheme(page, 'light');
    await expectSavedTheme(read, 'youtube', {visible:true,width:440,theme:'light'});
    await closeChatSettings(page);
    await page.locator('.theater-chat-toggle').click();
    await page.waitForFunction(() => document.querySelector('[data-theater-chat-hidden]'));
    theme = await readThemeControl(page);
    assert.equal(theme.value,'light');
    assert.equal(theme.disabled,false);
    await page.locator('.theater-chat-toggle').click();
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-chat-visible'));
    await expectSavedTheme(read, 'youtube', {visible:true,width:440,theme:'light'});
    let layout = await layoutOf(page);
    assert.equal(layout.state?.width,440);

    await page.goto(TWITCH_CHANNEL, { waitUntil: 'load' });
    await boot(page);
    await page.waitForFunction(() => document.querySelector('[data-theater-chat]'));
    theme = await readThemeControl(page);
    assert.equal(theme.value, 'native', JSON.stringify(theme));
    assert.equal(theme.hidden, false, JSON.stringify(theme));
    assert.deepEqual(theme.options, themeOptions, JSON.stringify(theme));
    await chooseChatTheme(page, 'light');
    await expectSavedTheme(read, 'twitch', { visible: true, width: 380, theme: 'light' });
    await expectAppliedTheme(page, 'light');
    const separated = read().nativeChatPreferences as Record<string, { visible: boolean; width: number; theme: string }>;
    assert.deepEqual(Object.keys(separated).sort(), ['twitch', 'youtube']);
    assert.deepEqual(separated.youtube, { visible: true, width: 440, theme: 'light' });
    assert.deepEqual(Object.keys(separated.twitch).sort(), ['theme', 'visible', 'width']);

    await chooseChatTheme(page, 'dark');
    await expectAppliedTheme(page, 'dark');
    await closeChatSettings(page);
    await page.locator('.theater-chat-toggle').click();
    await page.waitForFunction(() => document.querySelector('[data-theater-chat-hidden]'));
    theme = await readThemeControl(page);
    assert.equal(theme.hidden,false);
    assert.equal(theme.disabled,false);
    assert.equal(theme.value,'dark');
    await page.setViewportSize({width:800,height:720});
    await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.dock === 'bottom');
    await chooseChatTheme(page,'light');
    await expectSavedTheme(read,'twitch',{visible:false,width:380,theme:'light'});
    await closeChatSettings(page);
    await page.locator('.theater-chat-toggle').click();
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-chat-visible'));
    assertBottomDock(await layoutOf(page),'Twitch theme on bottom dock');
    await page.setViewportSize({width:1280,height:800});
    await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.dock === 'right');
    await page.reload({ waitUntil: 'load' });
    await boot(page);
    await page.waitForFunction(() => document.querySelector('[data-theater-chat]'));
    theme = await readThemeControl(page);
    assert.equal(theme.value, 'light', JSON.stringify(theme));
    await expectAppliedTheme(page, 'light');
    layout = await layoutOf(page);
    assert.equal(layout.state?.width, 380, JSON.stringify(layout.state));

    await page.goto(YOUTUBE_WATCH, { waitUntil: 'load' });
    await boot(page);
    await page.waitForFunction(() => document.querySelector('[data-theater-chat]'));
    theme = await readThemeControl(page);
    assert.equal(theme.value, 'light', JSON.stringify(theme));
    await expectAppliedTheme(page, 'light');
    layout = await layoutOf(page);
    assert.equal(layout.state?.visible, true, JSON.stringify(layout.state));
    assert.equal(layout.state?.width, 440, JSON.stringify(layout.state));
    assert.deepEqual(pageErrors(page), []);
  });
  it('flushes pending chat preferences on theater exit and immediate page reload', { timeout: 60_000 }, async t => {
    const browser = pagesOf(browsers.chromium, t);
    for (const provider of ['youtube', 'twitch'] as const) {
      for (const ending of ['exit', 'reload'] as const) {
        const seed = { nativeChatPreferences: { [provider]: { visible: true, width: 360, theme: 'native' } } };
        const { page, read } = await openPage(browser, {
          url: provider === 'youtube' ? YOUTUBE_WATCH : TWITCH_CHANNEL,
          youtube: youtubeDocument('visible'), twitch: twitchDocument()
        }, { width: 1280, height: 800 }, seed, 'tme-navigation-storage');
        await boot(page);
        const mutate = () => page.evaluate(ending => {
          const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
          const chrome = (window as unknown as { chrome: { storage: { sync: { set(data: Record<string, unknown>): Promise<void> } } } }).chrome;
          const writes: Record<string, unknown>[] = [];
          const save = chrome.storage.sync.set;
          chrome.storage.sync.set = data => {
            writes.push(structuredClone(data));
            localStorage.setItem('tme-navigation-storage', JSON.stringify(data));
            return save(data);
          };
          const separator = root.querySelector<HTMLElement>('.theater-chat-separator')!;
          separator.focus();
          for (let step = 0; step < 8; step++) separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true, composed: true }));
          const theme = root.querySelector<HTMLSelectElement>('.theater-chat-theme-select')!;
          theme.value = 'dark'; theme.dispatchEvent(new Event('change', { bubbles: true }));
          root.querySelector<HTMLButtonElement>('.theater-chat-toggle')!.click();
          // All changes happen in one task, before the debounce can expire.
          const pendingWrites = writes.length;
          if (ending === 'exit') root.querySelector<HTMLButtonElement>('.close-btn')!.click();
          else window.location.reload();
          return { pendingWrites, writes };
        }, ending);
        const result = ending === 'reload'
          ? (await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), mutate()]))[1]
          : await mutate();
        assert.equal(result.pendingWrites, 0, provider + ' should debounce ordinary changes');
        if (ending === 'exit') assert.deepEqual(result.writes, [{ nativeChatPreferences: {
          [provider]: { visible: false, width: 440, theme: 'dark' }
        } }], provider + ' should flush once during exit');
        if (ending === 'exit') await waitForSaved(read, provider, value => !value.visible && value.width === 440 && value.theme === 'dark');
        const durable = await page.evaluate(() => JSON.parse(localStorage.getItem('tme-navigation-storage') || '{}'));
        assert.deepEqual(durable.nativeChatPreferences?.[provider], { visible: false, width: 440, theme: 'dark' });
        await page.reload({ waitUntil: 'load' });
        await boot(page);
        const state = await page.evaluate(() => window.NativeChatTest.nativeChatState());
        assert.equal(state?.visible, true); assert.equal(state?.width, 440); assert.equal(state?.theme, 'dark');
        assert.deepEqual(pageErrors(page), []);
        await page.close();
      }
    }
  });

  it('keeps native service popovers clickable above the video and TME settings button regardless of insertion order', {timeout: 60000}, async t => {
    const browser = pagesOf(browsers.chromium, t);
    for (const provider of ['twitch', 'youtube', 'youtube-dialog'] as const) {
      const { page } = await openPage(browser, {url: provider === 'twitch' ? TWITCH_CHANNEL : YOUTUBE_WATCH,
        twitch: twitchDocument(), youtube: youtubeDocument('visible')}, {width:1280,height:800});
      // Native portal is already mounted before the extension's UI host.
      await page.evaluate(provider => {
        const popup = document.createElement(provider === 'youtube' ? 'ytd-popup-container' : provider === 'youtube-dialog' ? 'tp-yt-paper-dialog' : 'div');
        if (provider === 'twitch') popup.className = 'tw-dialog-layer';
        popup.id = 'native-popup'; popup.style.cssText = 'position:fixed;width:120px;height:70px;z-index:4';
        popup.innerHTML = '<button id="native-popup-action" style="width:100%;height:100%">Native action</button>';
        popup.querySelector('button')!.addEventListener('click', () => popup.setAttribute('data-clicked','true'));
        if (provider === 'youtube-dialog') {
          const backdrop = document.createElement('tp-yt-iron-overlay-backdrop');
          backdrop.style.cssText = 'position:fixed;inset:0;z-index:2201';
          document.body.append(backdrop);
        }
        document.body.append(popup);
      }, provider);
      await boot(page);
      await page.evaluate(() => {
        const settings = document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.player-settings-btn')!;
        const rect = settings.getBoundingClientRect(), popup = document.getElementById('native-popup')!;
        popup.style.left = rect.x - 20 + 'px'; popup.style.top = rect.y - 20 + 'px';
      });
      const hit = await page.evaluate(() => {
        const button = document.getElementById('native-popup-action')!, r = button.getBoundingClientRect();
        return button.contains(document.elementFromPoint(r.x + r.width/2, r.y + r.height/2));
      });
      assert.equal(hit, true, provider + ' native popup was covered by TME');
      await page.locator('#native-popup-action').click();
      assert.equal(await page.locator('#native-popup').getAttribute('data-clicked'), 'true');
      assert.deepEqual(pageErrors(page), []);
      await page.close();
    }
  });

});
