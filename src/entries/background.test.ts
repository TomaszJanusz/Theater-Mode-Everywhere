import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { it } from 'node:test';
import { MAX_CAPTION_BYTES } from '../platform/media-url-policy';
import { CURRENT_VERSION, CURRENT_GENERATION, PREVIOUS_GENERATION } from '../test-utils/release';
import { WHATS_NEW_RELEASE } from '../whatsNew-release';

const require = createRequire(import.meta.url);
const esbuild = require(createRequire(require.resolve('vite')).resolve('esbuild')) as {
  buildSync(options: Record<string, unknown>): { outputFiles: Array<{ text: string }> };
};
const bundle = esbuild.buildSync({ entryPoints: [path.resolve(new URL('./background.ts', import.meta.url).pathname)],
  bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022' }).outputFiles[0].text;
const url = 'https://captions.twitch.tv/123/en/caption.vtt';
type Reply = { ok: boolean; body?: string; error?: string };

function broker(fetcher: typeof fetch): () => Promise<Reply> {
  let listener!: (message: { action: string; url: string }, sender: object, reply: (value: Reply) => void) => boolean;
  const ignore = { addListener() {} };
  runInNewContext(bundle, {
    fetch: fetcher, URL, AbortController, TextDecoder, Uint8Array, setTimeout, clearTimeout, console,
    chrome: {
      tabs: { onActivated: ignore, onUpdated: ignore }, storage: { onChanged: ignore },
      runtime: { getManifest: () => ({ version: CURRENT_VERSION }), onInstalled: ignore, onMessage: { addListener(fn: typeof listener) { listener = fn; } } }
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


it('initializes fresh installs at the installed generation and preserves update acknowledgements', async () => {
  for (const reason of ['install', 'update']) {
    let onInstalled!: (details: { reason: string; previousVersion?: string }) => Promise<void>;
    const local: Record<string, unknown> = { newFeaturesSeenThrough: PREVIOUS_GENERATION, whatsNewAcknowledgedId: WHATS_NEW_RELEASE.id };
    const ignore = { addListener() {} };
    runInNewContext(bundle, {
      console,
      chrome: {
        tabs: { onActivated: ignore, onUpdated: ignore },
        storage: {
          onChanged: ignore,
          sync: { async get() { return { shortcuts: {}, blacklist: [] }; } },
          local: { async get() { return { ...local }; }, async set(values: object) { Object.assign(local, values); }, async remove(keys: string[]) { keys.forEach(key => delete local[key]); } }
        },
        runtime: {
          getManifest: () => ({ version: CURRENT_VERSION }),
          onInstalled: { addListener(listener: typeof onInstalled) { onInstalled = listener; } },
          onMessage: ignore
        }
      }
    });
    await onInstalled({ reason, previousVersion: reason === 'update' ? `${PREVIOUS_GENERATION}.0` : undefined });
    assert.equal(local.newFeaturesSeenThrough, reason === 'install' ? CURRENT_GENERATION : PREVIOUS_GENERATION);
  }
});

it('routes badge hydration and acknowledgements through the background and rejects foreign/invalid requests', async () => {
  let listener!: (message: object, sender: object, reply: (value: unknown) => void) => boolean;
  const values: Record<string, unknown> = { newFeaturesSeenThrough: PREVIOUS_GENERATION };
  const ignore = { addListener() {} };
  runInNewContext(bundle, {
    console,
    chrome: {
      tabs: { onActivated: ignore, onUpdated: ignore },
      storage: {
        onChanged: ignore,
        local: {
          async get() { return { ...values }; },
          async set(next: object) { Object.assign(values, next); },
          async remove(keys: string[]) { keys.forEach(key => delete values[key]); }
        }
      },
      runtime: {
        id: 'extension', getManifest: () => ({ version: CURRENT_VERSION }), onInstalled: ignore,
        onMessage: { addListener(fn: typeof listener) { listener = fn; } }
      }
    }
  });
  let replied = false;
  assert.equal(listener({ action: 'feature-highlights', operation: 'read' }, { id: 'foreign' }, () => { replied = true; }), false);
  assert.equal(listener({ action: 'feature-highlights', operation: 'erase' }, { id: 'extension' }, () => { replied = true; }), false);
  assert.equal(listener({ action: 'feature-highlights', operation: 'toString' }, { id: 'extension' }, () => { replied = true; }), false);
  assert.equal(replied, false);
  const request = (operation: string) => new Promise<unknown>(resolve => {
    assert.equal(listener({ action: 'feature-highlights', operation }, { id: 'extension' }, resolve), true);
  });
  const snapshot = await request('read') as Record<string, unknown>;
  assert.equal(snapshot.newFeaturesSeenThrough, PREVIOUS_GENERATION);
  assert.equal((snapshot.newFeaturesWindow as { generation: string }).generation, CURRENT_GENERATION);
  await request('acknowledge');
  assert.equal(values.newFeaturesSeenThrough, CURRENT_GENERATION);
  await request('hide');
  assert.equal(values.newFeaturesHiddenThrough, CURRENT_GENERATION);
  await request('restore');
  assert.equal('newFeaturesHiddenThrough' in values, false);
});

it('opens only the manifest options page for valid requests from this extension', async () => {
  let listener!: (message: unknown, sender: object, reply: (value: unknown) => void) => boolean;
  let opened = 0;
  let fail = false;
  const ignore = { addListener() {} };
  runInNewContext(bundle, {
    console: { error() {} },
    chrome: {
      tabs: { onActivated: ignore, onUpdated: ignore }, storage: { onChanged: ignore },
      runtime: {
        id: 'extension', getManifest: () => ({ version: CURRENT_VERSION }), onInstalled: ignore,
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
  const ignore = { addListener() {} };
  runInNewContext(bundle, {
    console: { error() {} },
    chrome: {
      tabs: {
        onActivated: ignore, onUpdated: ignore,
        async query() { return tabs; },
        async create(options: object) { calls.push(['create', options]); tabs.push({ id: 9, windowId: 2, url: page }); },
        async update(id: number, options: object) { calls.push(['update', id, options]); }
      },
      windows: { async update(id: number, options: object) { calls.push(['focus', id, options]); } },
      storage: { onChanged: ignore },
      runtime: {
        id: 'extension', onInstalled: ignore, getURL: (file: string) => `chrome-extension://extension/${file}`,
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
  const ignore = { addListener() {} };
  runInNewContext(bundle, {
    console: { error() {} },
    chrome: {
      tabs: {
        onActivated: ignore, onUpdated: ignore,
        async query() { await Promise.resolve(); return tabs.slice(); },
        async create(options: object) { await Promise.resolve(); calls.push(['create', options]); tabs.push({ id: tabs.length + 1, windowId: 1, url: page }); },
        async update(id: number, options: object) { calls.push(['update', id, options]); if (closedSincePing) throw new Error('No tab with id'); }
      },
      windows: { async update(id: number, options: object) { calls.push(['focus', id, options]); } },
      storage: { onChanged: ignore },
      runtime: {
        id: 'extension', onInstalled: ignore, getURL: (file: string) => `chrome-extension://extension/${file}`,
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
