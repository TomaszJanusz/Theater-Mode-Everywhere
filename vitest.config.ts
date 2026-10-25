import { fileURLToPath } from 'node:url';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

import { parseTestEngines } from './src/test-utils/test-engines';

const configDir = fileURLToPath(new URL('.storybook', import.meta.url));
const browser = (name: string) => ({
  enabled: true, headless: true, provider: playwright(),
  instances: [{ name, browser: (process.env.STORYBOOK_BROWSER ?? 'chromium') as 'chromium' | 'firefox' }]
});

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: { fs: { strict: false } },
  test: {
    projects: [
      { extends: true, plugins: [storybookTest({ configDir })], test: { name: 'stories', browser: browser('stories') } },
      { extends: true, test: { name: 'component-cases', include: ['.storybook/cases/*.cases.ts'], browser: browser('component-cases') } },
      // `*.component.test.ts`, started by scripts/run-tests.mjs; THEATER_TEST_ENGINES selects the engines.
      {
        extends: true,
        // Prebundled up front: a dependency discovered mid-run reloads the tester and can report no tests.
        optimizeDeps: { include: ['vitest/browser'] },
        test: {
          name: 'components',
          include: ['src/**/*.component.test.ts'],
          setupFiles: ['src/test-utils/component-setup.ts'],
          // Focus, keyboard input and fullscreen activation belong to one page at a time; files side by side steal them from each other.
          fileParallelism: false,
          browser: {
            enabled: true, headless: true, provider: playwright(),
            viewport: { width: 1280, height: 800 },
            instances: parseTestEngines().map(engine => ({ browser: engine }))
          }
        }
      }
    ]
  }
});
