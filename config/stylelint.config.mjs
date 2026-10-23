import recommended from 'stylelint-config-recommended';
import standard from 'stylelint-config-standard';

// Use Standard's parser and correctness rules, while leaving wholesale formatting
// changes to a separate migration. Legacy violations are counted per file.
const disabledStyleRules = Object.fromEntries(
  [...Object.keys(standard.rules), ...Object.keys(recommended.rules)].map(rule => [rule, null]),
);

export default {
  extends: ['stylelint-config-standard'],
  plugins: ['stylelint-declaration-strict-value'],
  rules: {
    ...disabledStyleRules,
    'block-no-empty': true,
    'declaration-block-no-duplicate-properties': true,
    'property-no-unknown': true,
    'color-no-invalid-hex': true,
    'declaration-no-important': true,
    'scale-unlimited/declaration-strict-value': ['z-index', { ignoreFunctions: false }],
    'selector-disallowed-list': ['/(?:^|[\\s>+~,:])(?:[.#]?)(?:ytp-|ytd-|netflix|disney|twitch)[\\w-]*/i'],
  },
  overrides: [{
    files: ['src/ui/shadow.css'],
    rules: { 'selector-max-specificity': '0,4,1', 'selector-max-id': 0 },
  }],
  ignoreFiles: ['dist/**', 'output/**', 'node_modules/**', 'src/providers/**'],
};
