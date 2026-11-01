/** The setup's steps: each builds its DOM once per visit, edits the shared answers and relabels on `localize`. */
import type { AccentColorPreset } from '../src/accentTheme';
import type { SetupStepId } from '../src/first-run-setup';
import { t } from '../src/i18n';
import { languageRuntime } from '../src/i18n-runtime';
import type { Language } from '../src/language';
import { MEDIA_PROVIDER_IDS } from '../src/media-features/provider-flags';
import { PROVIDER_CAPABILITIES } from '../src/providers/capabilities';
import { PICTURE_ALIGNS, type PictureAlign } from '../src/ui/picture-align-settings';
import { shortcutLabel } from '../src/ui/shortcut-display';
import { shortcutDisplayEnv, withShortcutDefaults } from '../src/ui/shortcuts';

import { createChoiceGrid } from './choice-grid';
import { createCombobox } from './combobox';
import { accentChoices, accentName, languageChoices, languageName, PICTURE_ALIGN_COPY, pictureAlignIcon } from './settings-choices';
import { autoTheaterAvailable, effectiveStart, serviceFlags, type SetupAnswers, type StartChoice } from './setup-answers';
import { setupMessage as copy } from './setup-wizard-copy';

export interface StepView {
  element: HTMLElement;
  localize(): void;
  /** Releases what lives outside `element`, such as a combobox's popup list. */
  dispose?(): void;
}
export interface StepContext {
  doc: Document;
  answers: SetupAnswers;
  /** Sync as the setup read it: names the user's own keys and their per-service AutoTheater switches. */
  stored: Record<string, unknown>;
  finish(section: string): void;
  /** Shows the answered language or accent on the page now; the setup puts the saved ones back unless it saves. */
  preview(setting: 'language' | 'accent'): void;
}

export function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  return node;
}

/** The user's theater and fullscreen keys as Settings shows them. */
function keyLabels(stored: Record<string, unknown>): { toggle: string; fullscreen: string } {
  const shortcuts = withShortcutDefaults(stored.shortcuts as Record<string, unknown> | undefined);
  const env = shortcutDisplayEnv();
  return { toggle: shortcutLabel(shortcuts.toggle, env), fullscreen: shortcutLabel(shortcuts.toggleFullscreen, env) };
}

interface Choice<Value extends string> { value: Value; label(): string; description(): string }

/** Native radios as cards in a group named by the step heading; arrow keys and Space are the browser's. */
function choiceGroup<Value extends string>(doc: Document, name: string, choices: readonly Choice<Value>[], onSelect: (value: Value) => void) {
  const group = element(doc, 'div', 'setup-choices');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-labelledby', 'setup-step-title');
  const items = choices.map(choice => {
    const card = element(doc, 'label', 'setup-choice');
    const input = element(doc, 'input');
    input.type = 'radio';
    input.name = name;
    input.value = choice.value;
    const text = element(doc, 'span', 'setup-choice-copy');
    const label = element(doc, 'span', 'setup-choice-name');
    label.id = `setup-choice-${choice.value}-name`;
    const description = element(doc, 'span', 'setup-choice-desc');
    description.id = `setup-choice-${choice.value}-desc`;
    input.setAttribute('aria-labelledby', label.id);
    input.setAttribute('aria-describedby', description.id);
    text.append(label, description);
    card.append(input, text);
    input.addEventListener('change', () => { if (input.checked) onSelect(choice.value); });
    group.append(card);
    return { choice, card, input, label, description };
  });
  return {
    group,
    item: (value: Value) => items.find(({ choice }) => choice.value === value)!,
    check(value: Value) { for (const { choice, input } of items) input.checked = choice.value === value; },
    localize() {
      for (const { choice, label, description } of items) {
        label.textContent = choice.label();
        description.textContent = choice.description();
      }
    }
  };
}

