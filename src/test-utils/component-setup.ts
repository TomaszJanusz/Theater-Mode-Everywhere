import { afterEach, beforeEach, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import { destroyPlayerUi, setPlayerUiCss } from '../ui/root';
import uiCss from '../ui/shadow.css?inline';

import { createChromeStub, type ChromeStub } from './page-chrome-stub';

// Setup for every `*.component.test.ts`: the extension edge and the player UI skin. Each test starts
// on an empty document with a fresh chrome stub; teardown removes the player UI root, which also
// disposes a modal still mounted in it, so no surface or listener leaks into the next test.
let stub: ChromeStub | undefined;
setPlayerUiCss(uiCss);

beforeEach(async () => {
  // The real mouse stays where the last test left it. Firefox then sends pointerenter/leave to whatever
  // mounts under it a few frames later, which can reopen a menu that Escape just closed. Park it on the
  // empty document first so only the test's own input moves it.
  await userEvent.unhover(document.body);
  stub = createChromeStub();
  globalThis.chrome = stub.chrome;
});

afterEach(() => {
  destroyPlayerUi();
  stub?.dispose();
  stub = undefined;
  vi.useRealTimers();
  document.body.replaceChildren();
});
