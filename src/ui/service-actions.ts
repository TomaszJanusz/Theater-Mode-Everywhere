import type { DisposableScope } from '../core/disposable-scope';
import { createVisibleRefresh } from '../core/visible-refresh';

import type { ServiceAction, ServiceActionSource } from '../core/service-actions';

export type ServiceActionCtaOptions = {
  source: ServiceActionSource;
  mount: (element: HTMLElement) => void;
  paint?: (element: HTMLElement) => void;
  /** Bar or header chrome is showing, so the CTA sits above the playback bar. */
  toolbarVisible: () => boolean;
  subscribeToolbar: (listener: () => void) => () => void;
  subscribeVisibility?: (listener: () => void) => () => void;
  /** Pixels to clear above the 24px screen edge while the bar is visible. */
  controlsLift: () => number;
  menuOpen?: () => boolean;
  pollMs?: number;
  /** Caption dock. Called when the host appears, changes buttons, or goes away. */
  onLayout?: () => void;
};

/** Main-world Space swallow must ignore this class or the button never activates. */
export const SERVICE_ACTION_CLASS = 'theater-service-action';
const SERVICE_ACTION_HOST_CLASS = 'theater-service-action-host';
const TOOLBAR_VISIBLE_CLASS = 'toolbar-visible';
const LIFT_VAR = '--theater-service-action-lift';
const LIFT_FALLBACK_PX = 96;
const DEFAULT_POLL_MS = 1000;

/**
 * Bottom-right glass CTA. It stays up for as long as the provider reports a
 * live action, including after the playback bar auto-hides.
 * Cleanup of the poll, store listener, and node is the caller's scope.
 */
