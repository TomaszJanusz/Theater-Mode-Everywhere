import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Page } from 'playwright';

import { decide, failureDetail, issueTitle, type ExistingIssue } from './alert';
import { classifyPage, type PageSignals } from './classify';
import { parseQuarantine, parseTargets, splitQuarantine } from './config';
import { overall, runWithRetries } from './lane';
import type { SpecResult, Target } from './model';
import { maskValues, redactorFor, scrubUrls } from './redact';
import { logLine, serializeResults } from './report';
import { runTarget } from './test-utils/runner';

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
    assert.throws(() => parseTargets('[{"pageType":"lane","url":"https://x.test"}]'), /reserved/);
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
    const out = await runWithRetries(async n => { calls++; return { results: [result(n === 1 ? 'failed' : 'passed')] }; }, 1);
    assert.equal(calls, 2);
    assert.equal(out.results[0].detail, 'passed on retry');
  });
  it('stops after the retry when it fails twice', async () => {
    let calls = 0;
    const out = await runWithRetries(async () => { calls++; return { results: [result('failed')] }; }, 1);
    assert.equal(calls, 2);
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

describe('private targets stay out of public output', () => {
  const target: Target = { pageType: 'alpha', url: 'https://videos.private-host.test/watch?v=SECRET123', capabilities: ['theater'], videoSelector: 'video' };
  const leaks = (text: string): boolean => /private-host|SECRET123/i.test(text);
  const failingPage = (message: string): Page => ({ goto: () => Promise.reject(new Error(message)) }) as unknown as Page;

  it('redacts the URL, host and path from every spelling an error can use', () => {
    const redact = redactorFor([target]);
    for (const message of [
      `page.goto: net::ERR_NAME_NOT_RESOLVED at ${target.url}`,
      'getaddrinfo ENOTFOUND videos.private-host.test',
      'waiting for https://VIDEOS.private-host.test/watch?v=secret123 failed',
      'redirected to https://elsewhere.test/login?next=/watch%3Fv%3DSECRET123'
    ]) assert.equal(leaks(redact(message)), false, message);
    assert.match(redact(`at ${target.url}`), /at <alpha>/);
    assert.equal(scrubUrls('see https://a.test/x?y=1 and http://b.test'), 'see <url> and <url>');
  });

  it('masks the URL, origin and host before output', () => {
    const values = maskValues([target]);
    for (const expected of [target.url, 'https://videos.private-host.test', 'videos.private-host.test']) assert.ok(values.includes(expected), expected);
  });

  it('keeps a navigation error out of the results, the log, results.json and the issue', async () => {
    const results = await runTarget(failingPage(`page.goto: net::ERR_NAME_NOT_RESOLVED at ${target.url}\nCall log: navigating to "${target.url}"`), target);
    assert.equal(results[0].status, 'skipped');
    assert.equal(leaks(JSON.stringify(results)), false);

    const redact = redactorFor([target]);
    const failed: SpecResult = { pageType: 'alpha', capability: 'theater', status: 'failed', detail: `locator timed out at ${target.url}` };
    // A raw, unredacted failure still cannot reach the uploaded file or the log.
    assert.equal(leaks(logLine('alpha', failed, redact)), false);
    const json = serializeResults('2026-01-01', [{ pageType: 'alpha', status: 'failed', attempts: 2, results: [failed] }], redact);
    assert.equal(leaks(json), false);
    assert.match(json, /<alpha>/);

    // The issue job has no target list; it strips URLs on its own.
    const detail = failureDetail([failed]);
    assert.equal(leaks(detail), false);
    const [create] = decide({ pageType: 'alpha', status: 'failed', runUrl: 'https://ci/run/1', detail }, undefined);
    assert.equal(create.type === 'create' && leaks(create.body), false);
  });
});
