# Lint and the suppression ratchet

Run `pnpm lint` before submitting TypeScript, JavaScript or lint config changes.
ESLint uses recommended JavaScript and SonarJS rules, type imports, unused binding
checks, ordered imports and Privacy Thing's 24-character code-owned symbol limit.
Imports and structural keys are exempt from that name limit. Parsing is untyped.

Product code in `src/`, `popup/`, `options/`, `scripts/` and `tools/` has budgets of
4 parameters, 120 lines per function and 600 lines per file, excluding blank lines
and comments. Tests and `test-utils` have only an 800-line file budget; generated
files are excluded. SonarJS and the HTML/import restrictions apply to product code.
Use DOM nodes/textContent or the safe locale builder in
[`src/localized-markup.ts`](../src/localized-markup.ts) instead of HTML sinks.

Size budgets are editor warnings. With `--max-warnings 0` (including `pnpm lint`),
the config promotes them to errors because ESLint bulk suppressions only cover
errors. Existing debt is recorded by file/rule/count in `eslint-suppressions.json`;
new files or higher counts fail. This is a count budget, so replacing a violation
with another in the same file/rule cannot be detected. Fix debt as you touch it.

After fixing existing violations, run `pnpm lint:suppressions:prune`, review the
JSON reduction, and commit it with the fix. The baseline may only shrink without
review; do not rerun `--suppress-all` to accept new debt. Unused allowances also
fail lint until pruned.

For an intentional exception, put `// eslint-disable-next-line rule-name -- reason`
directly above the violating line. Explain the constraint; do not disable whole
files to evade budgets.

Run `pnpm test scripts/eslint-ratchet.test.mjs` to reproduce the baseline proof in
a temporary directory: a 121-line product function and HTML sinks fail the strict
CLI; reducing a suppressed function from five parameters to four makes pruning
remove its allowance. No source files are modified by that test.

Lint dependencies use import-x 4.6.1 (the newer resolver requires a build script)
and a scoped resolver-node 0.3.9 pin (0.3.10 pulls a trust-downgrade dependency).
ESLint 9 supports bulk suppressions and this import-x version's peer range.
TypeScript's [side-by-side compatibility aliases](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6-0)
give typescript-eslint the 6.0 API while `tsc`/typecheck keep using native 7.0.
