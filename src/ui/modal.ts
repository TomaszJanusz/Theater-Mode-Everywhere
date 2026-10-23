import { activeElementDeep, containModalFocus } from '../accessibility';
import { matchesShortcut } from './shortcuts';

export interface ModalAction {
  label: string;
  kind: 'primary' | 'secondary';
  /** Omit to keep the modal open (for example, Reset). */
  value?: boolean;
  run?: () => void;
}

export interface ModalContent {
  title: string;
  closeLabel: string;
  content: string | Node;
  /** Fixed content above the actions, outside the shared scrolling body. */
  note?: Node;
  actions?: ModalAction[];
}

export interface ModalOptions extends ModalContent {
  size?: 'default' | 'wide' | 'large';
  scrollable?: boolean;
  mount?: (overlay: HTMLElement) => void;
  decorate?: (overlay: HTMLElement) => void;
  dismissValue?: boolean;
  initialFocus?: 'close' | number;
  /** An invocation shortcut can toggle its modal, using the same dismissal path. */
  dismissShortcut?: string;
  returnFocus?: () => HTMLElement | null;
  signal?: AbortSignal;
  onClose?: () => void;
}

export interface Modal {
  overlay: HTMLElement;
  dialog: HTMLElement;
  readonly isOpen: boolean;
  closed: Promise<boolean>;
  update: (content: ModalContent) => void;
  close: (value?: boolean, restoreFocus?: boolean) => void;
  dispose: () => void;
}

let activeModal: Modal | null = null;
let titleSequence = 0;

