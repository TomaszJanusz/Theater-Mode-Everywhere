/** Choice lists Settings and the setup share, so both offer the same values with the same names. */
import { ACCENT_COLOR_OPTIONS, type AccentColorPreset } from '../src/accentTheme';
import { t } from '../src/i18n';
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from '../src/language';
import type { PictureAlign } from '../src/ui/picture-align-settings';

import type { ChoiceOption } from './choice-grid';
import type { ComboboxOption } from './combobox';

export const accentName = (preset: AccentColorPreset): string => t(`accentColor${preset[0].toUpperCase()}${preset.slice(1)}`);

export const accentChoices = (): ChoiceOption<AccentColorPreset>[] => ACCENT_COLOR_OPTIONS.map(option => ({
  value: option.preset,
  label: () => accentName(option.preset),
  ariaLabel: () => t('useAccentColor', accentName(option.preset)),
  swatch: { color: option.swatch, system: option.preset === 'system' }
}));

/** Automatic, then every catalog in its own name and direction. */
export const languageChoices = (): ComboboxOption<Language>[] => [
  { value: DEFAULT_LANGUAGE, label: () => t('languageAutomatic') },
  ...LANGUAGES.map(({ locale, name }) => ({
    value: locale, label: () => name, lang: locale.replace('_', '-'), dir: locale === 'ar' ? 'rtl' as const : 'ltr' as const
  }))
];

export const languageName = (language: Language): string =>
  LANGUAGES.find(({ locale }) => locale === language)?.name ?? t('languageAutomatic');

export const PICTURE_ALIGN_COPY: Record<PictureAlign, { name: string; description: string }> = {
  top: { name: 'pictureAlignTop', description: 'pictureAlignTopDescription' },
  center: { name: 'pictureAlignCenter', description: 'pictureAlignCenterDescription' }
};

/** A screen with the picture where the layout puts it, and the subtitle band under a raised one. */
export function pictureAlignIcon(doc: Document, align: PictureAlign): SVGSVGElement {
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', '0 0 160 132');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('picture-align-icon');

  const bezel = doc.createElementNS(svgNs, 'rect');
  bezel.setAttribute('x', '10');
  bezel.setAttribute('y', '10');
  bezel.setAttribute('width', '140');
  bezel.setAttribute('height', '112');
  bezel.setAttribute('rx', '10');
  bezel.setAttribute('fill', 'none');
  bezel.setAttribute('stroke', 'currentColor');
  bezel.setAttribute('stroke-width', '2');

  const stage = doc.createElementNS(svgNs, 'rect');
  stage.setAttribute('x', '14');
  stage.setAttribute('y', '14');
  stage.setAttribute('width', '132');
  stage.setAttribute('height', '104');
  stage.setAttribute('rx', '6');
  stage.setAttribute('fill', '#09090b');

  const picture = doc.createElementNS(svgNs, 'rect');
  picture.setAttribute('x', '22');
  picture.setAttribute('y', align === 'top' ? '18' : '34');
  picture.setAttribute('width', '116');
  picture.setAttribute('height', '64');
  picture.setAttribute('rx', '4');
  picture.setAttribute('fill', 'currentColor');
  picture.setAttribute('fill-opacity', '0.14');
  picture.setAttribute('stroke', 'currentColor');
  picture.setAttribute('stroke-width', '2');

  svg.append(bezel, stage, picture);

  if (align === 'top') {
    const bar = doc.createElementNS(svgNs, 'rect');
    bar.setAttribute('x', '40');
    bar.setAttribute('y', '98');
    bar.setAttribute('width', '80');
    bar.setAttribute('height', '7');
    bar.setAttribute('rx', '3.5');
    bar.setAttribute('fill', 'currentColor');
    svg.append(bar);
  }

  return svg;
}
