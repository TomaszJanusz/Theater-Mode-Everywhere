import { exposeFixtureRuntime } from './provider-runtime';

// Evaluated before the provider entries, as content.js and mainWorld.js run before them in the manifest.
exposeFixtureRuntime('isolated');
exposeFixtureRuntime('main');
