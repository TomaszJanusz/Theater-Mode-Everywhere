import { installMainWorldRuntime } from '../platform/main-world-runtime';
import { exposeProviderRuntime } from '../providers/provider-api';
import { markMainWorldBooted } from '../providers/registry';
import { providerRegistry } from '../providers/runtime-registration';

exposeProviderRuntime('main', {
  contractVersion: 1, register: providerRegistry.register,
  start() {
    if (!providerRegistry.start() || !markMainWorldBooted(window)) return;
    for (const hooks of providerRegistry.all()) {
      try { hooks.install?.(); } catch { providerRegistry.fail(hooks.id); }
    }
    installMainWorldRuntime();
  }
});
