import { installMainWorldRuntime } from '../platform/main-world-runtime';
import { fetchPageMedia } from '../platform/page-fetch';
import { exposeProviderRuntime } from '../providers/provider-api';
import { markMainWorldBooted } from '../providers/registry';
import { providerRegistry } from '../providers/runtime-registration';

exposeProviderRuntime('main', {
  contractVersion: 1, register: providerRegistry.register, services: { fetchPageMedia },
  start() {
    // The runtime installs registered providers after its harvest observers.
    if (!providerRegistry.start() || !markMainWorldBooted(window)) return;
    installMainWorldRuntime();
  }
});
