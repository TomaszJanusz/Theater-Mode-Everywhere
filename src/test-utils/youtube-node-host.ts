// Node tests have no document. Imported first, this gives the provider registry, created when its module
// loads, a YouTube hostname so a test can register YouTube's hooks; `releaseYouTubeNodeHost` removes it.
const scope = globalThis as { window?: unknown };
const own = scope.window === undefined;
if (own) scope.window = { location: { hostname: 'www.youtube.com' } };

export function releaseYouTubeNodeHost(): void {
  if (own) delete scope.window;
}
