import assert from 'node:assert/strict';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';

import { MAX_CAPTION_BYTES } from '../platform/media-url-policy';
import { bundleModules } from '../test-utils/player-boot';

const bundle = bundleModules(["import './entries/background';"], 'BackgroundTest');
const CURRENT_VERSION = '2.1.0';
const ignore = { addListener() {} };
/** Start-up surface for tests about other messages: no announcement is stored. */
const quiet = { action: { async setBadgeText() {} } };
const noAnnouncement = { async get() { return {}; } };
const url = 'https://captions.twitch.tv/123/en/caption.vtt';
type Reply = { ok: boolean; body?: string; error?: string };

function broker(fetcher: typeof fetch): () => Promise<Reply> {
  let listener!: (message: { action: string; url: string }, sender: object, reply: (value: Reply) => void) => boolean;
  runInNewContext(bundle, {
    fetch: fetcher, URL, AbortController, TextDecoder, Uint8Array, setTimeout, clearTimeout, console,
    chrome: {
      ...quiet,
      tabs: { onActivated: ignore, onUpdated: ignore }, storage: { onChanged: ignore, local: noAnnouncement },
      runtime: { getManifest: () => ({ version: CURRENT_VERSION }), onInstalled: ignore, onStartup: ignore, onMessage: { addListener(fn: typeof listener) { listener = fn; } } }
    }
  });
  return () => new Promise(resolve => assert.equal(listener({ action: 'theater-fetch-media', url }, {}, resolve), true));
}

it('background broker bounds lying/missing Content-Length before decoding', async () => {
  for (const length of [null, '1']) {
    let pulled = 0, cancelled = 0;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) { pulled++; controller.enqueue(new Uint8Array(MAX_CAPTION_BYTES + 1)); },
      cancel() { cancelled++; }
    }, { highWaterMark: 0 }), { headers: length === null ? {} : { 'content-length': length } });
    Object.defineProperty(response, 'url', { value: url });
    const request = broker(async () => response);
    const result = await request();
    assert.equal(result.ok, false);
    assert.equal(result.error, 'too-large');
    assert.equal(pulled, 1);
    assert.equal(cancelled, 1);
  }
});

it('background broker accepts captions after safe redirects and cancels unsafe redirects', async () => {
  const body = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello';
  const response = new Response(body, { headers: { 'content-type': 'text/vtt' } });
  Object.defineProperty(response, 'url', { value: url + '?redirected=true' });
  const result = await broker(async () => response)();
  assert.equal(result.ok, true);
  assert.equal(result.body, body);
  let cancelled = false;
  const blocked = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  Object.defineProperty(blocked, 'url', { value: 'https://untrusted.example/captions.vtt' });
  const rejected = await broker(async () => blocked)();
  assert.equal(rejected.error, 'redirect-blocked');
  assert.equal(cancelled, true);
});


type Details = { reason: string; previousVersion?: string };
type Listener = (message: unknown, sender: object, reply: (value: unknown) => void) => boolean;

