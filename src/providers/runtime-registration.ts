import { PROVIDER_CATALOG } from './catalog';
import { descriptorMatchesHost } from './descriptor-hosts';
import type { ProviderHooks } from './provider-api';

/** A registry belongs to one document and one world. Registration is closed before startup. */
export function createProviderRegistry(hostname: string) {
  const entries = new Map<string, ProviderHooks>();
  const failed = new Set<string>();
  let started = false;
  return {
    register(hooks: ProviderHooks): boolean {
      const descriptor = PROVIDER_CATALOG.find(item => item.id === hooks.id);
      if (started || !descriptor || !descriptorMatchesHost(descriptor.hosts, hostname)) return false;
      if (entries.get(hooks.id) === hooks) return true;
      if (failed.has(hooks.id)) return false;
      if (hooks.contractVersion !== 1 || entries.has(hooks.id)) {
        entries.delete(hooks.id);
        failed.add(hooks.id);
        return false;
      }
      entries.set(hooks.id, hooks);
      return true;
    },
    fail(id: string): void { entries.delete(id); failed.add(id); },
    get(id: string): ProviderHooks | undefined { return entries.get(id); },
    all(): ProviderHooks[] { return [...entries.values()]; },
    state(id: string): 'unregistered' | 'ready' | 'failed' {
      if (failed.has(id)) return 'failed';
      return entries.has(id) ? 'ready' : 'unregistered';
    },
    start(): boolean {
      if (started) return false;
      started = true;
      return true;
    }
  };
}

export const providerRegistry = createProviderRegistry(typeof window === 'undefined' ? '' : window.location.hostname);
export const registeredChat = () => providerRegistry.all().find(hooks => hooks.chat)?.chat;
