import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { chromium } from 'playwright';

import { bootPlayer } from '../../src/test-utils/player-boot';
import { sharedTestBrowser } from '../../src/test-utils/test-browser';
import { canvasVideoFixture } from '../../src/test-utils/video-fixtures';

import type { Target } from './model';
import { runTarget } from './test-utils/runner';

// The harness against a local fixture server: generic pages standing in for third-party
// hosts, with the player injected where the nightly lane has the installed extension.
const player = canvasVideoFixture({ title: 'Live E2E fixture' });
const withOverlay = (text: string, extra = ''): string => player.replace('<video', `<p>${text}</p>${extra}<video`);
const pages: Record<string, { status?: number; body: string }> = {
  '/player': { body: player },
  '/consent': { body: withOverlay('Before you continue, accept all cookies') },
  '/captcha': { body: withOverlay('Checking', '<iframe src="/captcha-frame"></iframe>') },
  '/bot': { body: withOverlay("Sign in to confirm you're not a bot") },
  '/geo': { status: 451, body: withOverlay('Unavailable') },
  '/ad': { body: player.replace('<video', '<video class="ad-showing"') }
};

let server: Server;
let origin = '';
const target = (path: string, capabilities: Target['capabilities'] = ['theater', 'active-video']): Target => ({ pageType: `fixture${path.replace('/', '-')}`, url: `${origin}${path}`, capabilities, videoSelector: 'video' });

before(async () => {
  server = createServer((req, res) => {
    const page = pages[req.url ?? ''];
    res.writeHead(page?.status ?? (page ? 200 : 404), { 'content-type': 'text/html' }).end(page?.body ?? '');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>(resolve => server.close(() => resolve())));

describe('live E2E harness on local fixtures', () => {
  const shared = sharedTestBrowser(chromium);

  it('passes every capability on a generic player page', async t => {
    const context = await shared.newContext(t);
    const page = await context.newPage();
    const results = await runTarget(page, target('/player'), { afterNavigate: p => bootPlayer(p) });
    assert.deepEqual(results.map(r => [r.capability, r.status, r.detail]), [['theater', 'passed', undefined], ['active-video', 'passed', undefined]]);
  });

  it('fails when the extension does not respond on a clean page', async t => {
    const context = await shared.newContext(t);
    const page = await context.newPage();
    const [first] = await runTarget(page, target('/player', ['theater']));
    assert.equal(first.status, 'failed');
  });

  for (const [path, reason] of [['/consent', 'consent wall'], ['/captcha', 'captcha'], ['/bot', 'bot check'], ['/geo', 'geo block'], ['/ad', 'ad break']] as const) {
    it(`reports ${reason} as skipped, not failed`, async t => {
      const context = await shared.newContext(t);
      const page = await context.newPage();
      let booted = false;
      const results = await runTarget(page, target(path), { afterNavigate: async p => { booted = true; await bootPlayer(p); } });
      assert.ok(booted);
      assert.deepEqual([...new Set(results.map(r => r.status))], ['skipped']);
      assert.match(results[0].detail ?? '', new RegExp(`environment: ${reason}`));
    });
  }

  it('reports an unreachable page as skipped', async t => {
    const context = await shared.newContext(t);
    const page = await context.newPage();
    const results = await runTarget(page, { ...target('/player'), url: 'http://127.0.0.1:1/' });
    assert.equal(results[0].status, 'skipped');
  });

  it('skips a quarantined page type without navigating', async t => {
    const context = await shared.newContext(t);
    const page = await context.newPage();
    const results = await runTarget(page, target('/player'), { quarantine: [{ pageType: 'fixture-player', owner: 'maintainer', expires: '2099-01-01', reason: 'flaky' }] });
    assert.equal(results[0].status, 'skipped');
    assert.equal(page.url(), 'about:blank');
  });
});
