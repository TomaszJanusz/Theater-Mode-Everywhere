import { markMainWorldBooted } from '../providers/registry';
import { installMainWorldRuntime } from '../platform/main-world-runtime';

if (markMainWorldBooted(window)) {
  installMainWorldRuntime();
}
