import type { DisposableScope } from '../core/disposable-scope';

/**
 * Time-sensitive host actions, identified so a later poll or click can
 * refuse a replaced control. Providers own discovery; this module only
 * shows the label and asks the provider to activate that id.
 */
export type ServiceAction = {
  id: string;
  label: string;
  progress?: number;
};

export type ServiceActionSource = {
  read(): ServiceAction[];
  activate(id: string): boolean;
};

export type ServiceActionCtaOptions = {
  source: ServiceActionSource;
  mount: (element: HTMLElement) => void;
  paint?: (element: HTMLElement) => void;
  /** Bar or header chrome is showing, so the CTA sits above the playback bar. */
  toolbarVisible: () => boolean;
  subscribeToolbar: (listener: () => void) => () => void;
  /** Pixels to clear above the 24px screen edge while the bar is visible. */
  controlsLift: () => number;
  menuOpen?: () => boolean;
  pollMs?: number;
};

/** Main-world Space swallow must ignore this class or the button never activates. */
export const SERVICE_ACTION_CLASS = 'theater-service-action';
const SERVICE_ACTION_HOST_CLASS = 'theater-service-action-host';
const TOOLBAR_VISIBLE_CLASS = 'toolbar-visible';
const LIFT_VAR = '--theater-service-action-lift';
const LIFT_FALLBACK_PX = 96;
const DEFAULT_POLL_MS = 200;

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
    host.hidden = options.menuOpen?.() === true;
    const visible = toolbarOpen();
    host.classList.toggle(TOOLBAR_VISIBLE_CLASS, visible);
    if (!visible) return;
    let px = LIFT_FALLBACK_PX;
    try {
      const lift = options.controlsLift();
      if (Number.isFinite(lift) && lift > 0) px = Math.round(lift);
    } catch {
      px = LIFT_FALLBACK_PX;
    }
    host.style.setProperty(LIFT_VAR, `${px}px`);
  };

  const toolbarOpen = (): boolean => {
    try {
      return options.toolbarVisible() === true;
    } catch {
      return false;
    }
  };

  const buttons = new Map<string, HTMLButtonElement>();
  const render = (actions: ServiceAction[]) => {
    const ids = new Set(actions.map(action => action.id));
    for (const [id, button] of buttons) {
      if (!ids.has(id)) { button.remove(); buttons.delete(id); }
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
      }
      const label = button.querySelector('.theater-service-action-label')!;
      if (label.textContent !== action.label) label.textContent = action.label;
      const progress = button.querySelector<HTMLElement>('.theater-service-action-progress')!;
      progress.hidden = action.progress === undefined;
      if (action.progress !== undefined) progress.style.transform = `scaleX(${action.progress})`;
      // Reordering only when needed preserves focus and the host countdown.
      if (host.children[index] !== button) host.insertBefore(button, host.children[index] || null);
    });
  };

  let animationFrame = 0;
  const sync = () => {
    if (scope.isDisposed) return;
    try {
      place();
      const actions = readActions(options.source);
      render(actions);
      if (actions.some(action => action.progress !== undefined && action.progress < 1) && !animationFrame) {
        animationFrame = window.requestAnimationFrame(() => { animationFrame = 0; sync(); });
      }
    } catch {
      render([]);
    }
  };

  let unsubscribe = () => {};
  let timer = 0;
  scope.add(() => {
    window.clearInterval(timer);
    window.cancelAnimationFrame(animationFrame);
    unsubscribe();
    host.remove();
  });
  options.paint?.(host);
  options.mount(host);
  unsubscribe = options.subscribeToolbar(() => {
    options.paint?.(host);
    sync();
  });
  timer = window.setInterval(sync, options.pollMs ?? DEFAULT_POLL_MS);
  sync();
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
