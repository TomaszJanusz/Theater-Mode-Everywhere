export type DialogActionSet =
  | { type: 'acknowledge'; label?: string }
  | { type: 'choice'; trueLabel?: string; falseLabel?: string };

export interface OpenDialogOptions {
  title: string;
  content: string | Node;
  actions: DialogActionSet;
}

interface ActiveDialog {
  close: (value: boolean) => void;
}

let activeDialog: ActiveDialog | null = null;
let dialogTitleSeq = 0;

export function openDialog(options: OpenDialogOptions): Promise<boolean> {
  if (activeDialog) {
    activeDialog.close(false);
  }

  return new Promise((resolve) => {
    const titleId = `te-dialog-title-${++dialogTitleSeq}`;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const overlay = document.createElement('div');
    overlay.className = 'te-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'te-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', titleId);

    const header = document.createElement('div');
    header.className = 'te-dialog-header';

    const title = document.createElement('h2');
    title.id = titleId;
    title.className = 'te-dialog-title';
    title.textContent = options.title;
    header.appendChild(title);

    const body = document.createElement('div');
    body.className = 'te-dialog-body';
    if (typeof options.content === 'string') {
      const paragraph = document.createElement('p');
      paragraph.textContent = options.content;
      body.appendChild(paragraph);
    } else {
      body.appendChild(options.content);
    }

    const footer = document.createElement('div');
    footer.className = 'te-dialog-footer';

    const buttons: HTMLButtonElement[] = [];

    const createButton = (label: string, kind: 'primary' | 'secondary'): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = kind === 'primary' ? 'te-dialog-btn te-dialog-btn-primary' : 'te-dialog-btn te-dialog-btn-secondary';
      button.textContent = label;
      footer.appendChild(button);
      buttons.push(button);
      return button;
    };

    if (options.actions.type === 'acknowledge') {
      const acknowledge = createButton(options.actions.label || 'OK', 'primary');
      acknowledge.addEventListener('click', () => close(true));
    } else {
      const falseButton = createButton(options.actions.falseLabel || 'No', 'secondary');
      const trueButton = createButton(options.actions.trueLabel || 'Yes', 'primary');
      falseButton.addEventListener('click', () => close(false));
      trueButton.addEventListener('click', () => close(true));
    }

    dialog.append(header, body, footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    document.body.classList.add('te-dialog-open');

    const dismissValue = options.actions.type === 'acknowledge';
    let settled = false;

    const close = (value: boolean): void => {
      if (settled) return;
      settled = true;
      if (activeDialog?.close === close) {
        activeDialog = null;
      }

      overlay.classList.add('is-leaving');
      document.body.classList.remove('te-dialog-open');
      overlay.removeEventListener('pointerdown', onOverlayPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);

      const finish = (): void => {
        overlay.remove();
        previousFocus?.focus();
        resolve(value);
      };

      window.setTimeout(finish, prefersReducedMotion() ? 0 : 160);
    };

    const onOverlayPointerDown = (event: PointerEvent): void => {
      if (event.target === overlay) {
        close(dismissValue);
      }
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(dismissValue);
        return;
      }

      if (event.key !== 'Tab' || buttons.length === 0) {
        return;
      }

      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      const focused = document.activeElement;

      if (event.shiftKey && focused === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && focused === last) {
        event.preventDefault();
        first.focus();
      }
    };

    overlay.addEventListener('pointerdown', onOverlayPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    activeDialog = { close };

    requestAnimationFrame(() => {
      buttons[buttons.length - 1]?.focus();
    });
  });
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
