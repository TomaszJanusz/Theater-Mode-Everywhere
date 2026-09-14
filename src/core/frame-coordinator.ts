import {
  createFrameMessage,
  originMatchesIframe,
  isTrustedFrameEnvelope,
  isTrustedFrameSource,
  readFrameEnvelope,
  type FrameEnvelope,
  type FrameMessageType
} from '../protocol/frame-messages';

export class FrameCoordinator {
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
    try {
      window.parent.postMessage(createFrameMessage(type, sessionId, payload, this.getNonce()), '*');
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

  readTrusted(
    event: MessageEvent,
    activeSessionId: string | null,
    activeNonce: string | null
  ): { envelope: FrameEnvelope; fromParent: boolean; fromChild: boolean } | null {
    const envelope = readFrameEnvelope(event.data);
    if (!envelope) return null;
    const iframes = Array.from(document.querySelectorAll('iframe'));
    const { fromParent, fromChild } = isTrustedFrameSource(event, this.childWindows());
    if (fromChild) {
      const iframe = iframes.find((item) => item.contentWindow === event.source);
      if (iframe && iframe.src && !originMatchesIframe(event, iframe)) return null;
    }
    if (!isTrustedFrameEnvelope(envelope, {
      eventOrigin: event.origin,
      fromParent,
      fromChild,
      activeSessionId,
      activeNonce
    })) {
      return null;
    }
    return { envelope, fromParent, fromChild };
  }
}
