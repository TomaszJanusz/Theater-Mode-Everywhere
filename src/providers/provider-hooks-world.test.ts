import { it } from 'node:test';

import type { IsolatedProviderHooks, MainProviderHooks, ProviderRuntimeApi } from './provider-api';
import { youtubeWatchPlayback } from './youtube/watch-playback';

const base = { id: 'youtube', contractVersion: 1, watchPlayback: youtubeWatchPlayback } as const;

// The assertions are compile-time: `pnpm typecheck` fails when one of the `@ts-expect-error` lines compiles.
it('provider hooks are typed per world', () => {
  const main = {} as ProviderRuntimeApi<'main'>;
  const isolated = {} as ProviderRuntimeApi<'isolated'>;
  const never = (_register: () => void) => {};
  never(() => {
    main.register({ ...base, probe: () => null, install() {} });
    isolated.register({ ...base, createAdapter: () => { throw new Error('type only'); }, stage: {} as NonNullable<IsolatedProviderHooks['stage']> });
    // Hooks both worlds share register in either.
    main.register({ ...base, chat: undefined, events: { media: [] } });
    isolated.register({ ...base, events: { media: [] } });

    // @ts-expect-error an isolated-world hook is silently ignored in MAIN
    main.register({ ...base, stage: {} as NonNullable<IsolatedProviderHooks['stage']> });
    // @ts-expect-error likewise for host captions
    main.register({ ...base, hostCaptions: () => { throw new Error('type only'); } });
    // @ts-expect-error a MAIN-world hook is silently ignored in the isolated world
    isolated.register({ ...base, install() {} });
    // @ts-expect-error likewise for harvest
    isolated.register({ ...base, harvest: {} as NonNullable<MainProviderHooks['harvest']> });
    // @ts-expect-error a hook object held in a variable is checked too
    main.register(({ ...base, titleFromPage: true }) as IsolatedProviderHooks);
  });
});
