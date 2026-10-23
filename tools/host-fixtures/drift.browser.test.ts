import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chromium } from 'playwright';

import { sharedTestBrowser } from '../../src/test-utils/test-browser';

import { committedFixture } from './committed';
import type { FixtureNode, HostFixture } from './format';
import { RECIPES } from './recipes';
import { fixtureDocument } from './render';
import { checkDrift } from './test-utils/drift-check';

// The drift check end to end, with a rendered recording standing in for the live host.
const PAGE = 'https://host.test/channel';
const recorded = committedFixture('twitch-chat-expanded');
const recipe = RECIPES[recorded.id];

function altered(fixture: HostFixture, change: (node: FixtureNode) => FixtureNode | null): HostFixture {
  const visit = (node: FixtureNode): FixtureNode | null => {
    const next = change(node);
    return next && { ...next, ...(next.children ? { children: next.children.map(visit).filter((child): child is FixtureNode => child !== null) } : {}) };
  };
  return { ...fixture, dom: visit(structuredClone(fixture.dom)) ?? fixture.dom };
}

describe('host drift check', () => {
  const shared = sharedTestBrowser(chromium);
  const check = async (t: Parameters<typeof shared.newContext>[0], served: string) => {
    const context = await shared.newContext(t, { viewport: recorded.viewport });
    const page = await context.newPage();
    await page.route('https://host.test/**', route => route.fulfill({ contentType: 'text/html', body: served }));
    return checkDrift(page, PAGE, recorded, recipe);
  };

  it('passes when the page matches its recording', async t => {
    assert.deepEqual(await check(t, fixtureDocument(recorded)), { fixture: recorded.id, status: 'passed' });
  });

  it('reports drift for a deliberately altered snapshot', async t => {
    // The host gives the column its own width and removes the collapse toggle.
    const changed = altered(recorded, node => {
      if (node.attrs?.['data-a-target'] === 'right-column__toggle-collapse-btn') return null;
      if (node.attrs?.['data-a-target'] === 'right-column-chat-bar') return { ...node, style: node.style?.replace('width:0px', 'width:340px') };
      return node;
    });
    const result = await check(t, fixtureDocument(changed));
    assert.equal(result.status, 'failed');
    const lines = result.detail?.split('\n') ?? [];
    assert.ok(lines.includes('column.rendered: recorded false, live true'), result.detail);
    assert.ok(lines.includes('toggle.count: recorded 1, live 0'), result.detail);
  });

  it('skips an environment block instead of reporting drift', async t => {
    const result = await check(t, fixtureDocument(recorded).replace('</body>', '<p>Before you continue, accept all cookies</p></body>'));
    assert.equal(result.status, 'skipped');
    assert.match(result.detail ?? '', /environment: consent wall/);
  });
});
