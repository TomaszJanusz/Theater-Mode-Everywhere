import { DisposableScope } from '../core/disposable-scope';
import { CC_SEARCH_KEY_EVENT } from '../protocol/cc-search';
import { closeMenuPopover, MENU_CLOSE_EVENT } from './menu-popover';

// Eight tracks exceed about one screenful of airy rows; translated lists often have 50+.
const SEARCH_TRACK_THRESHOLD = 8;

type Choice = { id: string | null; label: string; language?: string; active: boolean };
type Translate = (key: string, substitutions?: string | string[]) => string;

/** NFD handles accents; Polish ł does not decompose. Cache each choice per refresh. */
function searchText(text: string): string {
  return text.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l');
}

/** Owns the stable shell and input; provider refreshes replace only the choices. */
export class CcMenu {
  private readonly scope = new DisposableScope();
  private readonly input = document.createElement('input');
  private readonly list = document.createElement('div');
  private readonly search = document.createElement('div');
  private choices: Array<Choice & { text: string }> = [];
  private composing = false;
  private query = '';

  constructor(
    private readonly panel: HTMLElement,
    private readonly trigger: HTMLButtonElement,
    private readonly t: Translate,
    private readonly select: (id: string | null) => void,
    options: () => void
  ) {
    const header = document.createElement('div');
    header.className = 'theater-cc-menu-header';
    const title = document.createElement('span');
    title.className = 'theater-cc-menu-title';
    title.textContent = t('subtitlesMenuTitle');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theater-cc-menu-options';
    button.textContent = t('subtitleOptions');
    this.scope.listen(button, 'click', (event: MouseEvent) => { event.stopPropagation(); options(); });
    header.append(title, button);
    this.list.className = 'theater-cc-menu-list';
    this.list.id = 'theater-cc-menu-list';
    this.list.setAttribute('role', 'group');
    this.list.setAttribute('aria-label', t('subtitlesMenuTitle'));
    this.search.className = 'theater-cc-search';
    this.input.className = 'theater-cc-search-input';
    this.input.type = 'text'; // Avoid browser-specific search decorations and clear buttons.
    this.input.placeholder = t('searchSubtitles');
    this.input.setAttribute('aria-label', t('searchSubtitles'));
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
      if (event.key === 'Escape' && this.input.value) {
        event.preventDefault();
        event.stopPropagation();
        this.input.focus({ preventScroll: true });
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
    this.scope.listen(this.list, 'click', (event: MouseEvent) => {
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (!button || !this.list.contains(button)) return;
      const choice = this.choices.find(choice => (choice.id ?? '') === button.dataset.trackId);
      if (!choice) return;
      this.select(choice.id);
    });
    this.scope.listen(panel, MENU_CLOSE_EVENT, () => {
      const active = (panel.getRootNode() as Document | ShadowRoot).activeElement;
      if (active && panel.contains(active)) trigger.focus({ preventScroll: true });
      this.composing = false;
      this.input.value = '';
      this.query = '';
    });
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
      else closeMenuPopover(this.panel.parentElement, true);
      return true;
    }
    const first = this.list.querySelector<HTMLButtonElement>('button');
    if (key === 'ArrowDown') { first?.focus(); return true; }
    if (key === 'Enter') { first?.click(); return true; }
    return false;
  }

  private filter(): void {
    this.query = searchText(this.input.value);
    this.render();
    this.list.scrollTop = 0;
  }

  private render(): void {
    const active = (this.panel.getRootNode() as Document | ShadowRoot).activeElement;
    const focusedId = active instanceof HTMLButtonElement && this.list.contains(active) ? active.dataset.trackId : undefined;
    const fragment = document.createDocumentFragment();
    for (const choice of this.choices) {
      if (this.query && (choice.id === null || !choice.text.includes(this.query))) continue;
      const row = document.createElement('button');
      row.type = 'button';
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
      empty.textContent = this.t(this.query ? 'subtitleNoMatches' : 'noSubtitles');
      fragment.append(empty);
    }
    const scroll = this.list.scrollTop;
    // Removing a focused row must not look like focus leaving the popover.
    if (focusedId !== undefined) this.trigger.focus({ preventScroll: true });
    this.list.replaceChildren(fragment);
    this.list.scrollTop = scroll;
    if (focusedId !== undefined) {
      ([...this.list.querySelectorAll<HTMLButtonElement>('button')].find(row => row.dataset.trackId === focusedId)
        ?? this.firstFocus())?.focus({ preventScroll: true });
    }
  }

  dispose(): void { this.scope.dispose(); }
}
