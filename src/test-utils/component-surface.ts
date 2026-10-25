import { DisposableScope } from '../core/disposable-scope';
import { getPlayerUiRoot } from '../ui/root';

/**
 * Shared interaction semantics a surface promises. A new surface with an existing policy gets the
 * conformance cases by registering; new semantics need their own policy or targeted tests.
 */
export type SurfacePolicy = 'modal' | 'anchored-menu';

/** Where a registration builds: the production player UI root, a stage with pointer events, an owner. */
interface SurfaceFixture {
  root: ShadowRoot;
  /** A row of controls inside the root, like the control bar. The registration adds its trigger here. */
  stage: HTMLElement;
  /** Per-mount owner. Disposing it stands in for theater exit, navigation and rebind. */
  owner: DisposableScope;
}

interface SurfaceHandle {
  /** Opens the surface on activation (click, or Enter while focused). */
  trigger: HTMLButtonElement;
  /** The element the surface owner writes `data-te-surface`/`-state`/`-owner` on, once one exists. */
  surface(): HTMLElement | null;
  /** Closes through the surface's own API. Safe to repeat. */
  close(): void;
}

export interface SurfaceRegistration {
  name: string;
  policy: SurfacePolicy;
  /** Builds the trigger and surface. Owner disposal must close the surface and release what it holds. */
  mount(fixture: SurfaceFixture): SurfaceHandle;
}

export interface MountedSurface extends SurfaceFixture, SurfaceHandle {
  /** A focusable control after the surface, outside it. */
  outside: HTMLButtonElement;
}

export function controlButton(label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  return button;
}

/** Mounts one registration in the real player UI root (top layer, skin, inert and stacking included). */
export function mountSurface(registration: SurfaceRegistration): MountedSurface {
  const root = getPlayerUiRoot();
  const stage = document.createElement('div');
  // The host has `pointer-events: none`; real controls opt back in, as the control bar does.
  stage.style.cssText = 'position:absolute;inset:auto 0 0 0;display:flex;align-items:flex-end;gap:16px;padding:16px;pointer-events:auto';
  root.append(stage);
  const owner = new DisposableScope();
  owner.add(() => stage.remove());
  const handle = registration.mount({ root, stage, owner });
  const outside = controlButton('Outside');
  stage.append(outside);
  return { root, stage, owner, outside, trigger: handle.trigger, surface: () => handle.surface(), close: () => handle.close() };
}
