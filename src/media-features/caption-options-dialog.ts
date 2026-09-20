import type { CaptionStyle } from './caption-style';
import {
  applyCaptionStyle,
  CAPTION_BACKGROUND_COLORS,
  CAPTION_FONT_PRESETS,
  CAPTION_FONT_SCALES,
  CAPTION_TEXT_COLORS,
  DEFAULT_CAPTION_STYLE,
  resolveCaptionFontScale,
  type CaptionFontPreset
} from './caption-style';
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
  dialog.className = 'te-dialog theater-caption-options-dialog';
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
  const paintPreview = (): void => {
    applyCaptionStyle(preview, current);
  };
  paintPreview();

  const commit = (): void => {
    paintPreview();
    options.onChange({ ...current });
  };

  const renderOptions = (): void => {
    form.replaceChildren(preview);
    form.appendChild(fontPresetRow(options.t('subtitleFont'), current.fontPreset, (value) => {
      current.fontPreset = value;
      commit();
    }));
    form.appendChild(paletteRow({
      label: options.t('subtitleTextColor'),
      opacityLabel: options.t('subtitleOpacity'),
      value: current.textColor,
      opacity: current.textOpacity,
      colors: CAPTION_TEXT_COLORS,
      onColorChange: (value) => {
        current.textColor = value;
        commit();
      },
      onOpacityChange: (value) => {
        current.textOpacity = value;
        commit();
      }
    }));
    form.appendChild(captionSizeRow(options.t('subtitleSize'), current.fontScale, (value) => {
      current.fontScale = value;
      commit();
    }));
    form.appendChild(shadowRow(
      options.t('subtitleDropShadow'),
      options.t('subtitleOpacity'),
      current.dropShadow,
      current.shadowOpacity,
      (value) => {
        current.dropShadow = value;
        commit();
      },
      (value) => {
        current.shadowOpacity = value;
        commit();
      }
    ));
    form.appendChild(paletteRow({
      label: options.t('subtitleBackground'),
      opacityLabel: options.t('subtitleOpacity'),
      value: current.backgroundColor,
      opacity: current.backgroundOpacity,
      colors: CAPTION_BACKGROUND_COLORS,
      compact: true,
      onColorChange: (value) => {
        current.backgroundColor = value;
        commit();
      },
      onOpacityChange: (value) => {
        current.backgroundOpacity = value;
        commit();
      }
    }));
  };
  renderOptions();
  body.appendChild(form);

  const footer = document.createElement('div');
  footer.className = 'te-dialog-footer theater-caption-options-footer';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'te-dialog-btn te-dialog-btn-secondary';
  reset.textContent = options.t('resetToDefault');
  reset.addEventListener('click', () => {
    Object.assign(current, DEFAULT_CAPTION_STYLE);
    commit();
    renderOptions();
    reset.focus();
  });
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'te-dialog-btn te-dialog-btn-primary';
  done.textContent = options.t('dialogDone');
  footer.append(reset, done);

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

function fontPresetRow(
  label: string,
  value: CaptionFontPreset,
  onChange: (value: CaptionFontPreset) => void
): HTMLElement {
  const row = optionRow(label);
  row.classList.add('theater-caption-option-stack');
  const choices = document.createElement('div');
  choices.className = 'theater-caption-font-choices';
  const buttons: HTMLButtonElement[] = [];
  CAPTION_FONT_PRESETS.forEach((preset, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theater-caption-font-choice';
    button.textContent = 'Aa';
    button.style.fontFamily = preset.family;
    button.setAttribute('aria-label', `${label} ${index + 1}`);
    button.setAttribute('aria-pressed', String(preset.id === value));
    button.classList.toggle('active', preset.id === value);
    button.addEventListener('click', () => {
      buttons.forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle('active', active);
        candidate.setAttribute('aria-pressed', String(active));
      });
      onChange(preset.id);
    });
    buttons.push(button);
    choices.appendChild(button);
  });
  row.appendChild(choices);
  return row;
}

function paletteRow(options: {
  label: string;
  opacityLabel: string;
  value: string;
  opacity: number;
  colors: readonly string[];
  compact?: boolean;
  onColorChange: (value: string) => void;
  onOpacityChange: (value: number) => void;
}): HTMLElement {
  const row = optionRow(options.label);
  row.classList.add('theater-caption-option-stack');
  row.classList.toggle('theater-caption-palette-row-compact', options.compact === true);
  const palette = document.createElement('div');
  palette.className = 'theater-caption-palette';
  const swatches: HTMLButtonElement[] = [];
  options.colors.forEach((color, index) => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'theater-caption-swatch';
    swatch.style.setProperty('--swatch-color', color);
    swatch.setAttribute('aria-label', `${options.label} ${index + 1}`);
    swatch.setAttribute('aria-pressed', String(color === options.value));
    swatch.classList.toggle('active', color === options.value);
    swatch.addEventListener('click', () => {
      swatches.forEach((candidate) => {
        const active = candidate === swatch;
        candidate.classList.toggle('active', active);
        candidate.setAttribute('aria-pressed', String(active));
      });
      options.onColorChange(color);
    });
    swatches.push(swatch);
    palette.appendChild(swatch);
  });
  row.append(palette, opacityControl(options.opacityLabel, options.opacity, options.onOpacityChange));
  return row;
}

function opacityControl(label: string, value: number, onChange: (value: number) => void): HTMLElement {
  const control = document.createElement('div');
  control.className = 'theater-caption-opacity-control';
  const header = document.createElement('div');
  header.className = 'theater-caption-opacity-header';
  const text = document.createElement('span');
  text.textContent = label;
  const output = document.createElement('output');
  output.textContent = `${Math.round(value * 100)}%`;
  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'theater-caption-slider';
  input.min = '0';
  input.max = '1';
  input.step = '0.05';
  input.value = String(value);
  input.setAttribute('aria-label', label);
  input.addEventListener('input', () => {
    const next = Number(input.value);
    output.textContent = `${Math.round(next * 100)}%`;
    onChange(next);
  });
  header.append(text, output);
  control.append(header, input);
  return control;
}

function shadowRow(
  label: string,
  opacityLabel: string,
  enabled: boolean,
  opacity: number,
  onToggle: (value: boolean) => void,
  onOpacityChange: (value: number) => void
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'theater-caption-option-row theater-caption-option-stack theater-caption-shadow-row';
  const header = document.createElement('div');
  header.className = 'theater-caption-shadow-header';
  const text = document.createElement('span');
  text.className = 'theater-caption-option-label';
  text.textContent = label;
  const toggle = document.createElement('label');
  toggle.className = 'theater-caption-toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = enabled;
  const slider = document.createElement('span');
  slider.className = 'theater-caption-toggle-track';
  input.addEventListener('change', () => onToggle(input.checked));
  toggle.append(input, slider);
  header.append(text, toggle);
  row.append(header, opacityControl(opacityLabel, opacity, onOpacityChange));
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
