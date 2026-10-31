import manifest from '../manifest.json';

/** The running extension's version; the source manifest's outside the extension (the Vite Settings preview). */
export function installedVersion(): string {
  return typeof chrome !== 'undefined' && chrome.runtime?.getManifest
    ? chrome.runtime.getManifest().version : manifest.version;
}
