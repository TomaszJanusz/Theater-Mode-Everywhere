import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { DISNEY_SNAPSHOT_SCRIPT_ID } from './page';
import { disneyTimeline } from './timeline';

type Stubs = { restore(): void; chromeReads(): number; publish(snapshot: object | null): void; setChrome(seconds: number | null): void };

/** A Disney+ document whose snapshot script and chrome overlay reads are observable. */
function installDisneyPage(hostname: string): Stubs {
  const globals = globalThis as { window?: unknown; document?: unknown; HTMLElement?: unknown };
  const previous = { window: globals.window, document: globals.document, HTMLElement: globals.HTMLElement };
  let snapshot: string | null = null;
  let chromeSeconds: number | null = null;
  let chromeReads = 0;
  globals.window = { location: { hostname } };
  globals.HTMLElement = class {};
  globals.document = {
    querySelector(selector: string) {
      if (selector === `#${DISNEY_SNAPSHOT_SCRIPT_ID}`) return snapshot == null ? null : { textContent: snapshot };
      if (selector === '.DxcOverlay') chromeReads++;
      return null;
    },
    querySelectorAll() {
      return { forEach: (visit: (node: { getAttribute(name: string): string }) => void) => {
        if (chromeSeconds != null) visit({ getAttribute: () => String(chromeSeconds) });
      } };
    },
    textContent: ''
  };
  const put = (key: 'window' | 'document' | 'HTMLElement') => {
    if (previous[key] === undefined) delete globals[key];
    else globals[key] = previous[key];
  };
  return {
    restore() { put('window'); put('document'); put('HTMLElement'); },
    chromeReads: () => chromeReads,
    publish(value) { snapshot = value == null ? null : JSON.stringify(value); },
    setChrome(seconds) { chromeSeconds = seconds; }
  };
}

describe('Disney VOD duration', () => {
  let page: Stubs | null = null;
  afterEach(() => { page?.restore(); page = null; });
  const video = {} as HTMLVideoElement;

  it('follows changed metadata without consulting the chrome', () => {
    page = installDisneyPage('www.disneyplus.com');
    page.setChrome(5400);
    page.publish({ duration: 1800 });
    for (let attempt = 0; attempt < 10; attempt++) assert.equal(disneyTimeline.vodDuration?.(video), 1800);
    page.publish({ duration: 2400 });
    assert.equal(disneyTimeline.vodDuration?.(video), 2400);
    assert.equal(page.chromeReads(), 0);
  });

  it('falls back to the chrome when no snapshot or no duration is published', () => {
    page = installDisneyPage('www.disneyplus.com');
    page.setChrome(5400);
    assert.equal(disneyTimeline.vodDuration?.(video), 5400);
    assert.equal(page.chromeReads(), 1);
    page.publish({ title: 'Episode' });
    assert.equal(disneyTimeline.vodDuration?.(video), 5400);
    assert.equal(page.chromeReads(), 2);
    page.publish({ duration: 1800 });
    assert.equal(disneyTimeline.vodDuration?.(video), 1800);
    assert.equal(page.chromeReads(), 2);
  });

  it('reports no duration when neither source has one, and stays off other hosts', () => {
    page = installDisneyPage('www.disneyplus.com');
    assert.equal(disneyTimeline.vodDuration?.(video), null);
    page.restore();
    page = installDisneyPage('example.com');
    page.setChrome(5400);
    page.publish({ duration: 1800 });
    assert.equal(disneyTimeline.vodDuration?.(video), null);
    assert.equal(page.chromeReads(), 0);
  });
});
