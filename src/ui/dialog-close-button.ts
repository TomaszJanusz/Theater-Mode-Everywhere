const CLOSE_ICON = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;

/** The X button shared by TME dialogs; callers attach the close behavior. */
export function createDialogCloseButton(label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'theater-help-close-btn';
  button.setAttribute('aria-label', label);
  button.innerHTML = CLOSE_ICON;
  return button;
}
