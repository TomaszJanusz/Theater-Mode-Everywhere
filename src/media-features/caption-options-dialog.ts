import type { CaptionStyle } from './caption-style';
import { applyCaptionStyle, CAPTION_FONT_SCALES, resolveCaptionFontScale } from './caption-style';
import { mountPlayerUi } from '../player-ui-root';

type Translate = (key: string, substitutions?: string | string[]) => string;

/**
 * Mounts the caption-style dialog and reports each user change through `onChange`.
 * The returned promise resolves after the dialog is dismissed or the optional signal aborts.
 */
export async function openCaptionOptionsDialog(options: {
  t: Translate;
  style: CaptionStyle;
  onChange: (style: CaptionStyle) => void;
  decorate?: (overlay: HTMLElement) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const current = { ...options.style };

  const overlay = document.createElement('div');
  overlay.className = 'te-dialog-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'te-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');

  const title = document.createElement('h2');
  title.className = 'te-dialog-title';
  title.textContent = options.t('subtitleOptionsTitle');

  const body = document.createElement('div');
  body.className = 'te-dialog-body';

  const form = document.createElement('div');
  form.className = 'theater-caption-options';

  const preview = document.createElement('div');
  preview.className = 'theater-caption-options-preview';
  const previewText = document.createElement('div');
  previewText.className = 'theater-caption-overlay-text';
  previewText.textContent = options.t('subtitlePreviewSample');
  preview.appendChild(previewText);
  form.appendChild(preview);

  const paintPreview = (): void => {
    applyCaptionStyle(preview, current);
  };
  paintPreview();

  const commit = (): void => {
    paintPreview();
    options.onChange({ ...current });
  };

  form.appendChild(colorRow(options.t('subtitleTextColor'), current.textColor, (value) => {
    current.textColor = value;
    commit();
  }));
  form.appendChild(captionSizeRow(options.t('subtitleSize'), current.fontScale, (value) => {
    current.fontScale = value;
    commit();
  }));
  form.appendChild(toggleRow(options.t('subtitleDropShadow'), current.dropShadow, (value) => {
    current.dropShadow = value;
    commit();
  }));
  form.appendChild(colorRow(options.t('subtitleBackground'), current.backgroundColor, (value) => {
    current.backgroundColor = value;
    commit();
  }));
  form.appendChild(sliderRow(options.t('subtitleOpacity'), current.backgroundOpacity, 0, 1, 0.05, (value) => {
    current.backgroundOpacity = value;
    commit();
  }));
  body.appendChild(form);

  const footer = document.createElement('div');
  footer.className = 'te-dialog-footer';
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'te-dialog-btn te-dialog-btn-primary';
  done.textContent = options.t('dialogDone');
  footer.appendChild(done);

  dialog.append(title, body, footer);
  overlay.appendChild(dialog);
  options.decorate?.(overlay);
  mountPlayerUi(overlay);
  document.body.classList.add('te-dialog-open');
  done.focus();

  await new Promise<void>((resolve) => {
    let settled = false;
    const close = (): void => {
      if (settled) return;
      settled = true;
      overlay.removeEventListener('pointerdown', onOverlay);
      document.removeEventListener('keydown', onKeyDown, true);
      options.signal?.removeEventListener('abort', onAbort);
      document.body.classList.remove('te-dialog-open');
      overlay.remove();
      resolve();
    };
    const onOverlay = (event: PointerEvent): void => {
      if (event.target === overlay) close();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    const onAbort = (): void => {
      close();
    };
    overlay.addEventListener('pointerdown', onOverlay);
    document.addEventListener('keydown', onKeyDown, true);
    done.addEventListener('click', close, { once: true });
    if (options.signal?.aborted) {
      close();
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function captionSizeRow(label: string, value: number, onChange: (value: number) => void): HTMLElement {
  const row = optionRow(label);
  row.classList.add('theater-caption-size-row');

  const control = document.createElement('div');
  control.className = 'theater-caption-size-control';
  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'theater-caption-slider';
  input.min = '0';
  input.max = String(CAPTION_FONT_SCALES.length - 1);
  input.step = '1';
  input.value = String(CAPTION_FONT_SCALES.indexOf(resolveCaptionFontScale(value) as typeof CAPTION_FONT_SCALES[number]));
  input.setAttribute('aria-label', label);
  input.addEventListener('input', () => onChange(CAPTION_FONT_SCALES[Number(input.value)]));

  const marks = document.createElement('div');
  marks.className = 'theater-caption-size-marks';
  CAPTION_FONT_SCALES.forEach((scale) => {
    const mark = document.createElement('span');
    mark.textContent = `${scale * 100}%`;
    marks.appendChild(mark);
  });

  control.append(input, marks);
  row.appendChild(control);
  return row;
}

function colorRow(label: string, value: string, onChange: (value: string) => void): HTMLElement {
  const row = optionRow(label);
  const input = document.createElement('input');
  input.type = 'color';
  input.className = 'theater-caption-color';
  input.value = value;
  input.addEventListener('input', () => onChange(input.value));
  row.appendChild(input);
  return row;
}

function sliderRow(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (value: number) => void
): HTMLElement {
  const row = optionRow(label);
  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'theater-caption-slider';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('input', () => onChange(Number(input.value)));
  row.appendChild(input);
  return row;
}

function toggleRow(label: string, value: boolean, onChange: (value: boolean) => void): HTMLElement {
  const row = optionRow(label);
  const toggle = document.createElement('label');
  toggle.className = 'theater-caption-toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = value;
  const slider = document.createElement('span');
  slider.className = 'theater-caption-toggle-track';
  input.addEventListener('change', () => onChange(input.checked));
  toggle.append(input, slider);
  row.appendChild(toggle);
  return row;
}

function optionRow(label: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'theater-caption-option-row';
  const text = document.createElement('span');
  text.className = 'theater-caption-option-label';
  text.textContent = label;
  row.appendChild(text);
  return row;
}
