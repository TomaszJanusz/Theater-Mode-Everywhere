import {
  hasSettingsProfile, resolveSetupState, SETUP_HASH, SETUP_STATE_KEY, shownSetupSteps, type SetupState, type SetupStepId
} from '../src/first-run-setup';
import { t } from '../src/i18n';
import { languageRuntime } from '../src/i18n-runtime';
import { MEDIA_PROVIDER_IDS } from '../src/media-features/provider-flags';
import { PROVIDER_CAPABILITIES } from '../src/providers/capabilities';

import { answersFromSettings, serviceFlags, setupSettingsPatch, type ServicesChoice, type SetupAnswers } from './setup-answers';
import { setupMessage as copy } from './setup-wizard-copy';

/** The storage the setup reads and writes; Settings passes `chromeSetupStorage()`, stories and tests a fake. */
export interface SetupStorage {
  /** All of sync, for the profile check, and this device's setup state. */
  read(): Promise<{ sync: Record<string, unknown>; state: unknown }>;
  /** Writes `settings` (when any) to sync, then `state`. */
  save(settings: Record<string, unknown>, state: SetupState): Promise<void>;
  saveState(state: SetupState): Promise<void>;
  onSyncChange(listener: () => void): () => void;
}

export interface SetupWizardOptions {
  storage: SetupStorage;
  version: string;
  /** Leaves the setup for a Settings section. */
  leave(section: string): void;
  /** Tells open tabs that settings changed, as the Settings controls do. */
  notify?(): Promise<void>;
  /**
   * An explicit start (`SetupRoute.start`): the answers to preselect, or the saved settings when omitted. Without
   * it the setup was reached by URL, and an install's `pending` state makes it give way to a synced profile.
   */
  start?: { initial?: SetupAnswers };
}

export interface SetupWizard {
  /** Settles once the setup shows a step or the notice. */
  ready: Promise<void>;
  dispose(): void;
}

interface StepView { element: HTMLElement; localize(): void }
type StepContext = {
  doc: Document;
  answers: SetupAnswers;
  finish(section: string): void;
};

const SERVICE_CHOICES: readonly ServicesChoice[] = ['all', 'choose', 'none'];
const CHOICE_KEYS: Record<ServicesChoice, string> = { all: 'setupServicesAll', choose: 'setupServicesChoose', none: 'setupServicesNone' };

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  return node;
}

