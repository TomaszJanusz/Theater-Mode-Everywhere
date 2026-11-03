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

// YouTube creates its controls while the player loads and lays them out later (or never).
const youtube = committedFixture('youtube-watch-player');
const HIDE_CONTROLS = '<style id="hide-controls">.ytp-right-controls { display: none !important; }</style>';
const LATE_NOTICE = '<p id="late" hidden>Sign in to confirm you’re not a bot</p>';
const withHiddenControls = (extra = ''): string => fixtureDocument(youtube).replace('</body>', `${HIDE_CONTROLS}${extra}</body>`);

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

  describe('a host that attaches its controls before laying them out', () => {
    /** Runs the check while the test changes the page once it is `afterMs` old (page time, so no timer here). */
    const checkYoutube = async (t: Parameters<typeof shared.newContext>[0], served: string, change?: { afterMs: number; apply: () => void }) => {
      const context = await shared.newContext(t, { viewport: youtube.viewport });
      const page = await context.newPage();
      await page.route('https://host.test/**', route => route.fulfill({ contentType: 'text/html', body: served }));
      const result = checkDrift(page, PAGE, youtube, RECIPES[youtube.id]);
      if (change) {
        await page.waitForSelector('#hide-controls', { state: 'attached' });
        await page.waitForFunction(afterMs => performance.now() > afterMs, change.afterMs);
        await page.evaluate(change.apply);
      }
      return result;
    };

    it('waits for the controls instead of recording them as absent', async t => {
      // Later than the settle poll: two equal reads of the unrendered page must not count as settled.
      const result = await checkYoutube(t, withHiddenControls(), { afterMs: 1500, apply: () => document.getElementById('hide-controls')?.remove() });
      assert.deepEqual(result, { fixture: youtube.id, status: 'passed' });
    });

    it('classifies an in-player bot check shown after load as an environment block', async t => {
      // The page passes the early check; the host's error text appears with the player, later.
      const result = await checkYoutube(t, withHiddenControls(LATE_NOTICE), { afterMs: 500, apply: () => { document.getElementById('late')!.hidden = false; } });
      assert.equal(result.status, 'skipped');
      assert.match(result.detail ?? '', /environment: bot check/);
    });

    it('still reports controls that never appear as drift', async t => {
      const result = await checkYoutube(t, withHiddenControls());
      assert.equal(result.status, 'failed');
      assert.match(result.detail ?? '', /page never settled/);
    });
  });
});
