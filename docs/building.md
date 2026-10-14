# Building

Production packages minify JavaScript and CSS with esbuild. Mozilla's source upload is a `git archive` of the release commit, and this file is in that archive. Reviewers can rebuild the submitted extension from the archive plus the lockfile.

esbuild shortens syntax, whitespace, and local identifiers, including function and class names. It leaves property names unchanged. `TME_BUILD=diagnostic` writes the same packages with minification off, which is the readable form for stack traces. Production leaves function names mangled: preserving them with esbuild `keepNames` increased page heap by about 2.6MB against mangled output on a parent document plus 12 frames.

## Requirements

- Node.js 22
- pnpm 11.5.1 (`packageManager` in `package.json`)

## Reproduce the release packages

```sh
pnpm install --frozen-lockfile
CI=true pnpm build
pnpm verify:bundles
```

`CI=true` keeps the packaged manifest version from `package.json`, or from `RELEASE_TAG` when that variable is a version. A build without `CI=true` stamps a date-based version into the packaged manifest only. The root `manifest.json` is rewritten only when `CI=true`.

Outputs:

- `dist/theater-everywhere-firefox.zip` and `dist/firefox-unpacked/`
- `dist/theater-everywhere-chrome.zip` and `dist/chrome-unpacked/`

`content.js` and `mainWorld.js` stay self-contained classic scripts: one file each, no ESM `import` or `export`. `pnpm verify:bundles` checks both unpacked directories.

## Diagnostic build

```sh
CI=true TME_BUILD=diagnostic pnpm build
```

`pnpm build:diagnostic` is the same mode. Add `CI=true` when the packaged version should match `package.json`.

## Source archive

`node_modules/` and `dist/` are gitignored, so they are not in the archive. Install dependencies from `pnpm-lock.yaml`. The release workflow refuses to upload the archive when this file is missing.
