import { DisposableScope } from '../core/disposable-scope';

/**
 * Keeps the player UI host in the browser top layer as a manual popover.
 *
 * Z-index cannot beat page dialogs or popovers; the top layer can. The top layer
 * orders by when an element entered it, so the host must re-enter after anything
 * that would cover it:
 * - Fullscreen: `documentElement` joins the top layer after the host and paints over it.
 * - A page popover (or dialog, where the browser fires `toggle` for it) that opens later.
 * Native chat (`data-theater-chat-active`) keeps the host out of the top layer: service popups
 * there rely on z-index to sit above the chrome, and the top layer would cover them.
 * A fullscreen element that does not contain the host (a page's own player, say) also keeps it
 * out: pointer input goes to that element, so a host painted over it would look usable and not be.
 * Out of the top layer the fullscreen element covers it until fullscreen ends.
 * A page modal dialog keeps it out for the same reason: the rest of the document is inert, so
 * above the backdrop the host would look usable and not be. Dialogs fire `toggle` when they open
 * and close (Chromium 132, Firefox 133); in older Chromium a dialog shown before the host keeps it
 * out (z-index still applies) until the next `ensure` or top-layer event.
 * Not detectable without observers: a page re-attaching the host (`ensure` covers the next mount).
 * Elements shown before the host entered stay below it.
 */
export interface TopLayerBinding {
  /** Shows the host if the binding is live and the host is not open. Safe to repeat. */
  ensure(): void;
  /** Stops listening and hides the host. Safe to repeat. */
  dispose(): void;
}

// Set on <html> by the chat controller while service chat shares the stage.
const CHAT_ACTIVE = 'data-theater-chat-active';

const NOOP: TopLayerBinding = { ensure() {}, dispose() {} };

export function supportsTopLayer(): boolean {
  return typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';
}

function isOpen(host: HTMLElement): boolean {
  return host.matches(':popover-open');
}

export function bindTopLayer(host: HTMLElement): TopLayerBinding {
  if (!supportsTopLayer()) return NOOP;
  const scope = new DisposableScope();
  let frame = false;
  host.popover = 'manual';

  // Throws when disconnected or already open; both are expected here.
  const wanted = () => {
    if (document.documentElement.hasAttribute(CHAT_ACTIVE)) return false;
    const fullscreen = document.fullscreenElement;
    if (fullscreen && !fullscreen.contains(host)) return false;
    return !document.querySelector('dialog:modal');
  };
  const show = () => {
    if (scope.isDisposed || !host.isConnected || isOpen(host) || !wanted()) return;
    host.showPopover();
  };
  // Re-entering moves the host to the end of the top layer.
  const raise = () => {
    if (scope.isDisposed || !host.isConnected) return;
    if (isOpen(host)) host.hidePopover();
    show();
  };
  const sync = () => {
    if (wanted()) raise();
    else if (isOpen(host)) host.hidePopover();
  };
  const raiseNextFrame = () => {
    if (frame) return;
    frame = true;
    scope.raf(() => {
      frame = false;
      raise();
    });
  };

  scope.listen(document, 'fullscreenchange', sync);
  // `toggle` does not bubble; the capture listener sees every page popover and dialog. Opening
  // raises the host over it, or hides it for a modal dialog; closing lets it back after a dialog.
  // The host's own events are ignored so raising cannot retrigger itself.
  scope.listen(document, 'toggle', (event) => {
    if (event.target !== host) raiseNextFrame();
  }, true);
  // Something other than us closed the host (Escape does not close manual popovers).
  scope.listen(host, 'toggle', () => { if (!isOpen(host) && wanted()) raiseNextFrame(); });

  const observer = new MutationObserver(sync);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [CHAT_ACTIVE] });
  scope.add(() => observer.disconnect());

  show();
  return {
    ensure: show,
    dispose() {
      if (scope.isDisposed) return;
      scope.dispose();
      if (host.isConnected && isOpen(host)) host.hidePopover();
    }
  };
}
