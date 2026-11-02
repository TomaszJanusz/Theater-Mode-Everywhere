import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `pnpm build`'s unpacked Chromium extension. */
export const CHROMIUM_BUILD = fileURLToPath(new URL('../../dist/chrome-unpacked', import.meta.url));

/**
 * Whether the installed-extension build the test loads exists. Locally a missing build skips the test with the
 * command that makes it; in CI a missing build fails it, because a lane that forgot to download the build artifact
 * would otherwise report these tests as skipped and pass without running them.
 */
export function installedBuildReady(
  t: { skip(message: string): void },
  files: readonly string[] = ['manifest.json', 'content.js'],
  env: Record<string, string | undefined> = process.env,
  dir = CHROMIUM_BUILD
): boolean {
  const missing = files.filter(file => !existsSync(path.join(dir, file)));
  if (missing.length === 0) return true;
  const detail = `${path.relative(process.cwd(), dir) || dir} lacks ${missing.join(', ')}`;
  if (env.CI === 'true' || env.GITHUB_ACTIONS === 'true') {
    throw new Error(`environment: ${detail}; the CI lane must download the extension-build artifact (or run pnpm build) before the tests`);
  }
  t.skip(`${detail}; run pnpm build`);
  return false;
}
