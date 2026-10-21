import { DisposableScope } from '../src/core/disposable-scope';
import { destroyPlayerUi } from '../src/ui/root';

let current: DisposableScope | undefined;

/** The only owner for every component family, including render/args/global replacements. */
export function disposeStage(): void {
  current?.dispose();
  current = undefined;
}

export function beginStage(): { scope: DisposableScope; view: HTMLElement } {
  disposeStage();
  const scope = new DisposableScope();
  current = scope;
  // Registered first so component cleanup runs while its root still exists.
  scope.add(destroyPlayerUi);
  const view = document.createElement('div');
  return { scope, view };
}
