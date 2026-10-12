/** Menu classes and hover/focus change visibility without changing the UI store. */
export function observeChromeVisibility(root: Document | ShadowRoot, changed: () => void): () => void {
  const selector = '.theater-menu, .theater-volume-container, .theater-speed-container, .theater-controls-wrapper';
  const observer = new MutationObserver(records => {
    if (records.some(record => record.target instanceof Element && record.target.matches(selector))) changed();
  });
  observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['class'] });
  const interaction = (event: Event) => {
    if (event.composedPath().some(node => node instanceof Element && node.matches(selector))) changed();
  };
  const events = ['pointerover', 'pointerout', 'focusin', 'focusout', 'transitionend'];
  for (const event of events) root.addEventListener(event, interaction, true);
  return () => { observer.disconnect(); for (const event of events) root.removeEventListener(event, interaction, true); };
}
