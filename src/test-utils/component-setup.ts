import { afterEach, beforeEach, vi } from 'vitest';

import { destroyPlayerUi, setPlayerUiCss } from '../ui/root';
import uiCss from '../ui/shadow.css?inline';

import { createChromeStub, type ChromeStub } from './page-chrome-stub';

// Setup for every `*.component.test.ts`: the extension edge and the player UI skin. Each test starts
// on an empty document with a fresh chrome stub; teardown removes the player UI root, which also
// disposes a modal still mounted in it, so no surface or listener leaks into the next test.
let stub: ChromeStub | undefined;
setPlayerUiCss(uiCss);

beforeEach(() => {
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
