import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

import { chromium, firefox } from 'playwright';

import { sharedTestBrowser } from '../../src/test-utils/test-browser';
import { selectTestEngines } from '../../src/test-utils/test-engines';

import { fixtureServer, runFixture } from './resource-browser';
import { FIXTURES } from './resource-model';
import { RESOURCE_PROBE, validateCounters } from './resource-probe';
import { identifyBuild } from './storage';
const shared = new Map(selectTestEngines([chromium, firefox], engine => engine.name()).map(engine => [engine, sharedTestBrowser(engine)] as const));
const directory = process.env.RESOURCE_AUDIT_BUILD ?? path.resolve(import.meta.dirname, '../../dist/chrome-unpacked');
for (const engine of selectTestEngines([chromium, firefox], engine => engine.name())) it(`resource fixture smoke: ${engine.name()} executes every scenario on built bundles`, {
  timeout: 180000, skip: (!process.env.RESOURCE_AUDIT_BUILD && !existsSync(path.join(directory, 'content.js'))) || !existsSync(engine.executablePath())
}, async t => {
  // runFixture opens its own contexts, so it takes the shared Browser behind the test's context.
  const context = await shared.get(engine)!.newContext(t); const browser = context.browser()!;
  const server = await fixtureServer(); t.after(() => server.close());
  const build = identifyBuild('smoke', directory);
  for (const fixture of FIXTURES) {
    const row = await runFixture(browser, build, fixture, server.origin, 20, 1);
    assert.equal(row.accepted, true, `${fixture}: ${row.reason}`);
    assert.ok(row.phases.length > 0);
    if (fixture === 'chat-hidden') {
      const steady = row.phases.find(p => p.name === 'steady-4s');
      const toggled = row.phases.find(p => p.name === 'show-hide');
      assert.ok(steady);
      assert.ok(toggled);
      assert.equal(steady.input.chatHidden, true, 'native-hidden chat starts hidden despite the saved open preference');
      assert.equal(steady.state.chatHidden, true, 'chat stays hidden during steady state');
      assert.equal(steady.delta.setInterval ?? 0, 0, 'hidden chat schedules no additional interval during steady state');
      assert.equal(toggled.state.chatHidden, true, 'toggle round trip returns to hidden');
    }
    if (fixture === 'generic-mousemove') assert.equal(row.phases.at(-1)!.delta.setIntervalCallbacks ?? 0, 0, 'mousemove is measured without clock advancement');
    if (fixture === 'chat-portals') assert.equal(row.phases.filter(p => p.name.startsWith('portal-')).length, 20);
  }
});
for (const engine of selectTestEngines([chromium, firefox], engine => engine.name())) it(`resource instrumentation ${engine.name()}: idempotent observers, scheduler cancellation and body accounting`, {
  timeout: 15000, skip: !existsSync(engine.executablePath())
}, async t => {
  const page = await (await shared.get(engine)!.newContext(t)).newPage();
  const start = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({time:start}); await page.clock.pauseAt(new Date(start.getTime() + 60000));
  await page.evaluate(RESOURCE_PROBE);
  await page.evaluate(`(() => {
    const observer=new MutationObserver(()=>{});observer.observe(document,{childList:true});observer.observe(document.body,{childList:true});observer.disconnect();observer.disconnect();
    const timeout=setTimeout(()=>{throw Error('cancel failed')},10);clearInterval(timeout);
    const interval=setInterval(()=>{throw Error('cancel failed')},10);clearTimeout(interval);
    const frame=requestAnimationFrame(()=>{throw Error('cancel failed')});cancelAnimationFrame(frame);
  })()`);
  await page.clock.runFor(100);
  await page.evaluate(`(async()=>{const response=new Response('hello');await response.clone().text();await response.arrayBuffer();await window.__resourceProbe.idle();})()`);
  const result: unknown = await page.evaluate('window.__resourceProbe.snapshot()'); validateCounters(result);
  assert.deepEqual(result.active, {observers:0,timeouts:0,intervals:0,raf:0,pendingReads:0});
  assert.equal(result.totals.responseClone,1);assert.equal(result.totals.bodyBytes,5);assert.equal(result.totals.bodyCharacters,5);
});
