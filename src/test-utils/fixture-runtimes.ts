import { exposeFixtureRuntime } from './provider-runtime';

// Evaluated before the bundled provider entries, as `entries/content.ts` and `entries/main-world.ts` order their APIs.
exposeFixtureRuntime('isolated');
exposeFixtureRuntime('main');
