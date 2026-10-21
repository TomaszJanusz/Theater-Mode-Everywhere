import { fileURLToPath } from 'node:url';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const dirname = fileURLToPath(new URL('.', import.meta.url));
const browser = (name: string) => ({
  enabled: true, headless: true, provider: playwright(),
  instances: [{ name, browser: (process.env.STORYBOOK_BROWSER ?? 'chromium') as 'chromium' | 'firefox' }]
});

export default defineConfig({
  root: new URL('..', import.meta.url).pathname,
  server: { fs: { strict: false } },
  test: {
    projects: [
      { extends: true, plugins: [storybookTest({ configDir: dirname })], test: { name: 'stories', browser: browser('stories') } },
      { extends: true, test: { name: 'component-cases', include: ['.storybook/cases/*.cases.ts'], browser: browser('component-cases') } }
    ]
  }
});