function servicesStep({ doc, answers }: StepContext): StepView {
  const root = element(doc, 'div', 'setup-step-body');
  const description = element(doc, 'p', 'setup-step-desc');
  const group = element(doc, 'div', 'setup-choices');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-labelledby', 'setup-step-title');
  const list = element(doc, 'div', 'setup-services');
  list.id = 'setup-services';
  list.setAttribute('role', 'group');
  list.setAttribute('aria-labelledby', 'setup-choice-choose-name');
  const footer = element(doc, 'p', 'section-desc-footer');
  const radios = SERVICE_CHOICES.map(choice => {
    const label = element(doc, 'label', 'setup-choice');
    const input = element(doc, 'input');
    input.type = 'radio';
    input.name = 'setup-services';
    input.value = choice;
    input.checked = answers.services === choice;
    const text = element(doc, 'span', 'setup-choice-copy');
    const name = element(doc, 'span', 'setup-choice-name');
    name.id = `setup-choice-${choice}-name`;
    const desc = element(doc, 'span', 'setup-choice-desc');
    desc.id = `setup-choice-${choice}-desc`;
    input.setAttribute('aria-labelledby', name.id);
    input.setAttribute('aria-describedby', desc.id);
    text.append(name, desc);
    label.append(input, text);
    input.addEventListener('change', () => {
      if (!input.checked) return;
      answers.services = choice;
      list.hidden = choice !== 'choose';
    });
    group.append(label);
    return { choice, name, desc };
  });
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
  root.append(description, group, list, footer);
  return {
    element: root,
    localize() {
      description.textContent = copy('setupServicesDescription');
      footer.textContent = copy('setupServicesFooter');
      for (const { choice, name, desc } of radios) {
        name.textContent = copy(CHOICE_KEYS[choice]);
        desc.textContent = copy(`${CHOICE_KEYS[choice]}Description`);
      }
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

function servicesSummary(answers: SetupAnswers): string {
  const flags = serviceFlags(answers);
  const on = MEDIA_PROVIDER_IDS.filter(id => flags[id]).length;
  if (on === MEDIA_PROVIDER_IDS.length) return copy('setupServicesAll');
  if (on === 0) return copy('setupServicesNone');
  return copy('setupSummaryServicesSome', [String(on), String(MEDIA_PROVIDER_IDS.length)]);
}

function summaryStep({ doc, answers, finish }: StepContext): StepView {
  const root = element(doc, 'div', 'setup-step-body');
  const description = element(doc, 'p', 'setup-step-desc');
  const list = element(doc, 'dl', 'setup-summary');
  const row = element(doc, 'div', 'setup-summary-row');
  const term = element(doc, 'dt');
  const value = element(doc, 'dd');
  row.append(term, value);
  list.append(row);
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
      term.textContent = copy('setupServicesTitle');
      value.textContent = servicesSummary(answers);
      moreLabel.textContent = copy('setupSummaryFinishAndOpen');
      for (const { button, key } of links) button.textContent = t(key);
    }
  };
}

const STEP_VIEWS: { [Id in SetupStepId]?: (context: StepContext) => StepView } = { services: servicesStep, summary: summaryStep };
const STEP_TITLES: { [Id in SetupStepId]?: string } = { services: 'setupServicesTitle', summary: 'setupSummaryTitle' };

/** The registry's ready steps with their views; a ready step without one is a programming error. */
function setupStepViews() {
  return shownSetupSteps().map(id => {
    const view = STEP_VIEWS[id];
    if (!view) throw new Error(`Setup step ${id} is ready but has no view`);
    return { id, view, title: STEP_TITLES[id]! };
  });
}

/** The frame around every step: heading, progress, the step itself, and the step buttons. */
function setupShell(doc: Document, stepCount: number) {
  const header = element(doc, 'div', 'setup-header');
  const title = element(doc, 'h2', 'setup-title');
  title.id = 'setup-title';
  const progress = element(doc, 'p', 'setup-progress');
  progress.setAttribute('aria-live', 'polite');
  const bar = element(doc, 'div', 'setup-progress-bar');
  bar.setAttribute('aria-hidden', 'true');
  const segments = Array.from({ length: stepCount }, () => bar.appendChild(element(doc, 'span')));
  header.append(title, progress, bar);
  const welcome = element(doc, 'p', 'setup-welcome');
  const step = element(doc, 'section', 'setup-step');
  step.setAttribute('aria-labelledby', 'setup-step-title');
  const stepTitle = element(doc, 'h3', 'setup-step-title');
  stepTitle.id = 'setup-step-title';
  stepTitle.tabIndex = -1;
  const error = element(doc, 'p', 'setup-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const actions = element(doc, 'div', 'setup-actions');
  const skip = element(doc, 'button', 'secondary-btn setup-skip');
  const back = element(doc, 'button', 'secondary-btn');
  const next = element(doc, 'button', 'te-dialog-btn te-dialog-btn-primary');
  for (const button of [skip, back, next]) button.type = 'button';
  actions.append(skip, back, next);
  return {
    header, title, progress, welcome, step, stepTitle, error, actions, skip, back, next,
    /** Marks the steps before `index` done and `index` current. */
    progressTo(index: number) {
      segments.forEach((segment, position) => {
        segment.dataset.state = position === index ? 'current' : 'next';
        if (position < index) segment.dataset.state = 'done';
      });
    }
  };
}

/** Calls `onProfile` when sync, read again after a change, holds a profile; only the latest read counts. */
function watchForProfile(storage: SetupStorage, onProfile: () => void): () => void {
  let checks = 0;
  return storage.onSyncChange(() => {
    const check = ++checks;
    void storage.read().then(({ sync }) => { if (check === checks && hasSettingsProfile(sync)) onProfile(); }).catch(() => {});
  });
}

/** Replaces the setup with the "settings arrived from another device" notice and focuses it. */
function showProfileNotice(root: HTMLElement, title: HTMLElement, leave: () => void): void {
  const doc = root.ownerDocument;
  const notice = element(doc, 'p', 'setup-notice');
  notice.tabIndex = -1;
  notice.textContent = copy('setupProfileFound');
  const open = element(doc, 'button', 'te-dialog-btn te-dialog-btn-primary');
  open.type = 'button';
  open.textContent = copy('setupOpenSettings');
  open.addEventListener('click', leave);
  const row = element(doc, 'div', 'setup-actions');
  row.append(open);
  title.textContent = copy('setupTitle');
  root.replaceChildren(title, notice, row);
  notice.focus();
}

/**
 * The first-run setup inside `root`. Answers stay in memory until Finish, which writes only the settings they
 * change; Skip and closing the tab write none. Opened by an install (state `pending`), the setup gives way to
 * settings that arrive through sync instead of overwriting them.
 */
export function mountSetupWizard(root: HTMLElement, options: SetupWizardOptions): SetupWizard {
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  const steps = setupStepViews();
  let disposed = false;
  let settled = false;
  let busy = false;
  let pending = false;
  let index = 0;
  let answers: SetupAnswers | undefined;
  let initial = '';
  let current: StepView | undefined;
  let stopSync = () => {};

  root.classList.add('setup-wizard');
  root.setAttribute('aria-labelledby', 'setup-title');
  const shell = setupShell(doc, steps.length);
  const { header, title, progress, welcome, stepTitle, error, actions, skip, back, next } = shell;
  root.replaceChildren(header);

  // Closing the tab with changed answers asks first; unchanged answers leave quietly, like Skip.
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (answers !== undefined && !settled && JSON.stringify(answers) !== initial) event.preventDefault();
  };
  win.addEventListener('beforeunload', onBeforeUnload);

  function localize(): void {
    title.textContent = copy('setupTitle');
    progress.textContent = copy('setupProgress', [String(index + 1), String(steps.length)]);
    welcome.textContent = copy('setupWelcome');
    stepTitle.textContent = copy(steps[index].title);
    skip.textContent = copy('setupSkip');
    back.textContent = copy('setupBack');
    next.textContent = copy(index === steps.length - 1 ? 'setupFinish' : 'setupNext');
    if (!error.hidden) error.textContent = t('errorSavingSettings');
    current?.localize();
  }

  function showError(): void {
    error.textContent = t('errorSavingSettings');
    error.hidden = false;
    title.textContent = copy('setupTitle');
  }

  function show(target: number, focus: boolean): void {
    index = target;
    current = steps[index].view({ doc, answers: answers!, finish: section => { void finish(section); } });
    shell.step.replaceChildren(stepTitle, current.element);
    welcome.hidden = index !== 0;
    back.hidden = index === 0;
    shell.progressTo(index);
    localize();
    // A new step is announced by its heading; the progress line is polite live text.
    if (focus) stepTitle.focus();
  }

  async function giveWay(): Promise<void> {
    settled = true;
    stopSync();
    await options.storage.saveState({ status: 'profile', version: options.version });
    if (!disposed) showProfileNotice(root, title, () => options.leave('features'));
  }

  async function finish(section: string): Promise<void> {
    if (busy || settled || !answers) return;
    busy = true;
    error.hidden = true;
    try {
      // Sync may have delivered a profile since the setup opened; it wins over these answers.
      const { sync, state } = await options.storage.read();
      if (disposed || settled) return;
      if (pending && resolveSetupState(state)?.status === 'pending' && hasSettingsProfile(sync)) return await giveWay();
      settled = true;
      const patch = setupSettingsPatch(answers, sync);
      await options.storage.save(patch, { status: 'completed', version: options.version });
      if (Object.keys(patch).length) await options.notify?.();
      if (!disposed) options.leave(section);
    } catch (reason) {
      console.error('[Theater Everywhere] Could not save the setup:', reason);
      settled = false;
      if (!disposed) showError();
    } finally {
      busy = false;
    }
  }

  async function skipSetup(): Promise<void> {
    if (busy || settled) return;
    busy = settled = true;
    // Skip writes no settings; the defaults already apply, so leaving is right even if the record fails.
    if (pending) await options.storage.saveState({ status: 'skipped', version: options.version })
      .catch((reason: unknown) => console.error('[Theater Everywhere] Could not record skipping the setup:', reason));
    busy = false;
    if (!disposed) options.leave('features');
  }

  skip.addEventListener('click', () => { void skipSetup(); });
  back.addEventListener('click', () => { if (index > 0) show(index - 1, true); });
  next.addEventListener('click', () => {
    if (index < steps.length - 1) show(index + 1, true);
    else void finish('features');
  });
  const stopLanguage = languageRuntime.subscribe(() => { if (!settled) localize(); });

  const ready = (async () => {
    const { sync, state } = await options.storage.read();
    if (disposed) return;
    // Someone asked for the setup: a synced profile is what they want to change, not a reason to stop.
    pending = !options.start && resolveSetupState(state)?.status === 'pending';
    if (pending && hasSettingsProfile(sync)) return await giveWay();
    answers = structuredClone(options.start?.initial) ?? answersFromSettings(sync);
    initial = JSON.stringify(answers);
    // Chrome can deliver synced settings after the install; they replace the setup, never the reverse.
    if (pending) stopSync = watchForProfile(options.storage, () => { if (!disposed && !settled && !busy) void giveWay(); });
    root.replaceChildren(header, welcome, shell.step, error, actions);
    // The first step is not focused: the page reads from its top, title and welcome first.
    show(0, false);
  })().catch(reason => {
    console.error('[Theater Everywhere] Could not open the setup:', reason);
    if (disposed) return;
    showError();
    root.replaceChildren(header, error);
  });

  return {
    ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      stopSync();
      stopLanguage();
      win.removeEventListener('beforeunload', onBeforeUnload);
      root.replaceChildren();
    }
  };
}

