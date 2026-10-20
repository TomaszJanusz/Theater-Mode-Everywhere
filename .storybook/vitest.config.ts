import { fileURLToPath } from 'node:url';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const dirname = fileURLToPath(new URL('.', import.meta.url));

// Story `play` functions run as tests in a real browser. `STORYBOOK_BROWSER` selects the engine.
export default defineConfig({
  root: new URL('..', import.meta.url).pathname,
  // `virtualStoreType: global` puts dependencies outside the workspace root.
  server: { fs: { strict: false } },
  plugins: [storybookTest({ configDir: dirname })],
  test: {
    name: 'storybook',
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: (process.env.STORYBOOK_BROWSER ?? 'chromium') as 'chromium' | 'firefox' }]
    }
  }
});
