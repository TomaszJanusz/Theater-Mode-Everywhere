import type { StorybookConfig } from '@storybook/html-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.ts'],
  addons: ['@storybook/addon-vitest'],
  framework: '@storybook/html-vite',
  core: { disableTelemetry: true },
  // The root vite.config.ts is the extension's bundle plan: three entry points, `dist/` as the
  // output and `emptyOutDir`. Storybook keeps its plugins and resolution, not that build plan.
  viteFinal(viteConfig) {
    const { input: _input, output: _output, ...rollup } = viteConfig.build?.rollupOptions ?? {};
    return { ...viteConfig, build: { ...viteConfig.build, emptyOutDir: false, rollupOptions: rollup } };
  }
};

export default config;
