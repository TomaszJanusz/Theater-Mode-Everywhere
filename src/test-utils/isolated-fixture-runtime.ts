import { exposeFixtureRuntime } from './provider-runtime';

// Evaluated before the bundled provider entries, as `entries/content.ts` orders its API module.
exposeFixtureRuntime('isolated');
