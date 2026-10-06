import type { DisposableScope } from '../core/disposable-scope';

/**
 * One time-sensitive host action, identified so a later poll or click can
 * refuse a replaced control. Providers own discovery; this module only
 * shows the label and asks the provider to activate that id.
 */
export type ServiceAction = {
  id: string;
  label: string;
};

export type ServiceActionSource = {
  read(): ServiceAction | null;
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
  pollMs?: number;
};

/** Main-world Space swallow must ignore this class or the button never activates. */
export const SERVICE_ACTION_CLASS = 'theater-service-action';
const SERVICE_ACTION_HOST_CLASS = 'theater-service-action-host';
const TOOLBAR_VISIBLE_CLASS = 'toolbar-visible';
const LIFT_VAR = '--theater-service-action-lift';
const LIFT_FALLBACK_PX = 96;
const DEFAULT_POLL_MS = 400;

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

  const button = document.createElement('button');
  button.type = 'button';
  button.className = SERVICE_ACTION_CLASS;

  const stopPlaybackToggle = (event: Event) => {
    event.stopPropagation();
  };
  scope.listen(button, 'pointerdown', stopPlaybackToggle);
  scope.listen(button, 'mousedown', stopPlaybackToggle);
  scope.listen(button, 'pointerup', stopPlaybackToggle);
  scope.listen(button, 'mouseup', stopPlaybackToggle);
  scope.listen(button, 'dblclick', (event: Event) => {
    event.stopPropagation();
    event.stopImmediatePropagation();
  });
  scope.listen(button, 'click', (event: Event) => {
    event.stopPropagation();
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

  const render = (action: ServiceAction | null) => {
    if (!action) {
      button.remove();
      button.textContent = '';
      delete button.dataset.serviceActionId;
      return;
    }
    if (button.dataset.serviceActionId !== action.id) button.dataset.serviceActionId = action.id;
    if (button.textContent !== action.label) button.textContent = action.label;
    if (!button.isConnected) host.append(button);
  };

  const sync = () => {
    if (scope.isDisposed) return;
    try {
      place();
      render(readAction(options.source));
    } catch {
      render(null);
    }
  };

  let unsubscribe = () => {};
  let timer = 0;
  scope.add(() => {
    window.clearInterval(timer);
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

function readAction(source: ServiceActionSource): ServiceAction | null {
  try {
    const action = source.read();
    if (!action || typeof action.id !== 'string' || action.id.length === 0) return null;
    if (typeof action.label !== 'string') return null;
    const label = action.label.replace(/\s+/g, ' ').trim();
    if (!label) return null;
    return { id: action.id, label: label.slice(0, 80) };
  } catch {
    return null;
  }
}
