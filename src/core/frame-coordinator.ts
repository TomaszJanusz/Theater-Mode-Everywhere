import {
  createFrameMessage,
  originMatchesIframe,
  isTrustedFrameEnvelope,
  isTrustedFrameSource,
  readFrameEnvelope,
  type FrameEnvelope,
  type FrameMessageType
} from '../protocol/frame-messages';
import { discoverParentOrigin, resolveParentMessageTarget } from '../platform/parent-origin';

export class FrameCoordinator {
  private parentOrigin: string | null = null;

  constructor(private readonly getNonce: () => string) {}

  childWindows(): Array<Window | null> {
    return Array.from(document.querySelectorAll('iframe')).map((iframe) => iframe.contentWindow);
  }

  iframeOrigin(iframe: HTMLIFrameElement): string {
    try {
      if (iframe.src) return new URL(iframe.src, window.location.href).origin;
    } catch {
      // Invalid iframe src; fall back to wildcard.
    }
    return '*';
  }

  postToParent(type: FrameMessageType, sessionId: string, payload: Record<string, unknown> = {}): void {
    if (window === window.top) return;
    const target = resolveParentMessageTarget(this.parentOrigin, discoverParentOrigin());
    if (!target) return;
    try {
      window.parent.postMessage(createFrameMessage(type, sessionId, payload, this.getNonce()), target);
    } catch {
      // Ignore cross-origin frame access errors.
    }
  }

  postToChildIframe(
    iframe: HTMLIFrameElement,
    type: FrameMessageType,
    sessionId: string,
    payload: Record<string, unknown> = {},
    nonce = this.getNonce()
  ): void {
    if (!iframe.contentWindow) return;
    try {
      iframe.contentWindow.postMessage(createFrameMessage(type, sessionId, payload, nonce), this.iframeOrigin(iframe));
    } catch {
      // Ignore cross-origin frame access errors.
    }
  }

  postToAllChildren(
    type: FrameMessageType,
    sessionId: string,
    payload: Record<string, unknown> = {},
    nonce = this.getNonce()
  ): void {
    document.querySelectorAll('iframe').forEach((iframe) => {
      this.postToChildIframe(iframe, type, sessionId, payload, nonce);
    });
  }

  /**
   * Accepts a frame message only when its source, origin, and session credentials satisfy the
   * protocol policy. A verified parent origin is retained for subsequent messages.
   */
  readTrusted(
    event: MessageEvent,
    activeSessionId: string | null,
    activeNonce: string | null
  ): { envelope: FrameEnvelope; fromParent: boolean; fromChild: boolean } | null {
    const envelope = readFrameEnvelope(event.data);
    if (!envelope) return null;
    const iframes = Array.from(document.querySelectorAll('iframe'));
    const { fromParent, fromChild } = isTrustedFrameSource(event, this.childWindows());
    const hasValidCredentials = Boolean(
      activeSessionId
      && activeNonce
      && envelope.sessionId === activeSessionId
      && envelope.nonce === activeNonce
    );
    let trustedOrigin = false;
    if (fromParent) {
      const expectedParentOrigin = resolveParentMessageTarget(this.parentOrigin, discoverParentOrigin());
      trustedOrigin = Boolean(
        event.origin
        && event.origin !== 'null'
        && expectedParentOrigin
        && expectedParentOrigin !== '*'
        && event.origin === expectedParentOrigin
      );
    }
    if (fromChild) {
      const iframe = iframes.find((item) => item.contentWindow === event.source);
      if (iframe && iframe.src) {
        if (!originMatchesIframe(event, iframe)) return null;
        trustedOrigin = true;
      }
    }
    if (!isTrustedFrameEnvelope(envelope, {
      eventOrigin: event.origin,
      trustedOrigin,
      fromParent,
      fromChild,
      activeSessionId,
      activeNonce
    })) {
      return null;
    }
    if (
      fromParent
      && (trustedOrigin || hasValidCredentials)
      && event.origin
      && event.origin !== 'null'
      && (!this.parentOrigin || this.parentOrigin === event.origin)
    ) {
      this.parentOrigin = event.origin;
    }
    return { envelope, fromParent, fromChild };
  }
}
