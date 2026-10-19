import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import-x';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';

import {
  maxSymbolNameLengthRule,
  symbolNameFiles,
  symbolNameIgnores,
} from './eslint-rules/max-symbol-name-length.mjs';

const productFiles = ['{src,popup,options,scripts,tools}/**/*.{js,mjs,cjs,ts,mts,cts}'];
const testFiles = ['**/*.test.{js,mjs,cjs,ts,mts,cts}', '**/test-utils/**'];
const generatedFiles = ['**/*.generated.*', '**/generated/**', '**/*.d.{ts,mts,cts}'];

// ESLint bulk suppressions only cover errors. Keep editor guidance as warnings,
// but give the strict CLI the same budgets as suppressible, blocking errors.
const strict = process.argv.some((arg, index, args) =>
  arg === '--max-warnings=0' || (arg === '--max-warnings' && args[index + 1] === '0'));
const budgetLevel = strict ? 'error' : 'warn';
const htmlMessage = 'Use the safe DOM builder (src/localized-markup.ts: localizedMarkup) or textContent instead of HTML strings.';

export default [
  {
    ignores: [
      '**/node_modules/**', 'dist/**', 'build/**', 'output/**', 'outputs/**',
      'coverage/**', 'playwright-report/**', 'test-results/**', 'blob-report/**',
      '.claude/**', '.web-ext-profile/**', '.playwright/**', '.pnpm-store/**',
      ...generatedFiles,
    ],
  },
  eslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, chrome: 'readonly' },
    },
    plugins: { import: importPlugin },
    rules: {
      'import/order': ['error', {
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      }],
    },
  },
  {
    files: ['**/*.{ts,mts,cts}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: false, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'off',
      'no-unused-vars': 'off',
    },
  },
  {
    files: symbolNameFiles,
    ignores: symbolNameIgnores,
    plugins: { local: { rules: { 'max-symbol-name-length': maxSymbolNameLengthRule } } },
    rules: { 'local/max-symbol-name-length': ['error', { max: 24 }] },
  },
  {
    ...sonarjs.configs.recommended,
    files: productFiles,
    ignores: testFiles,
  },
  {
    files: productFiles,
    ignores: testFiles,
    rules: {
      'max-params': [budgetLevel, 4],
      'max-lines-per-function': [budgetLevel, {
        max: 120, skipBlankLines: true, skipComments: true, IIFEs: false,
      }],
      'max-lines': [budgetLevel, { max: 600, skipBlankLines: true, skipComments: true }],
      'no-restricted-syntax': ['error',
        {
          selector: 'AssignmentExpression > MemberExpression.left[computed=false][property.name=/^(innerHTML|outerHTML|insertAdjacentHTML)$/]',
          message: htmlMessage,
        },
        {
          selector: 'AssignmentExpression > MemberExpression.left[computed=true][property.value=/^(innerHTML|outerHTML|insertAdjacentHTML)$/]',
          message: htmlMessage,
        },
        {
          selector: 'CallExpression > MemberExpression.callee[computed=false][property.name="insertAdjacentHTML"]',
          message: htmlMessage,
        },
        {
          selector: 'CallExpression > MemberExpression.callee[computed=true][property.value="insertAdjacentHTML"]',
          message: htmlMessage,
        },
      ],
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['playwright', 'playwright/*', 'esbuild', 'esbuild/*'],
          message: 'Keep browser automation and bundling in tests or dedicated tooling.',
        }],
      }],
    },
  },
  {
    files: testFiles,
    rules: { 'max-lines': [budgetLevel, { max: 800, skipBlankLines: true, skipComments: true }] },
  },
];