/** The background over an in-memory profile: storage notifies `onChanged` like the browser, the badge records its text. */
function profile(version: string, local: Record<string, unknown> = {}, sync: Record<string, unknown> = {}) {
  const storageListeners: Array<(changes: object, area: string) => void> = [];
  const badge = { text: '', color: '' };
  const badgeWaiters: Array<() => void> = [];
  /** The next badge write, such as the one each worker start makes from storage. */
  const nextBadge = () => new Promise<void>(resolve => { badgeWaiters.push(resolve); });
  const started = nextBadge();
  const opened: string[] = [];
  const handlers: { installed?: (details: Details) => Promise<void>; startup?: () => void; message?: Listener } = {};
  const area = (name: string, data: Record<string, unknown>) => ({
    async get(keys: string | string[] | null) {
      if (keys === null) return { ...data };
      return Object.fromEntries([keys].flat().filter(key => key in data).map(key => [key, data[key]]));
    },
    async set(values: Record<string, unknown>) {
      const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { oldValue: data[key], newValue }]));
      Object.assign(data, values);
      for (const listener of storageListeners) listener(changes, name);
    },
    async remove(keys: string | string[]) {
      const changes: Record<string, object> = {};
      for (const key of [keys].flat()) if (key in data) { changes[key] = { oldValue: data[key] }; delete data[key]; }
      if (Object.keys(changes).length) for (const listener of storageListeners) listener(changes, name);
    }
  });
  runInNewContext(bundle, {
    console,
    chrome: {
      action: {
        async setBadgeText({ text }: { text: string }) { badge.text = text; badgeWaiters.splice(0).forEach(resolve => resolve()); },
        async setBadgeBackgroundColor({ color }: { color: string }) { badge.color = color; }
      },
      tabs: { onActivated: ignore, onUpdated: ignore, async query() { return []; }, async create({ url }: { url: string }) { opened.push(url); } },
      storage: {
        onChanged: { addListener(listener: (changes: object, area: string) => void) { storageListeners.push(listener); } },
        local: area('local', local), sync: area('sync', sync)
      },
      runtime: {
        id: 'extension', getURL: (file: string) => `chrome-extension://extension/${file}`,
        getManifest: () => ({ version, options_ui: { page: 'options/options.html' } }),
        async openOptionsPage() { opened.push('options'); },
        onInstalled: { addListener(fn: typeof handlers.installed) { handlers.installed = fn; } },
        onStartup: { addListener(fn: typeof handlers.startup) { handlers.startup = fn; } },
        onMessage: { addListener(fn: Listener) { handlers.message = fn; } }
      }
    }
  });
  return {
    local, sync, badge, opened, started,
    // Storage notifies synchronously here, so the badge follows before each handler settles.
    installed: (details: Details) => handlers.installed!(details),
    startup: async () => { const written = nextBadge(); handlers.startup!(); await written; },
    send: (message: object, sender: object = { id: 'extension' }) => new Promise<unknown>(resolve => {
      assert.equal(handlers.message!(message, sender, resolve), true);
    }),
    refuse: (message: object, sender: object) => handlers.message!(message, sender, () => assert.fail('replied'))
  };
}

it('announces an update to a newer minor or major version with a NEW badge, and never opens Settings', async () => {
  const update = profile('2.1.0');
  await update.started;
  await update.installed({ reason: 'update', previousVersion: '2.0.8' });
  assert.deepEqual(JSON.parse(JSON.stringify(update.local.pendingUpdate)), { version: '2.1.0', since: '2.0' });
  assert.deepEqual({ ...update.badge }, { text: 'NEW', color: '#facc15' });
  assert.deepEqual(update.opened, []);
  // Patch updates, reloads of the same build and installs stay silent; install still writes the default shortcuts.
  for (const [version, details] of [['2.1.1', { reason: 'update', previousVersion: '2.1.0' }], ['2.1.0', { reason: 'update', previousVersion: '2.1.0' }],
    ['2.1.0', { reason: 'install' }], ['0.26.1231.2359', { reason: 'update', previousVersion: '2.0.8' }]] as const) {
    const silent = profile(version);
    await silent.started;
    await silent.installed(details);
    assert.equal('pendingUpdate' in silent.local, false, `${version} after ${JSON.stringify(details)}`);
    assert.equal(silent.badge.text, '');
    assert.deepEqual(silent.opened, []);
    if (details.reason === 'install') assert.equal((silent.sync.shortcuts as { toggle: string }).toggle, 'T');
  }
});

it('restores the badge from the stored announcement when the worker starts and at browser start-up', async () => {
  const pending = { version: '2.1.0', since: '2.0' };
  const woken = profile('2.1.0', { pendingUpdate: pending });
  await woken.started;
  assert.equal(woken.badge.text, 'NEW');
  // Browsers drop badge text on restart; onStartup applies it again.
  woken.badge.text = '';
  await woken.startup();
  assert.equal(woken.badge.text, 'NEW');
  const idle = profile('2.1.0', { pendingUpdate: { version: 'corrupt' } });
  await idle.startup();
  assert.equal(idle.badge.text, '');
});