export function mountServiceActionCta(scope: DisposableScope, options: ServiceActionCtaOptions): void {
  if (scope.isDisposed) return;

  const host = document.createElement('div');
  host.className = SERVICE_ACTION_HOST_CLASS;
  host.setAttribute('aria-live', 'polite');
  host.setAttribute('aria-atomic', 'true');

  const stopPlaybackToggle = (event: Event) => {
    event.stopPropagation();
  };
  scope.listen(host, 'pointerdown', stopPlaybackToggle);
  scope.listen(host, 'mousedown', stopPlaybackToggle);
  scope.listen(host, 'pointerup', stopPlaybackToggle);
  scope.listen(host, 'mouseup', stopPlaybackToggle);
  scope.listen(host, 'dblclick', (event: Event) => {
    event.stopPropagation();
    event.stopImmediatePropagation();
  });
  scope.listen(host, 'click', (event: Event) => {
    event.stopPropagation();
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(`.${SERVICE_ACTION_CLASS}`) : null;
    if (!button) return;
    const id = button.dataset.serviceActionId || '';
    if (!id) return;
    try {
      options.source.activate(id);
    } catch {
      // The provider rejected the click. The next read drops a stale label.
    }
    sync();
  });

  const place = () => {
    const hidden = options.menuOpen?.() === true;
    if (host.hidden !== hidden) host.hidden = hidden;
    const visible = toolbarOpen();
    if (host.classList.contains(TOOLBAR_VISIBLE_CLASS) !== visible) host.classList.toggle(TOOLBAR_VISIBLE_CLASS, visible);
    if (!visible) return;
    let px = LIFT_FALLBACK_PX;
    try {
      const lift = options.controlsLift();
      if (Number.isFinite(lift) && lift > 0) px = Math.round(lift);
    } catch {
      px = LIFT_FALLBACK_PX;
    }
    if (host.style.getPropertyValue(LIFT_VAR) !== `${px}px`) host.style.setProperty(LIFT_VAR, `${px}px`);
  };

  const toolbarOpen = (): boolean => {
    try {
      return options.toolbarVisible() === true;
    } catch {
      return false;
    }
  };

  const buttons = new Map<string, HTMLButtonElement>();
  const progressNodes = new Map<string, HTMLElement>();
  const progressing = new Set<string>();
  const paintProgress = (id: string, value: number) => {
    const node = progressNodes.get(id);
    const transform = `scaleX(${Math.max(0, Math.min(1, value))})`;
    if (node && node.style.transform !== transform) node.style.transform = transform;
  };
  const render = (actions: ServiceAction[]) => {
    const ids = new Set(actions.map(action => action.id));
    for (const [id, button] of buttons) {
      if (!ids.has(id)) { button.remove(); buttons.delete(id); progressNodes.delete(id); }
    }
    actions.forEach((action, index) => {
      let button = buttons.get(action.id);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = SERVICE_ACTION_CLASS;
        button.dataset.serviceActionId = action.id;
        const label = document.createElement('span');
        label.className = 'theater-service-action-label';
        const progress = document.createElement('span');
        progress.className = 'theater-service-action-progress';
        progress.setAttribute('aria-hidden', 'true');
        button.append(progress, label);
        buttons.set(action.id, button);
        progressNodes.set(action.id, progress);
      }
      const label = button.querySelector('.theater-service-action-label')!;
      if (label.textContent !== action.label) label.textContent = action.label;
      const progress = button.querySelector<HTMLElement>('.theater-service-action-progress')!;
      progress.hidden = action.progress === undefined;
      if (action.progress !== undefined) paintProgress(action.id, action.progress);
      // Reordering only when needed preserves focus and the host countdown.
      if (host.children[index] !== button) host.insertBefore(button, host.children[index] || null);
    });
  };

  let animationFrame = 0;
  let currentActions: ServiceAction[] = [];
  const animate = () => {
    animationFrame = 0;
    if (scope.isDisposed || document.hidden || host.hidden || !options.source.readProgress) return;
    for (const id of progressing) {
      let value: number | null | undefined;
      try { value = options.source.readProgress(id); } catch { value = null; }
      if (typeof value === 'number' && Number.isFinite(value)) {
        paintProgress(id, value);
        if (value >= 1) progressing.delete(id);
      } else {
        progressing.delete(id);
        if (value === null) refresh.request();
      }
    }
    if (progressing.size) animationFrame = window.requestAnimationFrame(animate);
  };
  const syncAnimation = () => {
    window.cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    progressing.clear();
    for (const action of currentActions) if (action.progress !== undefined && action.progress < 1) progressing.add(action.id);
    if (!scope.isDisposed && !document.hidden && !host.hidden && progressing.size && options.source.readProgress) animate();
  };
  let layoutKey = '';
  const notifyLayout = (actions: ServiceAction[]) => {
    const key = `${host.hidden ? 1 : 0}:${actions.map(action => action.id).join('\n')}`;
    if (key === layoutKey) return;
    layoutKey = key;
    try {
      options.onLayout?.();
    } catch {
      // Caption placement is independent of the action list.
    }
  };
  const sync = () => {
    if (scope.isDisposed) return;
    try {
      place();
      const actions = readActions(options.source);
      currentActions = actions;
      render(actions);
      notifyLayout(actions);
      syncAnimation();
    } catch {
      currentActions = [];
      render([]);
      notifyLayout([]);
      syncAnimation();
    }
  };

  // Subscribed providers own their bounded fallback as well as DOM events.
  const refresh = createVisibleRefresh(document, sync, {
    active: () => !options.source.subscribe, pollMs: options.pollMs ?? DEFAULT_POLL_MS
  });
  scope.add(() => {
    refresh.dispose();
    window.cancelAnimationFrame(animationFrame);
    const occupied = buttons.size > 0;
    host.remove();
    buttons.clear();
    progressNodes.clear();
    progressing.clear();
    if (occupied) notifyLayout([]);
  });
  options.paint?.(host);
  options.mount(host);
  scope.add(options.subscribeToolbar(() => {
    options.paint?.(host);
    place();
    notifyLayout(currentActions);
    syncAnimation();
  }));
  if (options.subscribeVisibility) scope.add(options.subscribeVisibility(() => {
    place(); notifyLayout(currentActions); syncAnimation();
  }));
  if (options.source.subscribe) scope.add(options.source.subscribe(refresh.request));
  scope.listen(document, 'visibilitychange', syncAnimation);
  refresh.refresh();
}

function readActions(source: ServiceActionSource): ServiceAction[] {
  try {
    const seen = new Set<string>();
    return source.read().slice(0, 4).flatMap(action => {
      if (!action || typeof action.id !== 'string' || !action.id || seen.has(action.id) || typeof action.label !== 'string') return [];
      const label = action.label.replace(/\s+/g, ' ').trim();
      if (!label) return [];
      seen.add(action.id);
      const progress = typeof action.progress === 'number' && Number.isFinite(action.progress)
        ? Math.max(0, Math.min(1, action.progress)) : undefined;
      return [{ id: action.id, label: label.slice(0, 80), ...(progress === undefined ? {} : { progress }) }];
    });
  } catch {
    return [];
  }
}
