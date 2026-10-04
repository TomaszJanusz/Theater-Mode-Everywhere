const NETFLIX_UI_HOST_ID = 'theater-everywhere-ui';

/**
 * Netflix's page listener on window capture swallows composed clicks before they
 * reach a shadow-root button. button.click() is composed, so the menu never sees
 * it. A composed:false click dispatched on the button stays inside the shadow root.
 */
export function relayNetflixShadowClick(event: Event, hostId = NETFLIX_UI_HOST_ID): boolean {
  if (!(event instanceof MouseEvent) || !event.composed || !event.bubbles) return false;
  const path = event.composedPath();
  const target = path[0];
  if (!(target instanceof Element)) return false;
  if (!path.some((node) => node instanceof Element && node.id === hostId)) return false;
  event.stopImmediatePropagation();
  return target.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    composed: false,
    clientX: event.clientX,
    clientY: event.clientY,
    button: event.button,
    buttons: event.buttons,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey
  }));
}