it('clears the announcement and the badge for an acknowledgement from this extension only', async () => {
  const update = profile('2.1.0', { pendingUpdate: { version: '2.1.0', since: '2.0' } });
  await update.started;
  assert.equal(update.refuse({ action: 'acknowledge-update' }, { id: 'foreign' }), false);
  assert.equal(update.refuse({ action: 'acknowledge-update' }, {}), false);
  assert.equal(update.badge.text, 'NEW');
  assert.equal((await update.send({ action: 'acknowledge-update' }) as { ok: boolean }).ok, true);
  assert.equal('pendingUpdate' in update.local, false);
  assert.equal(update.badge.text, '');
});

it('keeps the oldest unacknowledged version across updates, so skipped highlights add up', async () => {
  const update = profile('2.3.0', { pendingUpdate: { version: '2.1.0', since: '2.0' } });
  await update.started;
  await update.installed({ reason: 'update', previousVersion: '2.1.0' });
  assert.deepEqual(JSON.parse(JSON.stringify(update.local.pendingUpdate)), { version: '2.3.0', since: '2.0' });
});

it('removes the NEW badge and automatic prompt storage on update, leaving other keys', async () => {
  const local = {
    newFeaturesSeenThrough: '2.0', newFeaturesSeenItems: [], newFeaturesWindow: {}, newFeaturesHiddenThrough: '2.0',
    whatsNewAcknowledgedId: '2.0', whatsNewAutoOpened: {}, 'migration:bound-whats-new-auto-open:v1': true,
    'whatsNewAutoOpenedRelease:2.0:2.0.0': true, unrelated: 1
  };
  const sync = { highlightNewFeatures: false, blacklist: [] };
  const update = profile('2.0.9', local, sync);
  await update.started;
  await update.installed({ reason: 'update', previousVersion: '2.0.8' });
  assert.deepEqual(Object.keys(update.local), ['unrelated', 'migration:remove-legacy-youtube-exclusion:v1']);
  assert.deepEqual(Object.keys(update.sync), ['blacklist']);
});

it('opens only the manifest options page for valid requests from this extension', async () => {
  let listener!: (message: unknown, sender: object, reply: (value: unknown) => void) => boolean;
  let opened = 0;
  let fail = false;
  runInNewContext(bundle, {
    console: { error() {} },
    chrome: {
      ...quiet,
      tabs: { onActivated: ignore, onUpdated: ignore }, storage: { onChanged: ignore, local: noAnnouncement },
      runtime: {
        id: 'extension', getManifest: () => ({ version: CURRENT_VERSION }), onInstalled: ignore, onStartup: ignore,
        onMessage: { addListener(fn: typeof listener) { listener = fn; } },
        async openOptionsPage() { opened++; if (fail) throw new Error('unavailable'); }
      }
    }
  });
  const request = { action: 'open-options-page' };
  for (const sender of [{}, { id: 'foreign' }]) {
    assert.equal(listener(request, sender, () => assert.fail('replied to unknown sender')), false);
  }
  for (const payload of [null, {}, { action: 'other' }, { ...request, url: 'https://evil.test' },
    { ...request, hash: '#unknown' }, { ...request, extra: true }, { ...request, section: 'about:blank' },
    { ...request, section: undefined }, { ...request, section: 'shortcuts', url: 'https://evil.test' }]) {
    assert.equal(listener(payload, { id: 'extension' }, () => assert.fail('replied to invalid payload')), false);
  }
  assert.equal(opened, 0);
  const send = (sender: object) => new Promise<unknown>(resolve => {
    assert.equal(listener(request, sender, resolve), true);
  });
  for (const frameId of [0, 4]) {
    const reply = await send({ id: 'extension', tab: { id: 1 }, frameId, url: 'https://player.test/' });
    assert.equal((reply as { ok: boolean }).ok, true);
  }
  fail = true;
  const reply = await send({ id: 'extension' });
  assert.equal((reply as { ok: boolean }).ok, false);
  assert.equal(opened, 3);
});

