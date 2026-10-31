import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import type { StorybookConfig } from '@storybook/html-vite';
import { build, searchForWorkspaceRoot, type Plugin } from 'vite';

const require = createRequire(import.meta.url);

const FIXTURE_ID = 'virtual:player-fixture';

/**
 * The shipped player runtime as one classic script. The Player story runs it in a fixture document
 * of its own (the runtime is a page-lifetime singleton), so it must not join the preview bundle.
 * Built once per Storybook start; restart `pnpm storybook` after editing player runtime sources.
 */
function playerFixturePlugin(): Plugin {
  return {
    name: 'player-fixture',
    resolveId: source => (source === FIXTURE_ID ? `\0${FIXTURE_ID}` : undefined),
    async load(id) {
      if (id !== `\0${FIXTURE_ID}`) return undefined;
      const result = await build({
        configFile: false, logLevel: 'silent',
        build: {
          write: false, minify: false, target: 'es2022',
          lib: { entry: resolve(import.meta.dirname, 'player-runtime-entry.ts'), name: 'TheaterTest', formats: ['iife'], fileName: 'player' }
        }
      });
      const [output] = Array.isArray(result) ? result : [result];
      const chunk = 'output' in output ? output.output.find(item => item.type === 'chunk') : undefined;
      if (!chunk || chunk.type !== 'chunk') throw new Error('The player fixture bundle produced no script');
      return `export default ${JSON.stringify(chunk.code)};`;
    }
  };
}

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.ts', '../options/**/*.stories.ts'],
  addons: ['@storybook/addon-vitest'],
  framework: '@storybook/html-vite',
  core: { disableTelemetry: true },
  // The config/vite.config.ts is the extension's bundle plan: three entry points, `dist/` as the
  // output and `emptyOutDir`. Storybook keeps its plugins and resolution, not that build plan.
  viteFinal(viteConfig) {
    const { input: _input, output: _output, ...rollup } = viteConfig.build?.rollupOptions ?? {};
    return {
      ...viteConfig,
      plugins: [...(viteConfig.plugins ?? []), playerFixturePlugin()],
      server: {
        ...viteConfig.server,
        fs: {
          ...viteConfig.server?.fs,
          // pnpm's global virtual store puts fonts and Storybook's mocker runtime outside the workspace.
          allow: [
            searchForWorkspaceRoot(process.cwd()),
            ...(viteConfig.server?.fs?.allow ?? []),
            dirname(realpathSync(require.resolve('@fontsource/roboto/package.json'))),
            dirname(realpathSync(require.resolve('storybook/package.json')))
          ]
        }
      },
      build: { ...viteConfig.build, emptyOutDir: false, rollupOptions: rollup }
    };
  }
};

export default config;
