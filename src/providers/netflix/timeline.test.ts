import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { netflixTimeline } from './timeline';

function onHost(hostname: string, integrationOff: string[], run: () => void): void {
  const scope = globalThis as { window?: unknown; document?: unknown };
  const previous = { window: scope.window, document: scope.document };
  scope.window = { location: { hostname } };
  scope.document = { documentElement: { hasAttribute: (name: string) => integrationOff.includes(name) } };
  try { run(); } finally { scope.window = previous.window; scope.document = previous.document; }
}

describe('Netflix timeline', () => {
  const video = {} as HTMLVideoElement;
  const input = { target: 90, windowLive: false, atLiveEdge: false, resumeAfterSeek: true };

  it('seeks through the host session only while provider integration is on', () => {
    onHost('www.netflix.com', ['data-te-netflix-integration-off'], () => {
      assert.equal(netflixTimeline.mediaSeek?.(video, input), null);
    });
    onHost('www.netflix.com', [], () => {
      assert.deepEqual(netflixTimeline.mediaSeek?.(video, input), { detail: { time: 90, resumeAfterSeek: true }, rememberResume: true });
    });
  });

  it('leaves other hosts and location-less stubs to the element', () => {
    onHost('www.netflix.com.evil.test', [], () => assert.equal(netflixTimeline.mediaSeek?.(video, input), null));
    const scope = globalThis as { window?: unknown };
    const previous = scope.window;
    scope.window = {};
    try { assert.equal(netflixTimeline.mediaSeek?.(video, input), null); } finally { scope.window = previous; }
  });
});