/** A labelled switch row with a description, like the Settings rows. */
function switchRow(doc: Document, id: string, checked: boolean, onChange: (checked: boolean) => void) {
  const row = element(doc, 'label', 'setup-switch');
  const text = element(doc, 'span', 'setup-choice-copy');
  const label = element(doc, 'span', 'setup-choice-name');
  label.id = `${id}-label`;
  const description = element(doc, 'span', 'setup-choice-desc');
  description.id = `${id}-desc`;
  text.append(label, description);
  const control = element(doc, 'span', 'toggle-switch');
  const input = element(doc, 'input');
  input.type = 'checkbox';
  input.role = 'switch';
  input.id = id;
  input.checked = checked;
  input.setAttribute('aria-labelledby', label.id);
  input.setAttribute('aria-describedby', description.id);
  const slider = element(doc, 'span', 'toggle-slider');
  slider.setAttribute('aria-hidden', 'true');
  control.append(input, slider);
  row.append(text, control);
  input.addEventListener('change', () => onChange(input.checked));
  return { row, input, label, description };
}

const SERVICE_KEYS = { all: 'setupServicesAll', choose: 'setupServicesChoose', none: 'setupServicesNone' } as const;

function servicesStep({ doc, answers }: StepContext): StepView {
  const root = element(doc, 'div', 'setup-step-body');
  const description = element(doc, 'p', 'setup-step-desc');
  const list = element(doc, 'div', 'setup-services');
  list.id = 'setup-services';
  list.setAttribute('role', 'group');
  list.setAttribute('aria-labelledby', 'setup-choice-choose-name');
  const footer = element(doc, 'p', 'section-desc-footer');
  const choices = choiceGroup(doc, 'setup-services', (['all', 'choose', 'none'] as const).map(value => ({
    value, label: () => copy(SERVICE_KEYS[value]), description: () => copy(`${SERVICE_KEYS[value]}Description`)
  })), value => {
    answers.services = value;
    list.hidden = value !== 'choose';
  });
  choices.check(answers.services);
  list.hidden = answers.services !== 'choose';
  // The services and names of the Rich Theater Experience cards.
  const switches = PROVIDER_CAPABILITIES.map(provider => {
    const row = element(doc, 'label', 'setup-service');
    const name = element(doc, 'bdi', 'setup-service-name');
    name.id = `setup-service-${provider.id}`;
    name.textContent = provider.name;
    const control = element(doc, 'span', 'toggle-switch');
    const input = element(doc, 'input');
    input.type = 'checkbox';
    input.role = 'switch';
    input.checked = answers.chosen[provider.id];
    input.setAttribute('aria-labelledby', name.id);
    const slider = element(doc, 'span', 'toggle-slider');
    slider.setAttribute('aria-hidden', 'true');
    control.append(input, slider);
    row.append(name, control);
    input.addEventListener('change', () => {
      answers.chosen = { ...answers.chosen, [provider.id]: input.checked };
    });
    return { provider, row };
  });
  // The switches follow the choices, so Tab reaches them right after the selected "Choose services".
  root.append(description, choices.group, list, footer);
  return {
    element: root,
    localize() {
      description.textContent = copy('setupServicesDescription');
      footer.textContent = copy('setupServicesFooter');
      choices.localize();
      // Sorted like the Rich Theater Experience cards, in the current language.
      const locale = languageRuntime.language === 'automatic' ? t('@@ui_locale') : languageRuntime.language;
      const collator = new Intl.Collator(locale.startsWith('@@') ? undefined : locale.replace('_', '-'));
      const focused = doc.activeElement;
      [...switches].sort((a, b) => collator.compare(a.provider.name, b.provider.name)).forEach(({ row }, position) => {
        if (list.children[position] !== row) list.insertBefore(row, list.children[position] ?? null);
      });
      if (focused instanceof HTMLElement && list.contains(focused) && doc.activeElement !== focused) focused.focus({ preventScroll: true });
    }
  };
}

