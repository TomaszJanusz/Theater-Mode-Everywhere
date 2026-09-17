import type { PlayerChromeContext } from './runtime-context';

export const STATUS_HUD_SWITCH_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"></path>
  </svg>
`;

export const STATUS_HUD_FIT_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 3H5a2 2 0 0 0-2 2v3"></path>
    <path d="M16 3h3a2 2 0 0 1 2 2v3"></path>
    <path d="M8 21H5a2 2 0 0 1-2-2v-3"></path>
    <path d="M16 21h3a2 2 0 0 0 2-2v-3"></path>
    <rect x="8" y="8" width="8" height="8" rx="1"></rect>
  </svg>
`;

export type CaptionHudView =
  | { kind: 'dismiss' }
  | { kind: 'loading'; title: string }
  | { kind: 'status'; title: string; detail?: string };

export const STATUS_HUD_MUTE_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
    <line x1="23" y1="9" x2="17" y2="15"></line>
    <line x1="17" y1="9" x2="23" y2="15"></line>
  </svg>
`;

export const STATUS_HUD_UNMUTE_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
  </svg>
`;

export function createHud(ctx: PlayerChromeContext) {
  function triggerSeekIndicator(direction: 'left' | 'right'): void {
    if (!ctx.session.element) return;

    const existing = ctx.queryPlayerUi(`.theater-everywhere-seek-overlay.${direction}`) as HTMLElement | null;
    if (existing) {
      existing.remove();
    }

    const overlay = document.createElement('div');
    overlay.className = `theater-everywhere-seek-overlay ${direction} animate`;
    ctx.paintOverlay(overlay);

    const iconWrapper = document.createElement('div');
    iconWrapper.className = 'seek-icon-wrapper';

    if (direction === 'left') {
      ['left-3', 'left-2', 'left-1'].forEach(cls => {
        const arrow = document.createElement('div');
        arrow.className = `seek-arrow left ${cls}`;
        iconWrapper.appendChild(arrow);
      });
      overlay.appendChild(iconWrapper);
    } else {
      ['right-1', 'right-2', 'right-3'].forEach(cls => {
        const arrow = document.createElement('div');
        arrow.className = `seek-arrow right ${cls}`;
        iconWrapper.appendChild(arrow);
      });
      overlay.appendChild(iconWrapper);
    }

    const textSpan = document.createElement('span');
    textSpan.textContent = ctx.t('fiveSeconds');
    overlay.appendChild(textSpan);

    ctx.mountPlayerUi(overlay);

    setTimeout(() => {
      if (overlay && overlay.parentNode) {
        overlay.remove();
      }
    }, 650);
  }

  function triggerVolumeIndicator(logicalVolume: number, muted: boolean, action: 'up' | 'down'): void {
    if (!ctx.session.element) return;

    const existing = ctx.queryPlayerUi('.theater-everywhere-volume-overlay') as HTMLElement | null;
    if (existing) {
      existing.remove();
    }

    const overlay = document.createElement('div');
    const isBoosted = !muted && logicalVolume > 1.0 && ctx.refs.activeVideo?.dataset.theaterBoostReady === 'true';
    overlay.className = 'theater-everywhere-volume-overlay' + (isBoosted ? ' boosted' : '');
    ctx.paintOverlay(overlay);

    const pct = muted ? 0 : (logicalVolume <= 1.0 ? Math.round(logicalVolume * 100) : Math.round(100 + (logicalVolume - 1.0) * 400));

    let icon = '';
    if (muted || pct === 0) {
      icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
      <line x1="23" y1="9" x2="17" y2="15"></line>
      <line x1="17" y1="9" x2="23" y2="15"></line>
    </svg>`;
    } else if (pct < 50) {
      icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
    </svg>`;
    } else {
      icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
    </svg>`;
    }

    overlay.innerHTML = `
    <div class="volume-hud-content">
      <div class="volume-hud-icon" style="${isBoosted ? 'color: #f59e0b;' : ''}">${icon}</div>
      <span class="volume-hud-text ${action === 'up' ? 'zoom-in' : 'zoom-out'}">${pct}%</span>
    </div>
  `;

    ctx.mountPlayerUi(overlay);

    setTimeout(() => {
      overlay.classList.add('fade-out');
      setTimeout(() => {
        overlay.remove();
      }, 200);
    }, 800);
  }

  function triggerStatusIndicator(text: string, icon: string): void {
    if (!ctx.session.element) return;

    const existing = ctx.queryPlayerUi('.theater-everywhere-volume-overlay') as HTMLElement | null;
    if (existing) {
      existing.remove();
    }

    const overlay = document.createElement('div');
    overlay.className = 'theater-everywhere-volume-overlay status-hud';
    ctx.paintOverlay(overlay);

    const content = document.createElement('div');
    content.className = 'volume-hud-content';
    const iconEl = document.createElement('div');
    iconEl.className = 'volume-hud-icon zoom-in';
    iconEl.innerHTML = icon;
    const textEl = document.createElement('span');
    textEl.className = 'volume-hud-text';
    textEl.textContent = text;
    content.append(iconEl, textEl);
    overlay.appendChild(content);

    ctx.mountPlayerUi(overlay);

    setTimeout(() => {
      overlay.classList.add('fade-out');
      setTimeout(() => {
        overlay.remove();
      }, 200);
    }, 800);
  }

  function triggerPlaybackIndicator(action: 'play' | 'pause'): void {
    if (!ctx.session.element) return;

    const existing = ctx.queryPlayerUi('.theater-everywhere-volume-overlay') as HTMLElement | null;
    if (existing) {
      existing.remove();
    }

    const overlay = document.createElement('div');
    overlay.className = 'theater-everywhere-volume-overlay';
    ctx.paintOverlay(overlay);

    let icon = '';
    if (action === 'play') {
      icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="5 3 19 12 5 21 5 3"></polygon>
    </svg>`;
    } else {
      icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="6" y="4" width="4" height="16"></rect>
      <rect x="14" y="4" width="4" height="16"></rect>
    </svg>`;
    }

    const text = action === 'play' ? ctx.t('play') : ctx.t('pause');

    overlay.innerHTML = `
    <div class="volume-hud-content">
      <div class="volume-hud-icon">${icon}</div>
      <span class="volume-hud-text ${action === 'play' ? 'zoom-in' : 'zoom-out'}">${text}</span>
    </div>
  `;

    ctx.mountPlayerUi(overlay);

    setTimeout(() => {
      overlay.classList.add('fade-out');
      setTimeout(() => {
        overlay.remove();
      }, 200);
    }, 800);
  }

  let captionHudHideTimer: ReturnType<typeof setTimeout> | null = null;
  let captionHudRemoveTimer: ReturnType<typeof setTimeout> | null = null;

  function clearCaptionHudTimers(): void {
    if (captionHudHideTimer) {
      clearTimeout(captionHudHideTimer);
      captionHudHideTimer = null;
    }
    if (captionHudRemoveTimer) {
      clearTimeout(captionHudRemoveTimer);
      captionHudRemoveTimer = null;
    }
  }

  function removeCaptionHud(): void {
    clearCaptionHudTimers();
    ctx.queryPlayerUi('.theater-everywhere-caption-hud')?.remove();
  }

  function triggerCaptionHud(view: CaptionHudView): void {
    if (view.kind === 'dismiss') {
      removeCaptionHud();
      return;
    }

    if (!ctx.session.element) return;

    removeCaptionHud();

    const overlay = document.createElement('div');
    overlay.className = 'theater-everywhere-caption-hud status-hud' + (view.kind === 'loading' ? ' loading' : '');
    ctx.paintOverlay(overlay);

    const content = document.createElement('div');
    content.className = view.kind === 'status'
      ? 'volume-hud-content caption-hud-content'
      : 'volume-hud-content';

    let iconEl: HTMLDivElement | null = null;
    if (view.kind === 'loading') {
      iconEl = document.createElement('div');
      iconEl.className = 'volume-hud-icon';
      const spinner = document.createElement('div');
      spinner.className = 'caption-hud-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      iconEl.appendChild(spinner);
    }

    const copy = document.createElement('div');
    copy.className = 'volume-hud-copy';
    const textEl = document.createElement('span');
    textEl.className = 'volume-hud-text';
    textEl.textContent = view.title;
    copy.appendChild(textEl);
    if (view.kind === 'status' && view.detail) {
      const detailEl = document.createElement('span');
      detailEl.className = 'volume-hud-detail';
      detailEl.textContent = view.detail;
      copy.appendChild(detailEl);
    }

    if (iconEl) content.appendChild(iconEl);
    content.appendChild(copy);
    overlay.appendChild(content);
    ctx.mountPlayerUi(overlay);

    if (view.kind === 'loading') return;

    const displayDuration = view.kind === 'status' && view.detail ? 4_000 : 800;
    captionHudHideTimer = setTimeout(() => {
      overlay.classList.add('fade-out');
      captionHudRemoveTimer = setTimeout(() => {
        if (overlay.parentNode) overlay.remove();
      }, 200);
    }, displayDuration);
  }

  return {
    triggerSeekIndicator,
    triggerVolumeIndicator,
    triggerStatusIndicator,
    triggerPlaybackIndicator,
    triggerCaptionHud
  };
}
