import { providerRuntime } from '../provider-api';

// Reddit needs nothing in the page's world: captions are fetched through the shared page fetch, which the
// descriptor's `mediaFetch` rule admits. Registering keeps the provider's state the same in both worlds.
providerRuntime('main')?.register({ id: 'reddit', contractVersion: 1 });