function startStep({ doc, answers, stored }: StepContext): StepView {
  const root = element(doc, 'div', 'setup-step-body');
  const description = element(doc, 'p', 'setup-step-desc');
  const footer = element(doc, 'p', 'section-desc-footer');
  const keys = keyLabels(stored);
  const choices = choiceGroup<StartChoice>(doc, 'setup-start', [
    { value: 'key', label: () => copy('setupStartKey', keys.toggle), description: () => copy('setupStartKeyDescription') },
    { value: 'button', label: () => copy('setupStartButton', keys.toggle), description: () => copy('setupStartButtonDescription') },
    { value: 'auto', label: () => copy('setupStartAuto'), description: () => copy('setupStartAutoDescription') }
  ], value => {
    answers.start = value;
    countdown.row.hidden = value !== 'auto';
  });
  const countdown = switchRow(doc, 'setup-skip-countdown', answers.skipCountdown, checked => { answers.skipCountdown = checked; });
  countdown.row.classList.add('setup-nested');
  const auto = choices.item('auto');
  const unavailable = element(doc, 'span', 'setup-choice-note');
  unavailable.id = 'setup-choice-auto-unavailable';
  // Without a service that can start it, "Start automatically" stays visible, explains why, and cannot be chosen.
  const available = autoTheaterAvailable(answers, stored);
  auto.input.disabled = !available;
  auto.card.classList.toggle('is-unavailable', !available);
  if (!available) {
    auto.description.after(unavailable);
    auto.input.setAttribute('aria-describedby', `${auto.description.id} ${unavailable.id}`);
  }
  const start = effectiveStart(answers, stored);
  choices.check(start);
  countdown.row.hidden = start !== 'auto';
  // After the group, not inside it: a radio group owns radios only. "Start automatically" is the last choice above it.
  root.append(description, choices.group, countdown.row, footer);
  return {
    element: root,
    localize() {
      description.textContent = copy('setupStartDescription', keys.toggle);
      choices.localize();
      unavailable.textContent = copy('setupStartAutoUnavailable');
      countdown.label.textContent = t('autoTheaterSkipCountdownTitle');
      countdown.description.textContent = t('autoTheaterSkipCountdownDescription');
      footer.textContent = copy('setupStartFooter');
    }
  };
}

function keysStep({ doc, answers, stored }: StepContext): StepView {
  const root = element(doc, 'div', 'setup-step-body');
  const description = element(doc, 'p', 'setup-step-desc');
  const footer = element(doc, 'p', 'section-desc-footer');
  const keys = keyLabels(stored);
  const hold = switchRow(doc, 'setup-seek-hold', answers.seekHold, checked => { answers.seekHold = checked; });
  const boost = switchRow(doc, 'setup-volume-boost', answers.volumeBoost, checked => { answers.volumeBoost = checked; });
  const group = element(doc, 'div', 'setup-choices');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-labelledby', 'setup-step-title');
  group.append(hold.row, boost.row);
  root.append(description, group, footer);
  return {
    element: root,
    localize() {
      description.textContent = copy('setupKeysDescription', [keys.toggle, keys.fullscreen]);
      hold.label.textContent = t('seekHoldTitle');
      hold.description.textContent = t('seekHoldDescription');
      boost.label.textContent = t('volumeBoostTitle');
      boost.description.textContent = copy('setupVolumeBoostDescription');
      footer.textContent = copy('setupKeysFooter');
    }
  };
}

function languageStep({ doc, answers, preview }: StepContext): StepView {
  const root = element(doc, 'div', 'setup-step-body');
  const description = element(doc, 'p', 'setup-step-desc');
  const footer = element(doc, 'p', 'section-desc-footer');
  const trigger = element(doc, 'button', 'choice-combobox setup-language');
  trigger.type = 'button';
  trigger.id = 'setup-language';
  trigger.setAttribute('aria-labelledby', 'setup-step-title');
  // Settings' own language menu; the page switches at once, so the rest of the setup reads in that language.
  const menu = createCombobox<Language>(trigger, languageChoices(), value => {
    answers.language = value;
    menu.render(value);
    preview('language');
  });
  root.append(description, trigger, footer);
  return {
    element: root,
    localize() {
      description.textContent = t('languageDescription');
      footer.textContent = copy('setupAppearanceFooter');
      menu.render(answers.language);
    },
    dispose: () => menu.destroy()
  };
}