it('opens Settings at the Shortcuts tab, reusing an open Settings tab', async () => {
  let listener!: (message: unknown, sender: object, reply: (value: unknown) => void) => boolean;
  const page = 'chrome-extension://extension/options/options.html';
  const tabs = [{ id: 3, windowId: 1, url: 'https://player.test/' }];
  const calls: unknown[] = [];
  runInNewContext(bundle, {
    console: { error() {} },
    chrome: {
      ...quiet,
      tabs: {
        onActivated: ignore, onUpdated: ignore,
        async query() { return tabs; },
        async create(options: object) { calls.push(['create', options]); tabs.push({ id: 9, windowId: 2, url: page }); },
        async update(id: number, options: object) { calls.push(['update', id, options]); }
      },
      windows: { async update(id: number, options: object) { calls.push(['focus', id, options]); } },
      storage: { onChanged: ignore, local: noAnnouncement },
      runtime: {
        id: 'extension', onInstalled: ignore, onStartup: ignore, getURL: (file: string) => `chrome-extension://extension/${file}`,
        getManifest: () => ({ version: CURRENT_VERSION, options_ui: { page: 'options/options.html' } }),
        onMessage: { addListener(fn: typeof listener) { listener = fn; } },
        async openOptionsPage() { calls.push(['openOptionsPage']); }
      }
    }
  });
  const send = () => new Promise<unknown>(resolve => {
    assert.equal(listener({ action: 'open-options-page', section: 'shortcuts' }, { id: 'extension' }, resolve), true);
  });
  // Values from the bundle's realm compare by shape.
  for (let request = 0; request < 2; request++) assert.equal((await send() as { ok: boolean }).ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['create', { url: `${page}#shortcuts` }],
    ['update', 9, { url: `${page}#shortcuts`, active: true }],
    ['focus', 2, { focused: true }]
  ]);
});

it('opens one Settings tab for rapid clicks and falls back to a new tab when the open one is gone', async () => {
  let listener!: (message: unknown, sender: object, reply: (value: unknown) => void) => boolean;
  const page = 'chrome-extension://extension/options/options.html';
  const tabs: Array<{ id: number; windowId: number; url: string }> = [];
  const calls: unknown[] = [];
  let closedSincePing = false;
  runInNewContext(bundle, {
    console: { error() {} },
    chrome: {
      ...quiet,
      tabs: {
        onActivated: ignore, onUpdated: ignore,
        async query() { await Promise.resolve(); return tabs.slice(); },
        async create(options: object) { await Promise.resolve(); calls.push(['create', options]); tabs.push({ id: tabs.length + 1, windowId: 1, url: page }); },
        async update(id: number, options: object) { calls.push(['update', id, options]); if (closedSincePing) throw new Error('No tab with id'); }
      },
      windows: { async update(id: number, options: object) { calls.push(['focus', id, options]); } },
      storage: { onChanged: ignore, local: noAnnouncement },
      runtime: {
        id: 'extension', onInstalled: ignore, onStartup: ignore, getURL: (file: string) => `chrome-extension://extension/${file}`,
        getManifest: () => ({ version: CURRENT_VERSION, options_ui: { page: 'options/options.html' } }),
        onMessage: { addListener(fn: typeof listener) { listener = fn; } }
      }
    }
  });
  const send = () => new Promise<{ ok: boolean }>(resolve => {
    assert.equal(listener({ action: 'open-options-page', section: 'shortcuts' }, { id: 'extension' }, resolve as (value: unknown) => void), true);
  });
  // Two clicks before the first request finishes still open a single tab.
  const replies = await Promise.all([send(), send()]);
  assert.deepEqual(replies.map(reply => reply.ok), [true, true]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)).map((call: unknown[]) => call[0]), ['create', 'update', 'focus']);
  // The tab the query found closes before it is updated: the click still lands on a fresh Settings tab.
  calls.length = 0;
  closedSincePing = true;
  assert.equal((await send()).ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)).map((call: unknown[]) => call[0]), ['update', 'create']);
});
