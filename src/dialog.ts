import { t } from './i18n';
import { languageRuntime } from './i18n-runtime';
import { createModal, type ModalAction, type ModalOptions, type ModalContent } from './ui/modal';

export type DialogActionSet =
  | { type: 'acknowledge'; label?: string }
  | { type: 'choice'; trueLabel?: string; falseLabel?: string; initialFocus?: 'confirm' | 'cancel' };

export interface OpenDialogOptions extends Pick<ModalOptions, 'mount' | 'signal'> {
  title: string;
  content: string | Node;
  note?: Node;
  size?: 'default' | 'wide';
  scrollable?: boolean;
  actions: DialogActionSet;
  setup?: (overlay: HTMLElement, dialog: HTMLElement) => void;
}

function modalCopy(options: OpenDialogOptions): ModalContent {
  const actions: ModalAction[] = options.actions.type === 'acknowledge'
    ? [{ label: options.actions.label || t('dialogAcknowledge'), kind: 'primary', value: true }]
    : [{ label: options.actions.falseLabel || t('dialogChoiceFalse'), kind: 'secondary', value: false },
      { label: options.actions.trueLabel || t('dialogChoiceTrue'), kind: 'primary', value: true }];
  return { title: options.title, closeLabel: t('dialogClose'), content: options.content, note: options.note, actions };
}

/** Page-dialog copy and result semantics; the shared modal owns all DOM and behavior. */
export function openDialog(source: OpenDialogOptions | (() => OpenDialogOptions)): Promise<boolean> {
  const options = typeof source === 'function' ? source() : source;
  const modal = createModal({
    ...modalCopy(options),
    mount: options.mount,
    signal: options.signal,
    size: options.size,
    scrollable: options.scrollable,
    initialFocus: options.actions.type === 'choice' && options.actions.initialFocus === 'cancel' ? 0 : undefined,
    dismissValue: options.actions.type === 'acknowledge'
  });
  options.setup?.(modal.overlay, modal.dialog);
  const stopLanguageRendering = languageRuntime.subscribe(() => {
    // Snapshot copy cannot safely confirm an action after the language changes.
    if (typeof source !== 'function') { modal.close(false); return; }
    modal.update(modalCopy(source()));
  });
  return modal.closed.finally(stopLanguageRendering);
}
