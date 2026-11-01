export interface ChoiceOption<Value extends string> {
  value: Value;
  /** Called on every render so a live language change relabels the button. */
  label(): string;
  ariaLabel?(): string;
  swatch?: { color: string; system?: boolean };
}

export interface ChoiceGrid<Value extends string> {
  /** Omitting `selected` keeps the current choice and only relabels. */
  render(selected?: Value): void;
}

/** Radio-group grid; owns DOM and interaction only, callers own translation and persistence. */
export function createChoiceGrid<Value extends string>(
  grid: HTMLElement,
  options: readonly ChoiceOption<Value>[],
  onSelect: (value: Value) => void
): ChoiceGrid<Value> {
  let selected: Value | undefined;
  // The grid's own document: Storybook renders Settings in a frame.
  const doc = grid.ownerDocument;
  const items = options.map(option => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'choice-btn';
    button.dataset.choice = option.value;
    button.setAttribute('role', 'radio');
    if (option.swatch) {
      button.classList.add('has-swatch');
      const swatch = doc.createElement('span');
      swatch.className = 'choice-swatch';
      swatch.setAttribute('aria-hidden', 'true');
      if (option.swatch.system) swatch.classList.add('system-swatch');
      else swatch.style.backgroundColor = option.swatch.color;
      button.append(swatch);
    }
    const label = doc.createElement('span');
    label.className = 'choice-label';
    button.append(label);
    // Native buttons turn Enter/Space into this click, so keys and pointer share one path.
    button.addEventListener('click', () => onSelect(option.value));
    grid.append(button);
    return { button, label, option };
  });

  const rove = (target: HTMLButtonElement | undefined): void => {
    for (const { button } of items) button.tabIndex = button === target ? 0 : -1;
  };
  const checkedButton = () => items.find(({ option }) => option.value === selected)?.button ?? items[0]?.button;

  grid.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const index = items.findIndex(({ button }) => button === doc.activeElement);
    if (index < 0) return;
    const rtl = doc.defaultView!.getComputedStyle(grid).direction === 'rtl';
    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'ArrowUp' || event.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) next = (index - 1 + items.length) % items.length;
    else if (event.key === 'ArrowDown' || event.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) next = (index + 1) % items.length;
    else return;
    event.preventDefault();
    const target = items[next].button;
    rove(target);
    target.focus();
    target.click();
  });

  return {
    render(value = selected) {
      selected = value;
      const focused = items.find(({ button }) => button === doc.activeElement)?.button;
      for (const { button, label, option } of items) {
        const text = option.label();
        label.textContent = text;
        button.title = text;
        const ariaLabel = option.ariaLabel?.();
        if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
        else button.removeAttribute('aria-label');
        const checked = option.value === value;
        button.setAttribute('aria-checked', String(checked));
        button.classList.toggle('selected', checked);
      }
      // Relabel in place: a live catalog change must not move keyboard focus.
      rove(focused ?? checkedButton());
    }
  };
}
