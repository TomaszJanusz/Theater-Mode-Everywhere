/**
 * Shows one settings panel at a time. Tabs and panels are paired through
 * `aria-controls`; the selected panel id lives in the URL hash so a reload or a
 * link such as `options.html#shortcuts` lands on the same section.
 */
export function setupSettingsTabs(tablist: HTMLElement): void {
  const tabs = Array.from(tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const panelFor = (tab: HTMLElement) => document.getElementById(tab.getAttribute('aria-controls') ?? '');
  if (tabs.length === 0) return;

  function select(tab: HTMLButtonElement, { focus = false, updateHash = true } = {}): void {
    for (const candidate of tabs) {
      const selected = candidate === tab;
      candidate.setAttribute('aria-selected', String(selected));
      candidate.tabIndex = selected ? 0 : -1;
      const panel = panelFor(candidate);
      if (panel) panel.hidden = !selected;
    }
    if (focus) tab.focus();
    const id = tab.getAttribute('aria-controls');
    if (updateHash && id) history.replaceState(null, '', `#${id}`);
  }

  function tabFromHash(): HTMLButtonElement | undefined {
    let id: string;
    try {
      id = decodeURIComponent(location.hash.slice(1));
    } catch {
      // A malformed escape (`#%`) is just an unknown tab; it must not stop the page from initializing.
      return undefined;
    }
    return tabs.find((tab) => tab.getAttribute('aria-controls') === id);
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab));
  }

  tablist.addEventListener('keydown', (event) => {
    const index = tabs.findIndex((tab) => tab === document.activeElement);
    if (index < 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    const rtl = getComputedStyle(tablist).direction === 'rtl';
    let next: number;
    switch (event.key) {
      case 'ArrowRight': next = index + (rtl ? -1 : 1); break;
      case 'ArrowLeft': next = index + (rtl ? 1 : -1); break;
      case 'Home': next = 0; break;
      case 'End': next = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    select(tabs[(next + tabs.length) % tabs.length], { focus: true });
  });

  window.addEventListener('hashchange', () => {
    const tab = tabFromHash();
    if (tab) select(tab, { updateHash: false });
  });

  select(tabFromHash() ?? tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') ?? tabs[0], {
    updateHash: false
  });
}
