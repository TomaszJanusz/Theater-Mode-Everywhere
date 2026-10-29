import { requestPageFetch } from '../media-features/probe';
import { serviceElementToken } from '../providers/native-service-actions';
import { exposeProviderRuntime, type ProviderWorld } from '../providers/provider-api';
import { providerRegistry } from '../providers/runtime-registration';

/** Fixture wiring only: provider implementation is a separate script, just as in the manifest. */
export function exposeFixtureRuntime(world: ProviderWorld): void {
  exposeProviderRuntime(world, { contractVersion: 1, register: providerRegistry.register, start() {},
    services: { requestPageFetch, serviceElementToken } });
}
