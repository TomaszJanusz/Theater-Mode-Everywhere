import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DOCKERFILE = new URL('../.github/ci-image/Dockerfile', import.meta.url);
const LOCKFILE = new URL('../pnpm-lock.yaml', import.meta.url);

/** The one Playwright version the lockfile resolves; the CI image must carry exactly its browser revisions. */
export function playwrightVersion(lockfile) {
  const versions = new Set([...lockfile.matchAll(/^ {2}playwright@(\d+\.\d+\.\d+):/gm)].map(match => match[1]));
  if (versions.size !== 1) throw new Error(`Expected exactly one playwright version in pnpm-lock.yaml, found: ${[...versions].join(', ') || 'none'}`);
  return [...versions][0];
}

/** Tag changes with the Playwright version and with the Dockerfile, so either edit builds a fresh image. */
export function imageRef(repository, version, dockerfile) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error(`Invalid repository: ${repository}`);
  const hash = createHash('sha256').update(dockerfile).digest('hex').slice(0, 12);
  return {
    ref: `ghcr.io/${repository.toLowerCase()}/ci-browsers:pw${version}-${hash}`,
    base: `mcr.microsoft.com/playwright:v${version}-noble`,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repository = process.argv[2];
  const { ref, base } = imageRef(repository, playwrightVersion(readFileSync(LOCKFILE, 'utf8')), readFileSync(DOCKERFILE, 'utf8'));
  console.log(`ref=${ref}\nbase=${base}`);
}
