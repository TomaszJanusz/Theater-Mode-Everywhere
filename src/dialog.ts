import { containModalFocus } from './accessibility';
import { t } from './i18n';
import { languageRuntime } from './i18n-runtime';

export type DialogActionSet =
  | { type: 'acknowledge'; label?: string }
  | { type: 'choice'; trueLabel?: string; falseLabel?: string; initialFocus?: 'confirm' | 'cancel' };

export interface OpenDialogOptions {
  title: string;
  content: string | Node;
  actions: DialogActionSet;
  setup?: (overlay: HTMLElement, dialog: HTMLElement) => void;
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

    const overlay = document.createElement('div');
    overlay.className = 'te-dialog-overlay theater-backdrop-dialog';

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
    body.id = `${titleId}-body`;
    if (typeof options.content === 'string') dialog.setAttribute('aria-describedby', body.id);
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
      const acknowledge = createButton(options.actions.label || t('dialogAcknowledge'), 'primary');
      acknowledge.addEventListener('click', () => close(true));
    } else {
      const falseButton = createButton(options.actions.falseLabel || t('dialogChoiceFalse'), 'secondary');
      const trueButton = createButton(options.actions.trueLabel || t('dialogChoiceTrue'), 'primary');
      falseButton.addEventListener('click', () => close(false));
      trueButton.addEventListener('click', () => close(true));
    }

    dialog.append(header, body, footer);
    overlay.appendChild(dialog);
    options.setup?.(overlay, dialog);
    document.body.appendChild(overlay);
    document.body.classList.add('te-dialog-open');

    const dismissValue = options.actions.type === 'acknowledge';
    let settled = false;

    const close = (value: boolean, immediate = false): void => {
      if (settled) return;
      settled = true;
      stopLanguageRendering();
      if (activeDialog?.close === close) {
        activeDialog = null;
      }

      overlay.classList.add('is-leaving');
      document.body.classList.remove('te-dialog-open');
      overlay.removeEventListener('pointerdown', onOverlayPointerDown);
      releaseFocus();
      overlay.inert = true;

      const finish = (): void => {
        overlay.remove();
        resolve(value);
      };

      if (immediate) finish();
      else window.setTimeout(finish, prefersReducedMotion() ? 0 : 160);
    };

    const onOverlayPointerDown = (event: PointerEvent): void => {
      if (event.target === overlay) {
        close(dismissValue);
      }
    };

    // Dialog strings are snapshots. Cancel instead of retaining an old-language confirmation.
    const stopLanguageRendering = languageRuntime.subscribe(() => close(false, true));
    overlay.addEventListener('pointerdown', onOverlayPointerDown);
    const releaseFocus = containModalFocus(dialog, () => close(dismissValue));
    activeDialog = { close };

    requestAnimationFrame(() => {
      if (settled) return;
      const index = options.actions.type === 'choice' && options.actions.initialFocus === 'cancel' ? 0 : buttons.length - 1;
      buttons[index]?.focus();
    });
  });
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
