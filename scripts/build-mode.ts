export type BundleBuildMode = 'production' | 'diagnostic';

export function resolveBundleBuildMode(env: NodeJS.ProcessEnv = process.env): BundleBuildMode {
  const raw = env.TME_BUILD;
  if (raw === undefined || raw.trim() === '') return 'production';
  const value = raw.trim().toLowerCase();
  if (value === 'production' || value === 'diagnostic') return value;
  throw new Error(`TME_BUILD must be "production" or "diagnostic" (received ${JSON.stringify(raw)}).`);
}

export function bundleMinify(mode: BundleBuildMode): false | 'esbuild' {
  return mode === 'production' ? 'esbuild' : false;
}