export function chromeSetupStorage(): SetupStorage {
  return {
    async read() {
      const [sync, local] = await Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get(SETUP_STATE_KEY)]);
      return { sync, state: local[SETUP_STATE_KEY] };
    },
    async save(settings, state) {
      if (Object.keys(settings).length) await chrome.storage.sync.set(settings);
      await chrome.storage.local.set({ [SETUP_STATE_KEY]: state });
    },
    async saveState(state) {
      await chrome.storage.local.set({ [SETUP_STATE_KEY]: state });
    },
    onSyncChange(listener) {
      const onChanged = (_changes: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === 'sync') listener(); };
      chrome.storage.onChanged.addListener(onChanged);
      return () => chrome.storage.onChanged.removeListener(onChanged);
    }
  };
}

export interface SetupRoute {
  /**
   * Starts the setup now, in this tab, with `initial` preselected (the saved settings when omitted). The one entry
   * point for every in-page start, such as running the setup again or after resetting settings.
   */
  start(initial?: SetupAnswers): void;
  /** Settles once the shown setup shows a step or the notice; at once while none is shown. */
  readonly ready: Promise<void>;
  dispose(): void;
}

/**
 * Shows the setup instead of the settings while the page is at `#setup`: opened there by an install, by a link,
 * or by `start`. The page keeps its other state, so leaving the setup lands on a working Settings tab; `leave`
 * replaces the history entry, so Back does not reopen it.
 */
export function routeSetupWizard(root: HTMLElement, settings: readonly HTMLElement[], options: Omit<SetupWizardOptions, 'leave' | 'start'>): SetupRoute {
  let wizard: SetupWizard | undefined;
  let requested: SetupWizardOptions['start'];
  const route = () => {
    const open = location.hash === `#${SETUP_HASH}`;
    if (open === Boolean(wizard) && !(open && requested)) return;
    wizard?.dispose();
    const start = requested;
    requested = undefined;
    wizard = open ? mountSetupWizard(root, { ...options, start, leave: section => location.replace(`#${section}`) }) : undefined;
    root.hidden = !open;
    for (const node of settings) node.hidden = open;
  };
  window.addEventListener('hashchange', route);
  route();
  return {
    start(initial) {
      requested = { initial };
      // Already at #setup, no hashchange follows: restart in place.
      if (location.hash === `#${SETUP_HASH}`) route();
      else location.replace(`#${SETUP_HASH}`);
    },
    get ready() { return wizard?.ready ?? Promise.resolve(); },
    dispose() {
      window.removeEventListener('hashchange', route);
      wizard?.dispose();
      wizard = undefined;
    }
  };
}