function accentStep({ doc, answers, preview }: StepContext): StepView {
  const root = element(doc, 'div', 'setup-step-body');
  const description = element(doc, 'p', 'setup-step-desc');
  const footer = element(doc, 'p', 'section-desc-footer');
  const grid = element(doc, 'div', 'choice-grid setup-accent');
  grid.setAttribute('role', 'radiogroup');
  grid.setAttribute('aria-labelledby', 'setup-step-title');
  // Settings' accent grid; the page itself is the preview.
  const choices = createChoiceGrid<AccentColorPreset>(grid, accentChoices(), value => {
    answers.accent = value;
    choices.render(value);
    preview('accent');
  });
  choices.render(answers.accent);
  root.append(description, grid, footer);
  return {
    element: root,
    localize() {
      description.textContent = copy('setupAccentDescription');
      footer.textContent = copy('setupAppearanceFooter');
      choices.render();
    }
  };
}

function layoutStep({ doc, answers }: StepContext): StepView {
  const root = element(doc, 'div', 'setup-step-body');
  const description = element(doc, 'p', 'setup-step-desc');
  const footer = element(doc, 'p', 'section-desc-footer');
  const choices = choiceGroup<PictureAlign>(doc, 'setup-layout', PICTURE_ALIGNS.map(value => ({
    value, label: () => t(PICTURE_ALIGN_COPY[value].name), description: () => t(PICTURE_ALIGN_COPY[value].description)
  })), value => {
    answers.layout = value;
    subtitles.row.hidden = value !== 'top';
  });
  // The pictures Settings shows for each layout.
  for (const value of PICTURE_ALIGNS) {
    const { card, input } = choices.item(value);
    card.classList.add('has-picture');
    input.after(pictureAlignIcon(doc, value));
  }
  const subtitles = switchRow(doc, 'setup-raise-subtitles', answers.raiseOnlyWithSubtitles, checked => { answers.raiseOnlyWithSubtitles = checked; });
  subtitles.row.classList.add('setup-nested');
  choices.check(answers.layout);
  subtitles.row.hidden = answers.layout !== 'top';
  root.append(description, choices.group, subtitles.row, footer);
  return {
    element: root,
    localize() {
      description.textContent = copy('setupLayoutDescription');
      choices.localize();
      subtitles.label.textContent = t('pictureAlignSubtitlesOnlyTitle');
      subtitles.description.textContent = t('pictureAlignSubtitlesOnlyDescription');
      footer.textContent = copy('setupAppearanceFooter');
    }
  };
}

function controlsStep({ doc, answers }: StepContext): StepView {
  const root = element(doc, 'div', 'setup-step-body');
  const description = element(doc, 'p', 'setup-step-desc');
  const footer = element(doc, 'p', 'section-desc-footer');
  const pin = switchRow(doc, 'setup-pin-controls', answers.pinControls, checked => { answers.pinControls = checked; });
  const group = element(doc, 'div', 'setup-choices');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-labelledby', 'setup-step-title');
  group.append(pin.row);
  root.append(description, group, footer);
  return {
    element: root,
    localize() {
      description.textContent = copy('setupControlsDescription');
      pin.label.textContent = t('keepControlsVisibleTitle');
      pin.description.textContent = t('keepControlsVisibleDescription');
      footer.textContent = copy('setupAppearanceFooter');
    }
  };
}

function layoutSummary(answers: SetupAnswers): string {
  if (answers.layout === 'top' && answers.raiseOnlyWithSubtitles) return t('pictureAlignSubtitlesOnlyTitle');
  return t(PICTURE_ALIGN_COPY[answers.layout].name);
}

