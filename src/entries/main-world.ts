import { markMainWorldBooted, shouldPatchMainWorld } from '../providers/registry';
import { installMainWorldRuntime } from '../platform/main-world-runtime';

if (shouldPatchMainWorld(window.location.hostname) && markMainWorldBooted(window)) {
  installMainWorldRuntime();
}
