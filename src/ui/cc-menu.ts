import { DisposableScope } from '../core/disposable-scope';
import { CC_SEARCH_KEY_EVENT } from '../protocol/cc-search';

import { closeMenuPopover, MENU_CLOSE_EVENT } from './menu-popover';

// Eight tracks exceed about one screenful of airy rows; translated lists often have 50+.
const SEARCH_TRACK_THRESHOLD = 8;

export type Choice = { id: string | null; label: string; language?: string; active: boolean; disabled?: boolean };
type Translate = (key: string, substitutions?: string | string[]) => string;

export type ChoiceMenuConfig = {
  title: string;
  /** A header action after the title, such as subtitle options. */
  action?: { label: string; run: () => void; className?: string };
  /** A header button before the title that leaves a nested list; Escape on an empty search takes it too. */
  back?: { label: string; run: () => void };
  listId: string;
  searchLabel: string;
  emptyLabel: string;
  noMatchesLabel: string;
  /** Receives the popover's close event; defaults to the panel itself. */
  closeEvents?: HTMLElement;
};

/** NFD handles accents; Polish ł does not decompose. Cache each choice per refresh. */
function searchText(text: string): string {
  return text.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l');
}

/**
 * A searchable single-choice list: the subtitle menu and nested player-settings lists share its
 * rows, keyboard and pointer handling. Owns the stable shell and input; refreshes replace only
 * the choices.
 */
export class ChoiceMenu {
  private readonly scope = new DisposableScope();
  private readonly input = document.createElement('input');
  private readonly list = document.createElement('div');
  private readonly search = document.createElement('div');
  private choices: Array<Choice & { text: string }> = [];
  private composing = false;
  private query = '';
  private action: HTMLButtonElement | null = null;
  /**
   * The list's scroll offset, kept from its scroll events. Reading `scrollTop` on a refresh
   * forced the host page's pending restyle, and refreshes follow host changes such as navigation.
   */
  private scrolled = 0;