/** The sole modal shell and lifecycle, for page DOM and player shadow DOM alike. */
export function createModal(options: ModalOptions): Modal {
  // A stale, already-cancelled request must not dismiss the current modal.
  if (!options.signal?.aborted) activeModal?.close(false);
  const previousFocus = activeElementDeep();
  const events = new AbortController();
  const overlay = document.createElement('div');
  overlay.className = 'te-dialog-overlay';
  const dialog = document.createElement('div');
  dialog.className = 'te-dialog';
  dialog.dataset.size = options.size ?? 'default';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  if (options.dismissShortcut) dialog.dataset.dismissShortcut = options.dismissShortcut;
  const header = document.createElement('div');
  header.className = 'te-dialog-header';
  const title = document.createElement('h2');
  title.className = 'te-dialog-title';
  title.id = `te-dialog-title-${++titleSequence}`;
  dialog.setAttribute('aria-labelledby', title.id);
  const closeButton = createCloseButton();
  header.append(title, closeButton);
  const body = document.createElement('div');
  body.className = 'te-dialog-body';
  body.id = `${title.id}-body`;
  if (options.scrollable) body.tabIndex = 0;
  const note = document.createElement('div');
  note.className = 'te-dialog-note';
  const footer = document.createElement('div');
  footer.className = 'te-dialog-footer';
  dialog.append(header, body, note, footer);
  overlay.append(dialog);
  let settled = false;
  let releaseFocus: ((restoreFocus?: boolean) => void) | undefined;
  let observer: MutationObserver | undefined;
  let unlockScroll: (() => void) | undefined;
  let resolveClosed: (value: boolean) => void;
  const closed = new Promise<boolean>(resolve => { resolveClosed = resolve; });

  const close = (value = options.dismissValue ?? false, restoreFocus = true): void => {
    if (settled) return;
    settled = true;
    if (activeModal === modal) activeModal = null;
    events.abort();
    observer?.disconnect();
    releaseFocus?.(false);
    unlockScroll?.();
    overlay.remove();
    const target = options.returnFocus ? options.returnFocus() : previousFocus;
    if (restoreFocus && target?.isConnected && target.getClientRects().length
        && !target.closest('[inert]') && getComputedStyle(target).visibility !== 'hidden') target.focus();
    try { options.onClose?.(); } finally { resolveClosed(value); }
  };
  const update = (copy: ModalContent): void => {
    if (settled) return;
    title.textContent = copy.title;
    closeButton.setAttribute('aria-label', copy.closeLabel);
    if (typeof copy.content === 'string') {
      const paragraph = document.createElement('p');
      paragraph.textContent = copy.content;
      body.replaceChildren(paragraph);
      dialog.setAttribute('aria-describedby', body.id);
    } else {
      body.replaceChildren(copy.content);
      dialog.removeAttribute('aria-describedby');
    }
    note.replaceChildren(...(copy.note ? [copy.note] : []));
    note.hidden = !copy.note;
    // Preserve action identity and focus during live language updates.
    const actions = copy.actions ?? [];
    while (footer.children.length > actions.length) footer.lastElementChild?.remove();
    actions.forEach((action, index) => {
      const existing = footer.children.item(index);
      const button = existing instanceof HTMLButtonElement ? existing : document.createElement('button');
      button.type = 'button';
      if (!button.parentNode) footer.append(button);
      button.className = `te-dialog-btn te-dialog-btn-${action.kind}`;
      button.textContent = action.label;
      button.onclick = () => {
        if (settled) return;
        action.run?.();
        if (action.value !== undefined) close(action.value);
      };
    });
    footer.hidden = actions.length === 0;
  };
  const modal: Modal = { overlay, dialog, get isOpen() { return !settled; }, closed, update, close, dispose: () => close(false, false) };
  update(options);
  closeButton.addEventListener('click', () => close(), { signal: events.signal });
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  }, { signal: events.signal });
  // Native controls retain their defaults; keys never bubble into host shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    overlay.addEventListener(type, event => event.stopPropagation(), { signal: events.signal });
  }
  options.signal?.addEventListener('abort', modal.dispose, { once: true, signal: events.signal });
  window.addEventListener('pagehide', modal.dispose, { once: true, signal: events.signal });
  if (options.signal?.aborted) { modal.dispose(); return modal; }
  options.decorate?.(overlay);
  (options.mount ?? (element => document.body.append(element)))(overlay);
  activeModal = modal;
  unlockScroll = lockScroll();
  releaseFocus = containModalFocus(dialog, () => close());
  const dismissShortcut = options.dismissShortcut;
  if (dismissShortcut) document.addEventListener('keydown', event => {
    if (!matchesShortcut(event, dismissShortcut)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    close();
  }, { capture: true, signal: events.signal });
  // Observe direct removals along the mounted branch, including the shadow host.
  // Explicit player teardown disposes synchronously; this also handles host removals.
  observer = new MutationObserver(() => { if (!overlay.isConnected) modal.dispose(); });
  let branch: Node = overlay;
  while (branch.parentNode) {
    const parent = branch.parentNode;
    observer.observe(parent, { childList: true });
    branch = parent instanceof ShadowRoot ? parent.host : parent;
  }
  const initial = options.initialFocus === 'close' ? closeButton
    : footer.children[options.initialFocus ?? footer.children.length - 1];
  (initial instanceof HTMLElement ? initial : closeButton).focus();
  return modal;
}

/** Called before the player root is removed, so no pending modal survives exit. */
export function disposeModalIn(root: ParentNode): void {
  if (activeModal && root.contains(activeModal.overlay)) activeModal.dispose();
}

function lockScroll(): () => void {
  const body = document.body;
  const overflow = body.style.getPropertyValue('overflow');
  const priority = body.style.getPropertyPriority('overflow');
  const hadClass = body.classList.contains('te-dialog-open');
  body.style.setProperty('overflow', 'hidden', 'important');
  body.classList.add('te-dialog-open');
  return () => {
    if (overflow) body.style.setProperty('overflow', overflow, priority);
    else body.style.removeProperty('overflow');
    body.classList.toggle('te-dialog-open', hadClass);
  };
}

function createCloseButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'te-dialog-close';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none',
    stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) {
    svg.setAttribute(key, value);
  }
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M18 6 6 18M6 6l12 12');
  svg.append(path);
  button.append(svg);
  return button;
}
