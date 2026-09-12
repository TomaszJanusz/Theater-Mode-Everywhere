const PLAY_CONTROL_SELECTOR =
  'button, [role="button"], .ytp-large-play-button, .vjs-big-play-button, .plyr__control--overlaid';

function isTheaterUiNode(node: Element): boolean {
  if (node.id === 'theater-everywhere-ui') return true;
  return Boolean(node.closest('#theater-everywhere-ui'));
}

export function mediaHasSource(video: HTMLVideoElement): boolean {
  if (video.currentSrc || video.src || video.srcObject) return true;
  return Boolean(video.querySelector('source[src]'));
}

export function isHostPlayControlLabel(aria: string, text: string, className = ''): boolean {
  if (/\b(?:ytp-large-play-button|vjs-big-play-button|plyr__control--overlaid)\b/.test(className)) {
    return true;
  }
  const playWord = /^(play|odtwórz|odtworz)(\s*\([^)]*\))?$/i;
  return playWord.test(aria.trim()) || playWord.test(text.replace(/\s+/g, ' ').trim());
}

export function looksLikeHostPlayButton(el: HTMLElement): boolean {
  if (isTheaterUiNode(el)) return false;
  return isHostPlayControlLabel(
    el.getAttribute('aria-label') || '',
    el.textContent || '',
    el.className.toString()
  );
}

export function findHostPlayButton(video: HTMLVideoElement): HTMLElement | null {
  const scan = (root: ParentNode): HTMLElement | null => {
    const candidates = root.querySelectorAll(PLAY_CONTROL_SELECTOR);
    for (const node of candidates) {
      if (node instanceof HTMLElement && looksLikeHostPlayButton(node)) return node;
    }
    return null;
  };

  let node: Node | null = video.parentNode;
  while (node) {
    if (node instanceof Element || node instanceof Document || node instanceof ShadowRoot) {
      const found = scan(node);
      if (found) return found;
    }
    node = node instanceof ShadowRoot ? node.host : node.parentNode;
  }
  return null;
}

export function requestVideoPlay(video: HTMLVideoElement): void {
  if (mediaHasSource(video)) {
    video.play().catch((err) => {
      console.error('[Theater Everywhere] Play failed:', err);
    });
    return;
  }

  const hostPlay = findHostPlayButton(video);
  if (hostPlay) {
    hostPlay.click();
    return;
  }

  // video.play() on an empty element hangs playback and can hide the host overlay.
  console.warn('[Theater Everywhere] No media source and no host play control found');
}

export function toggleVideoPlayback(video: HTMLVideoElement): void {
  if (!mediaHasSource(video) || video.paused) {
    requestVideoPlay(video);
    return;
  }
  video.pause();
}
