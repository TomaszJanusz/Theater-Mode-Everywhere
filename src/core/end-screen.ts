import type { DisposableScope } from './disposable-scope';

/** A provider owns its end-screen UI; one mount scope is one curtain appearance/epoch. */
export interface EndScreenSource {
  /** Append inside the picture curtain. Dispose all UI with scope, and reject work after scope.isDisposed. */
  mount(container: HTMLElement, scope: DisposableScope, label: string): void;
  /** A native countdown owns the picture, so even the plain curtain yields. */
  hostEndsPlayback(): boolean;
  subscribe(changed: () => void): () => void;
  dispose(): void;
}
