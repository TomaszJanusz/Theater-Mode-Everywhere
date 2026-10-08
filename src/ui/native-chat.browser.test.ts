import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { Frame, Page, Route } from 'playwright';
import { readStylesheet } from '../test-utils/styles';
import type { ChatState } from '../chat';

declare global {
  interface Window {
    NativeChatTest: { nativeChatState(): ChatState | null };
  }
}

const require = createRequire(import.meta.url);
const SRC = new URL('../', import.meta.url).pathname;
const CSS = readStylesheet(path.join(SRC, 'content.css'));
const VOD = readFileSync(new URL('../../test/fixtures/vod.webm', import.meta.url));
const esbuild = require('esbuild') as { buildSync(options: object): { outputFiles: Array<{ text: string }> } };
const BUNDLE = esbuild.buildSync({
  stdin: {
    contents: [
      "export { bootstrapPlayerRuntime } from './ui/player-runtime';",
      "export { setPlayerUiCss } from './ui/root';",
      "export { installMainWorldRuntime } from './platform/main-world-runtime';",
      "export { nativeChatState } from './ui/chat';"
    ].join('\n'),
    resolveDir: SRC,
    loader: 'ts'
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'NativeChatTest',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'silent'
}).outputFiles[0].text;

const YOUTUBE_WATCH = 'https://www.youtube.com/watch?v=abcdefghijk';
const TWITCH_CHANNEL = 'https://www.twitch.tv/example';
const CHOSEN_WIDTH = 420;

const CHAT_FRAME = `<!doctype html><html><head><meta charset="utf-8"><title>Live chat</title></head><body>
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
  #movie_player, .persistent-player { width: 960px; height: 540px; }
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
    </ytd-watch-flexy>
    <script>
      const frame = document.getElementById('chatframe');
      window.__chatLoads = 0;
      if (frame) {
        frame.addEventListener('load', () => { window.__chatLoads += 1; });
        frame.src = 'https://www.youtube.com/live_chat?v=abcdefghijk';
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
  widthRowHidden: boolean | null;
  sliderInSettings: boolean;
  settingsButton: boolean;
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
  const widthRow = shadow?.querySelector('.theater-chat-width-row') ?? null;
  const slider = shadow?.querySelector('.theater-chat-width-slider') ?? null;
  const menu = slider?.closest('.theater-settings-menu') ?? null;
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
    toggleHidden: toggle instanceof HTMLElement ? toggle.hidden : null,
    toggleExpanded: toggle?.getAttribute('aria-expanded') ?? null,
    toggleLabel: toggle?.getAttribute('aria-label') ?? null,
    widthRowHidden: widthRow instanceof HTMLElement ? widthRow.hidden : null,
    sliderInSettings: Boolean(menu),
    settingsButton: Boolean(menu?.parentElement?.querySelector('.player-settings-btn')),
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
  assert.ok(near(host.width, video.width) && near(host.height, video.height), detail);
  assert.ok(near(host.left, video.left) && near(host.top, video.top), detail);
  assert.ok(inside(bar, video), detail);
  assert.ok(near(pixels(layout.vars.videoWidth), video.width), detail);
  assert.ok(near(pixels(layout.vars.videoHeight), video.height), detail);
  assert.ok(near(pixels(layout.vars.chatLeft), chat.left), detail);
  assert.ok(near(pixels(layout.vars.chatTop), chat.top), detail);
  assert.ok(near(pixels(layout.vars.chatWidth), chat.width), detail);
  assert.ok(near(pixels(layout.vars.chatHeight), chat.height), detail);
}

function assertRightDock(layout: Layout, label: string): void {
  const detail = `${label} ${JSON.stringify(layout)}`;
  assert.equal(layout.state?.dock, 'right', detail);
  assert.equal(layout.widthRowHidden, false, detail);
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
  assert.equal(layout.widthRowHidden, true, detail);
  assert.ok(layout.viewport.width < 900, detail);
  assert.ok(layout.video && layout.chat, detail);
  assert.ok(!overlaps(layout.video, layout.chat), detail);
  assert.ok(near(layout.chat.top, layout.video.bottom, 2), detail);
  assert.ok(layout.video.width >= layout.viewport.width - 8, detail);
  assert.ok(layout.chat.width >= layout.viewport.width - 8, detail);
  assert.ok(layout.video.height >= 80 && layout.chat.height >= 80, detail);
  assert.equal(layout.hitChat, true, detail);
  assert.ok(inside(layout.bar!, layout.video), detail);
}

function assertFullVideo(layout: Layout, label: string): void {
  const detail = `${label} ${JSON.stringify(layout)}`;
  assert.ok(layout.video, detail);
  assert.ok(layout.video.width >= layout.viewport.width - 8, detail);
  assert.ok(layout.video.height >= layout.viewport.height - 8, detail);
  assert.ok(layout.bar && inside(layout.bar, layout.video), detail);
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

async function installStorage(page: Page, seed: Record<string, unknown> = {}): Promise<{ read(): Record<string, unknown> }> {
  let storage: Record<string, unknown> = { keepControlsVisible: true, ...seed };
  await page.exposeFunction('__tmeStorageGet', () => storage);
  await page.exposeFunction('__tmeStorageSet', (patch: Record<string, unknown>) => {
    storage = { ...storage, ...patch };
  });
  // tsx gives serialized nested functions a naming helper. Install it in every
  // fixture frame, matching the existing Netflix browser harness.
  await page.addInitScript('window.__name = target => target;');
  await page.addInitScript(() => {
    const chromeMock = {
      storage: {
        sync: {
          get: async () => (window as unknown as { __tmeStorageGet(): Promise<Record<string, unknown>> }).__tmeStorageGet(),
          set: async (data: Record<string, unknown>) => {
            const snapshot = structuredClone(data);
            await (window as unknown as { __tmeStorageSet(patch: Record<string, unknown>): Promise<void> }).__tmeStorageSet(snapshot);
          },
          onChanged: { addListener() {} }
        }
      }
    };
    Object.defineProperty(window, 'chrome', { configurable: true, writable: true, value: chromeMock });
  });
  return { read: () => storage };
}

async function boot(page: Page): Promise<void> {
  await page.addStyleTag({ content: CSS });
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(`NativeChatTest.installMainWorldRuntime(); NativeChatTest.setPlayerUiCss(${JSON.stringify(CSS)}); NativeChatTest.bootstrapPlayerRuntime();`);
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

async function setChatWidth(page: Page, width: number): Promise<void> {
  await page.locator('.player-settings-btn').click();
  const placed = await page.evaluate(() => {
    const slider = document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-chat-width-slider');
    const menu = slider?.closest('.theater-settings-menu');
    return Boolean(menu && menu.parentElement?.querySelector('.player-settings-btn'));
  });
  assert.equal(placed, true, 'width slider is not inside the player settings menu');
  await page.locator('.theater-chat-width-slider').evaluate((slider, next: number) => {
    if (!(slider instanceof HTMLInputElement)) throw new Error('missing chat width slider');
    slider.value = String(next);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, width);
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
  await frame.evaluate(`NativeChatTest.installMainWorldRuntime(); NativeChatTest.setPlayerUiCss(${JSON.stringify(CSS)}); NativeChatTest.bootstrapPlayerRuntime();`);
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

async function openPage(browser: { newPage(options: { viewport: { width: number; height: number } }): Promise<Page> }, target: { url: string; youtube?: string; twitch?: string }, viewport: { width: number; height: number }, seed: Record<string, unknown> = {}): Promise<{ page: Page; read(): Record<string, unknown> }> {
  const page = await browser.newPage({ viewport });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  (page as Page & { __errors?: string[] }).__errors = errors;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const storage = await installStorage(page, seed);
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
      hidden: row.hidden,
      disabled: select.disabled,
      value: select.value,
      label: select.getAttribute('aria-label'),
      text: row.querySelector('span')?.textContent ?? null,
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
  it('keeps YouTube chat in place while docking, resizing, remembering width, and restoring the page', { timeout: 120_000 }, async t => {
    const { chromium } = await import('playwright');
    if (!existsSync(chromium.executablePath())) { t.skip('Chromium is not installed'); return; }
    const browser = await chromium.launch({ headless: true });
    try {
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
      layout = await layoutOf(page);
      assertBottomDock(layout, 'youtube narrow');
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
      await page.waitForFunction(() => document.querySelector('[data-theater-chat-hidden]'));
      layout = await layoutOf(page);
      assert.equal(layout.state?.visible, false, JSON.stringify(layout.state));
      assert.equal(layout.state?.width, CHOSEN_WIDTH, JSON.stringify(layout.state));
      assert.equal(pixels(layout.vars.chatWidth), CHOSEN_WIDTH, JSON.stringify(layout.vars));
      assertFullVideo(layout, 'youtube restored hidden preference');
      await page.locator('.theater-chat-toggle').click();
      await page.waitForFunction(width => {
        const chat = document.querySelector('[data-theater-chat]');
        return chat !== null && !chat.hasAttribute('data-theater-chat-hidden') && Math.abs(chat.getBoundingClientRect().width - width) <= 4;
      }, CHOSEN_WIDTH);
      assertRightDock(await layoutOf(page), 'youtube restored width');
      assert.deepEqual(pageErrors(page), []);
    } finally {
      await browser.close();
    }
  });

  it('keeps Twitch chat input and menu keys in the native column without pausing the video', { timeout: 120_000 }, async t => {
    const { chromium } = await import('playwright');
    if (!existsSync(chromium.executablePath())) { t.skip('Chromium is not installed'); return; }
    const browser = await chromium.launch({ headless: true });
    try {
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
    } finally {
      await browser.close();
    }
  });

  it('leaves ordinary videos alone, adopts a late chat, and rebinds when that root is replaced', { timeout: 120_000 }, async t => {
    const { chromium } = await import('playwright');
    if (!existsSync(chromium.executablePath())) { t.skip('Chromium is not installed'); return; }
    const browser = await chromium.launch({ headless: true });
    try {
      const absent = await openPage(browser, { url: YOUTUBE_WATCH, youtube: youtubeDocument('none') }, { width: 1280, height: 800 });
      await boot(absent.page);
      await absent.page.evaluate(() => new Promise(resolve => window.setTimeout(resolve, 1100)));
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
    } finally {
      await browser.close();
    }
  });

  it('shares chat theme across YouTube and Twitch and keeps it with visibility and width', { timeout: 120_000 }, async t => {
    const { chromium } = await import('playwright');
    if (!existsSync(chromium.executablePath())) { t.skip('Chromium is not installed'); return; }
    const browser = await chromium.launch({ headless: true });
    const themeOptions = [
      { value: 'light', text: 'Light' },
      { value: 'native', text: 'Service settings' },
      { value: 'dark', text: 'Dark' }
    ];
    try {
      const absent = await openPage(browser, { url: YOUTUBE_WATCH, youtube: youtubeDocument('none') }, { width: 1280, height: 800 });
      await boot(absent.page);
      await absent.page.evaluate(() => new Promise(resolve => window.setTimeout(resolve, 1100)));
      const absentTheme = await readThemeControl(absent.page);
      assert.equal(absentTheme.hidden, true, JSON.stringify(absentTheme));
      assert.equal(absentTheme.disabled, true, JSON.stringify(absentTheme));
      assert.deepEqual(pageErrors(absent.page), []);
      await absent.page.close();

      const seeded = {
        nativeChatPreferences: {
          youtube: { visible: true, width: 400, theme: 'sepia' },
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
      assert.equal(theme.label, 'Chat theme', JSON.stringify(theme));
      assert.equal(theme.text, 'Chat theme', JSON.stringify(theme));
      assert.equal(theme.value, 'native', JSON.stringify(theme));
      assert.equal(theme.hidden, false, JSON.stringify(theme));
      assert.equal(theme.disabled, false, JSON.stringify(theme));
      assert.equal(theme.inSettings, true, JSON.stringify(theme));
      assert.deepEqual(read().nativeChatPreferences, seeded.nativeChatPreferences);

      await page.goto(YOUTUBE_WATCH, { waitUntil: 'load' });
      await boot(page);
      await page.waitForFunction(() => document.querySelector('[data-theater-chat]'));
      theme = await readThemeControl(page);
      assert.equal(theme.value, 'native', JSON.stringify(theme));
      assert.equal(theme.hidden, false, JSON.stringify(theme));
      assert.equal(theme.disabled, false, JSON.stringify(theme));
      assert.deepEqual(theme.options, themeOptions, JSON.stringify(theme));
      assert.deepEqual(read().nativeChatPreferences, seeded.nativeChatPreferences);
      let layout = await layoutOf(page);
      assert.equal(layout.state?.width, 400, JSON.stringify(layout.state));
      assert.equal(layout.state?.visible, true, JSON.stringify(layout.state));

      await chooseChatTheme(page, 'light');
      await expectSavedTheme(read, 'youtube', { visible: true, width: 400, theme: 'light' });
      await expectAppliedTheme(page, 'light');
      await chooseChatTheme(page, 'dark');
      await expectSavedTheme(read, 'youtube', { visible: true, width: 400, theme: 'dark' });
      await expectAppliedTheme(page, 'dark');
      await chooseChatTheme(page, 'native');
      await expectSavedTheme(read, 'youtube', { visible: true, width: 400, theme: 'native' });
      await expectAppliedTheme(page, 'native');

      await page.locator('.theater-chat-toggle').click();
      await page.waitForFunction(() => document.querySelector('[data-theater-chat-hidden]'));
      theme = await readThemeControl(page);
      assert.equal(theme.hidden, false, JSON.stringify(theme));
      assert.equal(theme.disabled, false, JSON.stringify(theme));
      assert.equal(theme.value, 'native', JSON.stringify(theme));
      await chooseChatTheme(page, 'dark');
      await expectSavedTheme(read, 'youtube', { visible: false, width: 400, theme: 'dark' });
      await expectAppliedTheme(page, 'dark');
      await chooseChatTheme(page, 'native');
      await expectSavedTheme(read, 'youtube', { visible: false, width: 400, theme: 'native' });
      await expectAppliedTheme(page, 'native');
      await chooseChatTheme(page, 'dark');
      await expectSavedTheme(read, 'youtube', { visible: false, width: 400, theme: 'dark' });
      await expectAppliedTheme(page, 'dark');
      theme = await readThemeControl(page);
      assert.equal(theme.hidden, false, JSON.stringify(theme));
      assert.equal(theme.disabled, false, JSON.stringify(theme));
      const savedWhileHidden = read().nativeChatPreferences as Record<string, { visible: boolean; width: number; theme: string }>;
      assert.deepEqual(Object.keys(savedWhileHidden.youtube).sort(), ['theme', 'visible', 'width']);
      assert.deepEqual(savedWhileHidden.twitch, { visible: true, width: 380, theme: 'native' });

      await closeChatSettings(page);
      await page.setViewportSize({ width: 800, height: 720 });
      await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.dock === 'bottom');
      layout = await layoutOf(page);
      assert.equal(layout.widthRowHidden, true, JSON.stringify(layout));
      theme = await readThemeControl(page);
      assert.equal(theme.hidden, false, JSON.stringify(theme));
      assert.equal(theme.disabled, false, JSON.stringify(theme));
      assert.equal(theme.value, 'dark', JSON.stringify(theme));
      await page.locator('.theater-chat-toggle').click();
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-chat-visible'));
      layout = await layoutOf(page);
      assertBottomDock(layout, 'youtube theme on bottom dock');
      theme = await readThemeControl(page);
      assert.equal(theme.hidden, false, JSON.stringify(theme));
      assert.equal(theme.value, 'dark', JSON.stringify(theme));
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.waitForFunction(() => window.NativeChatTest.nativeChatState()?.dock === 'right');
      layout = await layoutOf(page);
      assert.equal(layout.state?.theme, 'dark', JSON.stringify(layout.state));
      assertRightDock(layout, 'youtube theme restored to the right dock');
      await expectSavedTheme(read, 'youtube', { visible: true, width: 400, theme: 'dark' });

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
      assert.deepEqual(separated.youtube, { visible: true, width: 400, theme: 'dark' });
      assert.deepEqual(Object.keys(separated.twitch).sort(), ['theme', 'visible', 'width']);

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
      assert.equal(theme.value, 'dark', JSON.stringify(theme));
      await expectAppliedTheme(page, 'dark');
      layout = await layoutOf(page);
      assert.equal(layout.state?.visible, true, JSON.stringify(layout.state));
      assert.equal(layout.state?.width, 400, JSON.stringify(layout.state));
      assert.deepEqual(pageErrors(page), []);
    } finally {
      await browser.close();
    }
  });
});
