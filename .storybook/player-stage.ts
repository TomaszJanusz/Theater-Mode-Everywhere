import { applyAccentColorPreset } from '../src/accentTheme';
import type { DisposableScope } from '../src/core/disposable-scope';
import { applyUiDirection } from '../src/ui/messages';
import { getPlayerUiRoot, mountPlayerUi } from '../src/ui/root';

import { beginStage } from './stage-owner';

/** The same overlay painting the player runtime applies to everything it mounts. */
export function paintOverlay(element: HTMLElement): void {
  applyUiDirection(element);
  applyAccentColorPreset(element, 'system');
}

/** Resolves once the production player UI root, with its real stylesheet, is mounted. */
export function playerUiRoot(): ShadowRoot {
  return getPlayerUiRoot();
}

export { mountPlayerUi };

/**
 * Mounts controls in the real player-UI shadow root, inside the bar markup the extension
 * builds (`wrapper > row > left`). The previous story's root and listeners are torn down first,
 * as theater exit does.
 */
export function renderPlayerBar(build: (scope: DisposableScope) => HTMLElement[], options: { liftBar?: boolean } = {}): HTMLElement {
  const { scope, view } = beginStage();
  const wrapper = document.createElement('div');
  wrapper.className = 'theater-controls-wrapper visible';
  wrapper.setAttribute('role', 'group');
  paintOverlay(wrapper);
  const row = document.createElement('div');
  row.className = 'theater-controls-row';
  const left = document.createElement('div');
  left.className = 'theater-controls-left';
  left.append(...build(scope));
  row.append(left);
  wrapper.append(row);
  // A tooltip below the bar needs room under it; flush with the viewport edge it would be clipped,
  // and the clipped fractional edge rasterises differently from run to run.
  if (options.liftBar) wrapper.style.setProperty('bottom', '96px', 'important');
  mountPlayerUi(wrapper);
  // Storybook mounts what a story returns; the player UI lives in the shadow root.
  return view;
}
