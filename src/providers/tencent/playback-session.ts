import { DisposableScope } from '../../core/disposable-scope';
import { openTencentWasmSurface } from './wasm-bridge';
import { isUsableTencentWasmPlayer, replacementTencentWasmHost } from './wasm-player';
import type { ProviderPlaybackSession } from '../playback-session';

export function openTencentPlaybackSession(
  element: HTMLElement,
  options: { isCurrent(): boolean; onReplacement(element: HTMLElement): void }
): ProviderPlaybackSession {
  const scope = new DisposableScope();
  const surface = openTencentWasmSurface(element);
  scope.add(() => surface.dispose?.());
  const observer = new MutationObserver(() => {
    if (scope.isDisposed || !options.isCurrent() || element.isConnected) return;
    const candidates = Array.from(element.ownerDocument.querySelectorAll('fake-iframe-video'))
      .filter(candidate => isUsableTencentWasmPlayer(candidate));
    const next = replacementTencentWasmHost(element, candidates);
    if (next) options.onReplacement(next);
  });
  observer.observe(element.ownerDocument.documentElement, { childList: true, subtree: true });
  scope.add(() => observer.disconnect());
  return { surface, needsPointerCatcher: true, dispose: () => scope.dispose() };
}
