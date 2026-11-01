export interface ComboboxOption<Value extends string> {
  value: Value;
  label(): string;
  lang?: string;
  dir?: 'ltr' | 'rtl';
}

/** Select-only combobox: DOM focus stays on the trigger; browsing never saves. */
export function createCombobox<Value extends string>(
  trigger: HTMLButtonElement,
  options: readonly ComboboxOption<Value>[],
  onChange: (value: Value) => void
): { render(value: Value): void; destroy(): void } {
  const scope = new AbortController();
  // The trigger's own document: Storybook renders Settings in a frame.
  const doc = trigger.ownerDocument;
  const win = doc.defaultView!;
  const list = doc.createElement('div');
  list.id = `${trigger.id}-listbox`;
  list.className = 'choice-listbox';
  list.role = 'listbox';
  list.setAttribute('aria-labelledby', trigger.getAttribute('aria-labelledby') ?? trigger.id);
  list.hidden = true;
  // A fixed popup escapes the Settings card's overflow without moving the trigger.
  doc.body.append(list);
  trigger.role = 'combobox';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-controls', list.id);
  trigger.setAttribute('aria-expanded', 'false');
  const label = doc.createElement('span');
  label.className = 'choice-label';
  trigger.append(label);
  let selected = 0;
  let active = 0;
  let query = '';
  let lastTyped = 0;
  const items = options.map((option, index) => {
    const item = doc.createElement('div');
    item.id = `${list.id}-${index}`;
    item.className = 'choice-option';
    item.role = 'option';
    item.dataset.value = option.value;
    const text = doc.createElement('span');
    if (option.lang) item.lang = option.lang;
    if (option.dir) item.dir = option.dir;
    item.append(text);
    item.addEventListener('pointermove', () => activate(index, false), { signal: scope.signal });
    item.addEventListener('click', () => commit(index), { signal: scope.signal });
    list.append(item);
    return { item, text };
  });

  function close(): void {
    list.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');
    query = '';
  }

  function activate(index: number, scroll = true): void {
    active = index;
    items.forEach(({ item }, i) => item.classList.toggle('active', i === active));
    trigger.setAttribute('aria-activedescendant', items[active].item.id);
    if (scroll) items[active].item.scrollIntoView({ block: 'nearest' });
  }

  function open(): void {
    if (!list.hidden || trigger.disabled || !items.length) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 6;
    const below = win.innerHeight - rect.bottom - gap - 8;
    const above = rect.top - gap - 8;
    const flip = below < Math.min(280, list.scrollHeight || 280) && above > below;
    list.dir = win.getComputedStyle(trigger).direction;
    list.style.width = `${Math.min(Math.max(rect.width, 240), win.innerWidth - 16)}px`;
    list.style.maxHeight = `${Math.max(0, Math.min(280, flip ? above : below))}px`;
    list.hidden = false;
    const width = list.getBoundingClientRect().width;
    list.style.left = `${Math.max(8, Math.min(list.dir === 'rtl' ? rect.right - width : rect.left, win.innerWidth - width - 8))}px`;
    list.style.top = `${flip ? rect.top - gap - list.getBoundingClientRect().height : rect.bottom + gap}px`;
    trigger.setAttribute('aria-expanded', 'true');
    activate(selected);
  }

  function commit(index: number): void {
    close();
    trigger.focus();
    onChange(options[index].value);
  }

  trigger.addEventListener('click', () => list.hidden ? open() : close(), { signal: scope.signal });
  trigger.addEventListener('blur', close, { signal: scope.signal });
  // Prevent option interaction from transferring DOM focus away from the combobox.
  list.addEventListener('mousedown', event => event.preventDefault(), { signal: scope.signal });
  trigger.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const wasClosed = list.hidden;
    if (event.key === 'Tab') { close(); return; }
    if (event.key === 'Escape') {
      if (!wasClosed) { event.preventDefault(); event.stopPropagation(); close(); }
      return;
    }
    if (['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (wasClosed) open();
      if (event.key === 'Enter' || event.key === ' ') {
        if (!wasClosed) commit(active);
      } else if (event.key === 'Home') activate(0);
      else if (event.key === 'End') activate(items.length - 1);
      else if (!wasClosed) activate(Math.max(0, Math.min(items.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))));
      return;
    }
    if (event.key.length !== 1) return;
    event.preventDefault();
    open();
    const now = performance.now();
    query = (now - lastTyped > 700 ? '' : query) + event.key.toLocaleLowerCase();
    lastTyped = now;
    const search = [...query].every(char => char === query[0]) ? query[0] : query;
    const start = search.length === 1 ? active + 1 : active;
    for (let offset = 0; offset < options.length; offset++) {
      const index = (start + offset) % options.length;
      if (options[index].label().toLocaleLowerCase().startsWith(search)) { activate(index); break; }
    }
  }, { signal: scope.signal });
  doc.addEventListener('pointerdown', event => {
    if (event.target instanceof Node && !trigger.contains(event.target) && !list.contains(event.target)) close();
  }, { signal: scope.signal });
  doc.addEventListener('scroll', event => {
    if (event.target !== list) close();
  }, { capture: true, signal: scope.signal });
  win.addEventListener('resize', close, { signal: scope.signal });
  win.addEventListener('hashchange', close, { signal: scope.signal });
  const panel = trigger.closest('[role="tabpanel"]');
  const visibility = new MutationObserver(close);
  if (panel) visibility.observe(panel, { attributes: true, attributeFilter: ['hidden'] });

  return {
    render(value) {
      close();
      const index = options.findIndex(option => option.value === value);
      if (index < 0) throw new Error(`Unknown combobox value: ${value}`);
      selected = index;
      label.textContent = options[selected].label();
      label.lang = options[selected].lang ?? '';
      label.dir = options[selected].dir ?? '';
      items.forEach(({ item, text }, i) => {
        text.textContent = options[i].label();
        item.setAttribute('aria-selected', String(i === selected));
      });
    },
    destroy() { close(); scope.abort(); visibility.disconnect(); list.remove(); }
  };
}