  constructor(
    private readonly panel: HTMLElement,
    private readonly trigger: HTMLButtonElement,
    private readonly config: ChoiceMenuConfig,
    private readonly select: (id: string | null) => void
  ) {
    const header = document.createElement('div');
    header.className = 'theater-cc-menu-header';
    const title = document.createElement('span');
    title.className = 'theater-cc-menu-title';
    title.textContent = config.title;
    const headerButton = (className: string, label: string, run: () => void) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.textContent = label;
      this.scope.listen(button, 'click', (event: MouseEvent) => { event.stopPropagation(); run(); });
      return button;
    };
    if (config.back) {
      const back = headerButton('theater-cc-menu-back', '', config.back.run);
      back.setAttribute('aria-label', config.back.label);
      header.append(back);
    }
    header.append(title);
    if (config.action) {
      this.action = headerButton(config.action.className ?? 'theater-cc-menu-options', config.action.label, config.action.run);
      header.append(this.action);
    }
    this.list.className = 'theater-cc-menu-list';
    this.list.id = config.listId;
    this.list.setAttribute('role', 'group');
    this.list.setAttribute('aria-label', config.title);
    this.search.className = 'theater-cc-search';
    this.input.className = 'theater-cc-search-input';
    this.input.type = 'text'; // Avoid browser-specific search decorations and clear buttons.
    this.input.placeholder = config.searchLabel;
    this.input.setAttribute('aria-label', config.searchLabel);
    this.input.setAttribute('aria-controls', this.list.id);
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.setAttribute('autocapitalize', 'off');
    this.input.setAttribute('enterkeyhint', 'done');
    this.search.append(this.input);
    panel.replaceChildren(header, this.search, this.list);
    this.scope.listen(this.input, 'compositionstart', () => { this.composing = true; });
    this.scope.listen(this.input, 'compositionend', () => { this.composing = false; this.filter(); });
    this.scope.listen(this.input, 'input', (event: Event) => {
      if (!this.composing && !(event instanceof InputEvent && event.isComposing)) this.filter();
    });
    this.scope.listen(this.input, 'keydown', (event: KeyboardEvent) => {
      event.stopPropagation();
      if (!event.isComposing && !this.composing && this.key(event.key)) event.preventDefault();
    });
    for (const type of ['keyup', 'keypress'] as const) {
      this.scope.listen(this.input, type, (event: KeyboardEvent) => event.stopPropagation());
    }
    // MAIN capture protects against host window shortcuts; a string-only relay
    // lets the isolated menu own navigation without forwarding typed text.
    this.scope.listen(this.input, CC_SEARCH_KEY_EVENT, (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'string' || this.composing) return;
      if (this.key(event.detail)) event.preventDefault();
    });
    this.scope.listen(this.list, 'keydown', (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'Escape' && (this.input.value || config.back)) {
        event.preventDefault();
        event.stopPropagation();
        if (this.input.value) this.input.focus({ preventScroll: true });
        this.key('Escape');
        return;
      }
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      const rows = [...this.list.querySelectorAll<HTMLButtonElement>('button')];
      const index = rows.indexOf(event.target as HTMLButtonElement);
      if (index < 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'ArrowUp' && index === 0 && !this.search.hidden) this.input.focus({ preventScroll: true });
      else rows[(index + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]?.focus();
    });
    this.scope.listen(this.list, 'scroll', () => { this.scrolled = this.list.scrollTop; }, { passive: true });
    this.scope.listen(this.list, 'click', (event: MouseEvent) => {
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (!button || !this.list.contains(button)) return;
      const choice = this.choices.find(choice => (choice.id ?? '') === button.dataset.trackId);
      if (!choice || choice.disabled) return;
      this.select(choice.id);
    });
    this.scope.listen(config.closeEvents ?? panel, MENU_CLOSE_EVENT, () => {
      // Focus stays on the bar only when a key put it on a row. A pointer close, or a text field a click
      // focused, must not move focus: a script focus() after a focused text field draws the keyboard ring.
      const active = (panel.getRootNode() as Document | ShadowRoot).activeElement;
      if (active && active !== this.input && panel.contains(active) && active.matches(':focus-visible')) trigger.focus({ preventScroll: true });
      // A closed menu is not displayed and keeps no scroll offset.
      this.scrolled = 0;
      this.clearSearch();
    });
  }

  /** Shows the header action only while it applies, such as a reset with something to reset. */
  setActionHidden(hidden: boolean): void {
    if (!this.action || this.action.hidden === hidden) return;
    if (hidden && (this.panel.getRootNode() as Document | ShadowRoot).activeElement === this.action) this.firstFocus()?.focus({ preventScroll: true });
    this.action.hidden = hidden;
  }

  /** Forgets a typed query, for example when a nested list is left. */
  clearSearch(): void {
    this.composing = false;
    this.input.value = '';
    if (this.query) {
      this.query = '';
      this.render();
    }
  }

  update(choices: Choice[]): void {
    if (this.scope.isDisposed) return;
    this.choices = choices.map(choice => ({ ...choice, text: searchText(`${choice.label} ${choice.language ?? ''}`) }));
    // Search is useful on long auto-generated lists, and noise on short ones.
    this.search.hidden = choices.filter(choice => choice.id !== null).length < SEARCH_TRACK_THRESHOLD;
    if (this.search.hidden) {
      if ((this.panel.getRootNode() as Document | ShadowRoot).activeElement === this.input) this.trigger.focus({ preventScroll: true });
      this.input.value = '';
      this.query = '';
    }
    this.render();
  }

  firstFocus(): HTMLElement | undefined {
    return this.search.hidden ? this.list.querySelector<HTMLButtonElement>('button') ?? undefined : this.input;
  }

  private key(key: string): boolean {
    if (key === 'Escape') {
      // Clearing first preserves a useful way back to the complete language list.
      if (this.input.value) { this.input.value = ''; this.filter(); }
      else if (this.config.back) this.config.back.run();
      else closeMenuPopover(this.panel.parentElement, true);
      return true;
    }
    const first = this.list.querySelector<HTMLButtonElement>('button');
    if (key === 'ArrowDown') { first?.focus(); return true; }
    if (key === 'Enter') {
      // The pick closes the menu while the field still has focus, so the keyboard user's place is kept here.
      if (first) this.trigger.focus({ preventScroll: true });
      first?.click();
      return true;
    }
    return false;
  }

  private filter(): void {
    this.query = searchText(this.input.value);
    this.render();
    this.list.scrollTop = 0;
    this.scrolled = 0;
  }

  private render(): void {
    const active = (this.panel.getRootNode() as Document | ShadowRoot).activeElement;
    const focusedId = active instanceof HTMLButtonElement && this.list.contains(active) ? active.dataset.trackId : undefined;
    const fragment = document.createDocumentFragment();
    for (const choice of this.choices) {
      if (this.query && (choice.id === null || !choice.text.includes(this.query))) continue;
      const row = document.createElement('button');
      row.type = 'button';
      row.disabled = choice.disabled === true;
      row.className = 'theater-control-btn theater-settings-row theater-cc-menu-item';
      row.dataset.trackId = choice.id ?? '';
      row.setAttribute('aria-pressed', String(choice.active));
      row.classList.toggle('active', choice.active);
      const label = document.createElement('span');
      label.className = 'theater-cc-menu-label';
      label.textContent = choice.label;
      label.title = choice.label;
      const detail = document.createElement('span');
      detail.className = 'theater-settings-detail';
      const check = document.createElement('span');
      check.className = 'theater-cc-menu-check';
      check.textContent = choice.active ? '✓' : '';
      const reserve = document.createElement('span');
      reserve.className = 'theater-settings-reserve';
      reserve.dataset.reserve = '✓';
      detail.setAttribute('aria-hidden', 'true');
      detail.append(check, reserve);
      row.append(label, detail);
      fragment.append(row);
    }
    if (!fragment.childNodes.length) {
      const empty = document.createElement('div');
      empty.className = 'theater-settings-row theater-cc-menu-item';
      empty.setAttribute('aria-disabled', 'true');
      empty.setAttribute('role', 'status');
      empty.textContent = this.query ? this.config.noMatchesLabel : this.config.emptyLabel;
      fragment.append(empty);
    }
    // Removing a focused row must not look like focus leaving the popover.
    if (focusedId !== undefined) this.trigger.focus({ preventScroll: true });
    this.list.replaceChildren(fragment);
    if (this.scrolled) this.list.scrollTop = this.scrolled;
    if (focusedId !== undefined) {
      ([...this.list.querySelectorAll<HTMLButtonElement>('button')].find(row => row.dataset.trackId === focusedId)
        ?? this.firstFocus())?.focus({ preventScroll: true });
    }
  }

  dispose(): void { this.scope.dispose(); }
}

/** The subtitle menu: languages and Off, with the caption options action. */
export class CcMenu extends ChoiceMenu {
  constructor(panel: HTMLElement, trigger: HTMLButtonElement, t: Translate, select: (id: string | null) => void, options: () => void) {
    super(panel, trigger, {
      title: t('subtitlesMenuTitle'),
      action: { label: t('subtitleOptions'), run: options },
      listId: 'theater-cc-menu-list',
      searchLabel: t('searchSubtitles'),
      emptyLabel: t('noSubtitles'),
      noMatchesLabel: t('subtitleNoMatches')
    }, select);
  }
}
