import { isMotionReduced } from './appearance-runtime';
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

/** A copy factory keeps an open dialog localized without losing its action or focus. */
export function openDialog(source: OpenDialogOptions | (() => OpenDialogOptions)): Promise<boolean> {
  const options = typeof source === 'function' ? source() : source;
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
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'te-dialog-close';
    closeButton.setAttribute('aria-label', t('dialogClose'));
    closeButton.textContent = '×';
    closeButton.addEventListener('click', () => close(dismissValue));
    header.append(title, closeButton);

    const body = document.createElement('div');
    body.id = `${titleId}-body`;
    body.className = 'te-dialog-body';
    // Plain text is the dialog's description; a caller-built node owns its own semantics.
    const setBodyContent = (content: string | Node): void => {
      if (typeof content === 'string') {
        const paragraph = document.createElement('p');
        paragraph.textContent = content;
        body.replaceChildren(paragraph);
        dialog.setAttribute('aria-describedby', body.id);
      } else {
        body.replaceChildren(content);
        dialog.removeAttribute('aria-describedby');
      }
    };
    setBodyContent(options.content);

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
      else window.setTimeout(finish, isMotionReduced() ? 0 : 160);
    };

    const onOverlayPointerDown = (event: PointerEvent): void => {
      if (event.target === overlay) {
        close(dismissValue);
      }
    };

    const stopLanguageRendering = languageRuntime.subscribe(() => {
      // Callers with snapshot copy still cancel rather than show a stale confirmation.
      if (typeof source !== 'function') { close(false, true); return; }
      const copy = source();
      title.textContent = copy.title;
      closeButton.setAttribute('aria-label', t('dialogClose'));
      setBodyContent(copy.content);
      if (copy.actions.type === 'acknowledge') {
        buttons[0].textContent = copy.actions.label || t('dialogAcknowledge');
      } else {
        buttons[0].textContent = copy.actions.falseLabel || t('dialogChoiceFalse');
        buttons[1].textContent = copy.actions.trueLabel || t('dialogChoiceTrue');
      }
    });
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
