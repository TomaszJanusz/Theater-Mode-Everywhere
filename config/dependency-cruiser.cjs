const providerDirectories = [
  'bilibili', 'bilibili-intl', 'crunchyroll', 'disney', 'native',
  'navigation', 'netflix', 'patreon', 'tencent', 'timeline',
  'twitch', 'vimeo', 'youtube',
];
const runtime = { pathNot: '(?:\\.test\\.|/test-utils/|^scripts/|^tools/|^\\.storybook/)' };

module.exports = {
  forbidden: [
    {
      name: 'shared-ui-does-not-import-service-implementations', severity: 'error',
      from: { path: '^src/(?:ui|core|media-features|platform)/', ...runtime },
      to: { path: '^src/providers/[^/]+/' },
    },
    ...providerDirectories.map(service => ({
      name: `provider-${service}-isolation`, severity: 'error',
      from: { path: `^src/providers/${service}/`, ...runtime },
      to: { path: '^src/providers/[^/]+/', pathNot: `^src/providers/${service}/` },
    })),
    {
      name: 'settings-ui-uses-public-settings-and-i18n', severity: 'error',
      from: { path: '^(?:popup|options)/', ...runtime },
      to: {
        path: '^src/',
        pathNot: '^src/(?:appearance-preferences|appearance-runtime|audio-settings|feature-highlights(?:-lifecycle|-storage)?|i18n(?:-runtime)?|language|message-catalog|themeHelper|providers/(?:capabilities|registry)|media-features/provider-flags|ui/shortcuts|platform/domain-policy)\\.ts$',
      },
    },
    {
      name: 'no-runtime-cycles', severity: 'error',
      from: { path: '^src/', ...runtime }, to: { circular: true },
    },
    {
      name: 'production-does-not-import-test-tools', severity: 'error',
      from: { path: '^(?:src|popup|options)/', ...runtime },
      to: { path: '^(?:src/test-utils/|test/|tools/)|^(?:playwright|esbuild)(?:/|$)' },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.test\\.|\\.stories\\.' },
  },
};
