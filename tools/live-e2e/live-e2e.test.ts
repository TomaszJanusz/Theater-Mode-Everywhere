import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decide, issueTitle, type ExistingIssue } from './alert';
import { classifyPage, type PageSignals } from './classify';
import { parseQuarantine, parseTargets, splitQuarantine } from './config';
import { overall, runWithRetries } from './lane';
import type { SpecResult } from './model';

const signals = (over: Partial<PageSignals> = {}): PageSignals => ({ status: 200, text: 'a video page', frameSources: [], adMarker: false, ...over });
const result = (status: SpecResult['status']): SpecResult => ({ pageType: 'p', capability: 'theater', status });

describe('classifyPage', () => {
  it('passes an ordinary page', () => assert.equal(classifyPage(signals()).kind, 'ok'));
  for (const [kind, over] of [
    ['bot-check', { text: "sign in to confirm you're not a bot" }],
    ['captcha', { frameSources: ['https://challenges.example/turnstile/v0/api.js'] }],
    ['captcha', { text: "i'm not a robot" }],
    ['consent-wall', { text: 'before you continue, accept all cookies' }],
    ['geo-block', { text: 'this video is not available in your country' }],
    ['geo-block', { status: 451 }],
    ['ad-break', { adMarker: true }],
    ['ad-break', { text: 'skip ad' }]
  ] as Array<[string, Partial<PageSignals>]>) it(`reports ${kind}`, () => assert.equal(classifyPage(signals(over)).kind, kind));
});

describe('config', () => {
  it('rejects a missing or malformed private target list', () => {
    assert.throws(() => parseTargets(undefined), /empty/);
    assert.throws(() => parseTargets('{'), /JSON/);
    assert.throws(() => parseTargets('[{"pageType":"A b","url":"https://x.test"}]'), /kebab/);
    assert.throws(() => parseTargets('[{"pageType":"a","url":"ftp://x"}]'), /http/);
    assert.throws(() => parseTargets('[{"pageType":"a","url":"https://x.test","capabilities":["nope"]}]'), /capabilities/);
  });
  it('defaults to the theater capability and the first video', () => {
    assert.deepEqual(parseTargets('[{"pageType":"a","url":"https://x.test"}]'), [{ pageType: 'a', url: 'https://x.test', capabilities: ['theater'], videoSelector: 'video' }]);
  });
  it('requires an owner and a valid expiry, and splits expired entries', () => {
    assert.throws(() => parseQuarantine('[{"pageType":"a","expires":"2026-01-01","reason":"r"}]'), /owner/);
    assert.throws(() => parseQuarantine('[{"pageType":"a","owner":"o","expires":"soon","reason":"r"}]'), /YYYY/);
    const entries = parseQuarantine('[{"pageType":"a","owner":"o","expires":"2026-01-01","reason":"r"},{"pageType":"b","owner":"o","expires":"2026-12-31","reason":"r"}]');
    const { active, expired } = splitQuarantine(entries, '2026-06-01');
    assert.deepEqual([active.map(e => e.pageType), expired.map(e => e.pageType)], [['b'], ['a']]);
  });
});

describe('runWithRetries', () => {
  it('retries a failure exactly once and flags a pass on retry', async () => {
    let calls = 0;
    const out = await runWithRetries(async n => { calls++; return { results: [result(n === 1 ? 'failed' : 'passed')], artifacts: n === 1 ? 'a1' : undefined }; }, 1);
    assert.equal(calls, 2);
    assert.deepEqual(out.artifacts, ['a1']);
    assert.equal(out.results[0].detail, 'passed on retry');
  });
  it('stops after the retry and keeps both attempts\' artifacts when it fails twice', async () => {
    let calls = 0;
    const out = await runWithRetries(async n => { calls++; return { results: [result('failed')], artifacts: `a${n}` }; }, 1);
    assert.equal(calls, 2);
    assert.deepEqual(out.artifacts, ['a1', 'a2']);
    assert.equal(overall(out.results), 'failed');
  });
  it('does not retry a skipped environment', async () => {
    let calls = 0;
    const out = await runWithRetries(async () => { calls++; return { results: [result('skipped')] }; }, 1);
    assert.equal(calls, 1);
    assert.equal(overall(out.results), 'skipped');
  });
});

describe('rolling issue', () => {
  const run = 'https://ci/run/1';
  const open = (green: number): ExistingIssue => ({ number: 7, state: 'OPEN', body: `x\n\n<!-- live-e2e-green: ${green} -->` });
  it('creates one issue on the first failure and none while skipped', () => {
    assert.deepEqual(decide({ pageType: 'p', status: 'skipped', runUrl: run, detail: '' }, undefined).length, 0);
    const [create] = decide({ pageType: 'p', status: 'failed', runUrl: run, detail: '- theater: boom' }, undefined);
    assert.equal(create.type === 'create' && create.title, issueTitle('p'));
  });
  it('reopens a closed issue and resets the green count', () => {
    const actions = decide({ pageType: 'p', status: 'failed', runUrl: run, detail: 'd' }, { ...open(2), state: 'CLOSED' });
    assert.deepEqual(actions.map(a => a.type), ['reopen', 'update', 'comment']);
    assert.match(actions[1].type === 'update' ? actions[1].body : '', /green: 0 -->/);
  });
  it('closes only after the third green night, and skipped nights do not count', () => {
    assert.deepEqual(decide({ pageType: 'p', status: 'skipped', runUrl: run, detail: '' }, open(2)).length, 0);
    assert.deepEqual(decide({ pageType: 'p', status: 'passed', runUrl: run, detail: '' }, open(1)).map(a => a.type), ['update', 'comment']);
    assert.deepEqual(decide({ pageType: 'p', status: 'passed', runUrl: run, detail: '' }, open(2)).map(a => a.type), ['comment', 'close']);
    assert.deepEqual(decide({ pageType: 'p', status: 'passed', runUrl: run, detail: '' }, undefined), []);
  });
});
