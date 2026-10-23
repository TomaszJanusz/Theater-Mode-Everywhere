import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decide, failureDetail, issueTitle } from '../live-e2e/alert';
import { redactorFor } from '../live-e2e/redact';

import { committedFixture } from './committed';
import { compareSignatures, driftLine } from './drift';
import type { Signature } from './format';

const recorded = committedFixture('twitch-chat-expanded').signature;

describe('compareSignatures', () => {
  it('reports nothing for the recorded structure', () => assert.deepEqual(compareSignatures(recorded, structuredClone(recorded)), []));

  it('reports every changed probe field of a deliberately altered snapshot', () => {
    // The host widens its column, translates nothing and drops the collapse toggle.
    const live: Signature = structuredClone(recorded);
    live.column.rendered = true;
    live.toggle = { count: 0, rendered: false, transformed: false, within: [] };
    delete live.video;
    assert.deepEqual(compareSignatures(recorded, live), [
      'column.rendered: recorded false, live true',
      'toggle.count: recorded 1, live 0',
      'toggle.rendered: recorded true, live false',
      'toggle.within: recorded [column], live []',
      'video.count: recorded 1, live missing probe',
      'video.rendered: recorded true, live missing probe',
      'video.transformed: recorded false, live missing probe',
      'video.within: recorded [], live missing probe'
    ]);
  });
});

describe('drift reporting', () => {
  it('labels drift and keeps private targets out of the line', () => {
    const redact = redactorFor([{ pageType: 'live-chat', url: 'https://www.twitch.tv/privatechannel' }]);
    const line = redact(driftLine({ fixture: 'twitch-chat-expanded', status: 'failed', detail: 'page never settled: timeout at https://www.twitch.tv/privatechannel' }));
    assert.equal(line, 'DRIFT twitch-chat-expanded - page never settled: timeout at <live-chat>');
  });

  it('opens a Host drift issue that says to refresh the recording first, separate from the page type issue', () => {
    const [create] = decide({ pageType: 'twitch-chat-expanded', status: 'failed', runUrl: 'https://ci/run/1', detail: '- column.rendered: recorded false, live true', kind: 'drift' }, undefined);
    assert.equal(create.type === 'create' && create.title, 'Host drift: twitch-chat-expanded');
    assert.match(create.type === 'create' ? create.body : '', /Refresh the recording first.*then fix the provider/);
    assert.notEqual(issueTitle('live-chat', 'drift'), issueTitle('live-chat'));
    assert.deepEqual(decide({ pageType: 'twitch-chat-expanded', status: 'skipped', runUrl: 'https://ci/run/1', detail: '', kind: 'drift' }, undefined), []);
    assert.equal(failureDetail([{ capability: 'theater', status: 'failed', detail: 'at https://x.test/a' }]), '- theater: at <url>');
  });
});
