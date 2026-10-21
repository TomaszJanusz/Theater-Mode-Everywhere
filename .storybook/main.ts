import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

import type { StorybookConfig } from '@storybook/html-vite';
import { searchForWorkspaceRoot } from 'vite';

const require = createRequire(import.meta.url);

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.ts'],
  addons: ['@storybook/addon-vitest'],
  framework: '@storybook/html-vite',
  core: { disableTelemetry: true },
  // The root vite.config.ts is the extension's bundle plan: three entry points, `dist/` as the
  // output and `emptyOutDir`. Storybook keeps its plugins and resolution, not that build plan.
  viteFinal(viteConfig) {
    const { input: _input, output: _output, ...rollup } = viteConfig.build?.rollupOptions ?? {};
    return {
      ...viteConfig,
      server: {
        ...viteConfig.server,
        fs: {
          ...viteConfig.server?.fs,
          // pnpm's global virtual store can resolve fonts outside the workspace (notably on macOS).
          allow: [
            searchForWorkspaceRoot(process.cwd()),
            ...(viteConfig.server?.fs?.allow ?? []),
            dirname(realpathSync(require.resolve('@fontsource/roboto/package.json')))
          ]
        }
      },
      build: { ...viteConfig.build, emptyOutDir: false, rollupOptions: rollup }
    };
  }
};

export default config;