function servicesSummary(answers: SetupAnswers): string {
  const flags = serviceFlags(answers);
  const on = MEDIA_PROVIDER_IDS.filter(id => flags[id]).length;
  if (on === MEDIA_PROVIDER_IDS.length) return copy('setupServicesAll');
  if (on === 0) return copy('setupServicesNone');
  return copy('setupSummaryServicesSome', [String(on), String(MEDIA_PROVIDER_IDS.length)]);
}

function startSummary(answers: SetupAnswers, stored: Record<string, unknown>): string {
  const start = effectiveStart(answers, stored);
  if (start === 'auto') return copy(answers.skipCountdown ? 'setupSummaryStartAutoNow' : 'setupSummaryStartAuto');
  return copy(start === 'button' ? 'setupSummaryStartButton' : 'setupSummaryStartKey', keyLabels(stored).toggle);
}

function summaryStep({ doc, answers, stored, finish }: StepContext): StepView {
  const root = element(doc, 'div', 'setup-step-body');
  const description = element(doc, 'p', 'setup-step-desc');
  const list = element(doc, 'dl', 'setup-summary');
  const onOff = (on: boolean) => copy(on ? 'setupSummaryOn' : 'setupSummaryOff');
  // In step order.
  const rows = [
    { label: () => t('languageTitle'), value: () => languageName(answers.language) },
    { label: () => copy('setupServicesTitle'), value: () => servicesSummary(answers) },
    { label: () => copy('setupStartTitle'), value: () => startSummary(answers, stored) },
    { label: () => t('seekHoldTitle'), value: () => onOff(answers.seekHold) },
    { label: () => t('volumeBoostTitle'), value: () => onOff(answers.volumeBoost) },
    { label: () => t('accentColorLabel'), value: () => accentName(answers.accent) },
    { label: () => t('pictureAlignLabel'), value: () => layoutSummary(answers) },
    { label: () => t('keepControlsVisibleTitle'), value: () => onOff(answers.pinControls) }
  ].map(row => {
    const node = element(doc, 'div', 'setup-summary-row');
    const term = element(doc, 'dt');
    const value = element(doc, 'dd');
    node.append(term, value);
    list.append(node);
    return { ...row, term, valueNode: value };
  });
  const more = element(doc, 'div', 'setup-summary-more');
  more.setAttribute('role', 'group');
  more.setAttribute('aria-labelledby', 'setup-summary-more-label');
  const moreLabel = element(doc, 'span', 'setup-summary-more-label');
  moreLabel.id = 'setup-summary-more-label';
  const sections = [['exclusions', 'websiteExclusionsTitle'], ['shortcuts', 'keyboardShortcutsTitle']] as const;
  const links = sections.map(([section, key]) => {
    const button = element(doc, 'button', 'secondary-btn');
    button.type = 'button';
    button.addEventListener('click', () => finish(section));
    return { button, key };
  });
  more.append(moreLabel, ...links.map(({ button }) => button));
  root.append(description, list, more);
  return {
    element: root,
    localize() {
      description.textContent = copy('setupSummaryDescription');
      for (const row of rows) {
        row.term.textContent = row.label();
        row.valueNode.textContent = row.value();
      }
      moreLabel.textContent = copy('setupSummaryFinishAndOpen');
      for (const { button, key } of links) button.textContent = t(key);
    }
  };
}

export const STEP_VIEWS: { [Id in SetupStepId]?: (context: StepContext) => StepView } = {
  language: languageStep, services: servicesStep, start: startStep, keys: keysStep,
  accent: accentStep, layout: layoutStep, controls: controlsStep, summary: summaryStep
};
/** Message keys; Settings' own headings where they name the same setting. */
export const STEP_TITLES: { [Id in SetupStepId]?: string } = {
  language: 'languageTitle', services: 'setupServicesTitle', start: 'setupStartTitle', keys: 'setupKeysTitle',
  accent: 'accentColorLabel', layout: 'pictureAlignLabel', controls: 'setupControlsTitle', summary: 'setupSummaryTitle'
};
