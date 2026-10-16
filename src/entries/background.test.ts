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
          async set(next: object) { Object.assign(values, next); }
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
  assert.equal(replied, false);
  const request = (operation: string) => new Promise<unknown>(resolve => {
    assert.equal(listener({ action: 'feature-highlights', operation }, { id: 'extension' }, resolve), true);
  });
  const snapshot = await request('read') as Record<string, unknown>;
  assert.equal(snapshot.newFeaturesSeenThrough, PREVIOUS_GENERATION);
  assert.equal((snapshot.newFeaturesWindow as { generation: string }).generation, CURRENT_GENERATION);
  await request('acknowledge');
  assert.equal(values.newFeaturesSeenThrough, CURRENT_GENERATION);
});
