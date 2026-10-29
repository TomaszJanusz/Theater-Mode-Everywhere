import { measureNextFrame } from '../core/frame-batch';

import { HUD_FADE_OUT_MS, HUD_PLATE_CLASS } from './hud-plate';
import { createLanguageHud } from './language-hud';
import { createSvgIcon } from './svg-icon';
import { isMotionReduced } from '../appearance-runtime';
import { splitTitleForTruncation, type TitleSegment } from './title-truncation';
import { announcePlayerStatus } from './root';
import { contentTitle, type ContentTitle } from '../media-features/content-title';
import { discoverParentOrigin } from '../platform/parent-origin';
import { serviceHomeUrl } from '../platform/service-home';
import type { ButtonTooltipBinder } from './button-tooltip';
import type { PlayerChromeContext } from './runtime-context';
import { systemClock, type UiClock } from './ui-clock';
import type { AudioSettingName, AudioSettings } from '../audio-settings';

export const TITLE_HUD_CLASS = 'theater-everywhere-title-hud';
export const HEADER_HUD_CLASS = 'theater-everywhere-header-hud';
// Keep centred confirmations readable for two extra seconds; loading and corner notices own their timing.
export const CENTERED_HUD_VISIBLE_MS = 800 + 2000;
/** The seek pulse in shadow.css (`theaterSeekPulse`) runs 0.65s; the node goes with it. */
export const SEEK_HUD_MS = 650;
/** Set on the player-UI host while a centred confirmation is on screen; shadow.css hides the loading spinner for it. */
export const CENTERED_HUD_ATTRIBUTE = 'data-centered-hud';
export { HUD_FADE_OUT_MS, HUD_PLATE_CLASS };

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

/** Settings rows and their confirmation HUD draw one shape set at two sizes. */
function strokeIcon(shapes: string, size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shapes}</svg>`;
}

const PICTURE_LAYOUT_SHAPES = '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="6" y="6" width="12" height="7" rx="1"/><path d="M8 17h8"/>';
export const PICTURE_LAYOUT_ICON = strokeIcon(PICTURE_LAYOUT_SHAPES, 16);
export const STATUS_HUD_LAYOUT_ICON = strokeIcon(PICTURE_LAYOUT_SHAPES, 28);

/**
 * A speed gauge whose needle leans to the slow or the fast side. Gauges read clockwise in every script,
 * so it is not mirrored for right-to-left interfaces, and it never suggests rewinding as a left-pointing arrow would.
 */
const speedGauge = (needle: string) =>
  strokeIcon(`<path d="M4.2 18.5a9 9 0 1 1 15.6 0"/><circle cx="12" cy="14" r="1.5" fill="currentColor"/><path d="M12 14${needle}"/>`, 28);
export const STATUS_HUD_SPEED_ICONS = { slower: speedGauge('L7.8 9.8'), faster: speedGauge('l4.2-4.2') } as const;

/**
 * A subwoofer seen front-on: an outlined square cabinet (its width equals its height) on two feet, centred in the 24 box like the sibling icons, and a filled membrane ring with the dust
 * cap cut out (even-odd, so any background shows through). The waves radiate on both sides as mirror images about the box centre and overhang the box (the svg is overflow: visible), so they never move the cabinet and the icon needs no RTL mirroring. They show by the svg's `data-level` (see
 * shadow.css), so the settings row, HUD and any later surface share one shape. `bass-hop` carries the
 * MOAAR rocking and `bass-cone` its jitter; their pivots are the feet at x 8.5 and 15.5, y 20.
 */
const BASS_SHAPES = '<g class="bass-hop"><g class="bass-body"><rect class="bass-cabinet" x="5" y="2.5" width="14" height="14" rx="2"/><path d="M8.5 16.5V20M15.5 16.5V20"/><path class="bass-cone" fill="currentColor" stroke="none" fill-rule="evenodd" d="M12 4.8a4.7 4.7 0 1 0 0 9.4a4.7 4.7 0 1 0 0-9.4zM12 7.8a1.7 1.7 0 1 0 0 3.4a1.7 1.7 0 1 0 0-3.4z"/></g><path class="bass-wave bass-wave-1" data-side="right" d="M22.2 7a3 3 0 0 1 0 5"/><path class="bass-wave bass-wave-2" data-side="right" d="M24.2 5.5a5 5 0 0 1 0 8"/><path class="bass-wave bass-wave-3" data-side="right" d="M26.4 4a8.5 8.5 0 0 1 0 11"/><path class="bass-wave bass-wave-1" data-side="left" d="M1.8 7a3 3 0 0 0 0 5"/><path class="bass-wave bass-wave-2" data-side="left" d="M-0.2 5.5a5 5 0 0 0 0 8"/><path class="bass-wave bass-wave-3" data-side="left" d="M-2.4 4a8.5 8.5 0 0 0 0 11"/></g>';

const AUDIO_SETTING_SHAPES: Record<AudioSettingName, string> = {
  // A speaking head.
  voice: '<path d="M8.8 20v-4.1l1.9.2a2.3 2.3 0 0 0 2.16-2.1V8.3A5.37 5.37 0 0 0 2 8.25c0 2.8.66 3.05 1 4.55a5.77 5.77 0 0 1 .03 2.76L2 20"/><path d="M19.8 17.8a7.5 7.5 0 0 0 0-10.6"/><path d="M17 15a3.5 3.5 0 0 0 0-5"/>',
  // Even level bars held between two limits.
  leveling: '<path d="M3 4h18"/><path d="M3 20h18"/><path d="M6 9v6"/><path d="M10 8v8"/><path d="M14 9v6"/><path d="M18 8v8"/>',
  bass: BASS_SHAPES
};
/** Menu and HUD size of the bass icon; `level` is also updated in place on the settings row. */
function bassIcon(size: number, level: AudioSettings['bass']): string {
  return strokeIcon(BASS_SHAPES, size).replace('<svg ', `<svg class="bass-icon" data-level="${level}" `);
}
const audioIcons = (name: AudioSettingName) => ({
  menu: strokeIcon(AUDIO_SETTING_SHAPES[name], 16),
  hud: strokeIcon(AUDIO_SETTING_SHAPES[name], 28)
});
export const AUDIO_SETTING_ICONS: Record<AudioSettingName, { menu: string; hud: string }> = {
  voice: audioIcons('voice'),
  leveling: audioIcons('leveling'),
  bass: { menu: bassIcon(16, 'original'), hud: bassIcon(28, 'original') }
};
/** The confirmation HUD shows the level just chosen. */
export function audioHudIcon(name: AudioSettingName, settings: AudioSettings): string {
  return name === 'bass' ? bassIcon(28, settings.bass) : AUDIO_SETTING_ICONS[name].hud;
}
// A speaker with a plus.
const VOLUME_BOOST_SHAPE = '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M19 9v6"/><path d="M16 12h6"/>';
export const VOLUME_BOOST_ICONS = {
  menu: strokeIcon(VOLUME_BOOST_SHAPE, 16),
  hud: strokeIcon(VOLUME_BOOST_SHAPE, 28)
};

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

function renderConfirmation(overlay: HTMLElement, icon: string, text: string, textClass = ''): void {
  const content = document.createElement('div');
  content.className = 'volume-hud-content';
  const iconElement = document.createElement('div');
  iconElement.className = 'volume-hud-icon';
  iconElement.append(createSvgIcon(icon));
  const label = document.createElement('span');
  label.className = `volume-hud-text${textClass ? ` ${textClass}` : ''}`;
  label.textContent = text;
  content.append(iconElement, label);
  overlay.replaceChildren(content);
}

/** What the HUDs read from the player: the session identity they guard on, the UI mount and the labels. */
export type HudHost = Pick<PlayerChromeContext, 'queryPlayerUi' | 'mountPlayerUi' | 'paintOverlay' | 't'> & {
  ui(): Pick<ReturnType<PlayerChromeContext['ui']>, 'toolbarVisible'>;
  session: Pick<PlayerChromeContext['session'], 'element' | 'currentEpoch'>;
};

export function createHud(ctx: HudHost, bindTooltip: ButtonTooltipBinder, clock: UiClock = systemClock) {
  function mountConfirmation(overlay: HTMLElement): void {
    if (!overlay.isConnected) ctx.mountPlayerUi(overlay);
    const svg = overlay.querySelector<SVGSVGElement>('.volume-hud-icon > svg');
    if (!svg || !svg.viewBox.baseVal.width) return;

    // SVG viewports contain unequal whitespace (and may have visible overhang).
    // Fit the existing icon wrapper to the ink once, before the first paint; CSS
    // owns the plate padding and gap. Keep the drawing's scale and animations.
    const box = svg.getBBox();
    const view = svg.viewBox.baseVal;
    const scale = svg.width.baseVal.value / view.width;
    const style = getComputedStyle(svg);
    const stroke = style.stroke === 'none' ? 0 : parseFloat(style.strokeWidth) / 2;
    svg.style.setProperty('--hud-icon-left', `${-(box.x - stroke - view.x) * scale}px`);
    svg.style.setProperty('--hud-icon-right', `${-(view.x + view.width - box.x - box.width - stroke) * scale}px`);
    svg.style.setProperty('--hud-icon-y', `${(view.y + view.height / 2 - box.y - box.height / 2) * scale}px`);
  }

  let centeredHideTimer: number | null = null;
  let centeredRemoveTimer: number | null = null;
  let centeredIdentity: object | null = null;
  // The player-UI host carries CENTERED_HUD_ATTRIBUTE while a centred HUD shows, so the loading spinner
  // (same centre, same layer) can yield through CSS alone. Only restart/remove below touch it.
  let centeredHost: Element | null = null;

  function clearCenteredTimers(): void {
    if (centeredHideTimer !== null) clock.clearTimeout(centeredHideTimer);
    if (centeredRemoveTimer !== null) clock.clearTimeout(centeredRemoveTimer);
    centeredHideTimer = centeredRemoveTimer = null;
    centeredIdentity = null;
  }

  function removeCenteredHud(): void {
    clearCenteredTimers();
    centeredHost?.removeAttribute(CENTERED_HUD_ATTRIBUTE);
    centeredHost = null;
    ctx.queryPlayerUi('.theater-everywhere-volume-overlay')?.remove();
  }

  function restartCenteredHud(overlay: HTMLElement): void {
    clearCenteredTimers();
    overlay.classList.remove('fade-out');
    const root = overlay.getRootNode();
    centeredHost = root instanceof ShadowRoot ? root.host : null;
    centeredHost?.setAttribute(CENTERED_HUD_ATTRIBUTE, '');
    const identity = {};
    centeredIdentity = identity;
    const element = ctx.session.element;
    const epoch = ctx.session.currentEpoch;
    const isCurrent = () => centeredIdentity === identity && ctx.session.element === element
      && ctx.session.currentEpoch === epoch;
    centeredHideTimer = clock.setTimeout(() => {
      if (!isCurrent()) return;
      centeredHideTimer = null;
      overlay.classList.add('fade-out');
      centeredRemoveTimer = clock.setTimeout(() => {
        if (isCurrent()) removeCenteredHud();
      }, HUD_FADE_OUT_MS);
    }, CENTERED_HUD_VISIBLE_MS);
  }

  function triggerSeekIndicator(direction: 'left' | 'right'): void {
    if (!ctx.session.element) return;

    const existing = ctx.queryPlayerUi(`.theater-everywhere-seek-overlay.${direction}`) as HTMLElement | null;
    if (existing) {
      existing.remove();
    }

    const overlay = document.createElement('div');
    overlay.className = `theater-everywhere-seek-overlay ${HUD_PLATE_CLASS} ${direction} animate`;
    ctx.paintOverlay(overlay);
    overlay.setAttribute('aria-hidden', 'true');

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
    announcePlayerStatus(ctx.t(direction === 'left' ? 'seekBackward5' : 'seekForward5'));
    overlay.appendChild(textSpan);

    ctx.mountPlayerUi(overlay);

    clock.setTimeout(() => {
      if (overlay && overlay.parentNode) {
        overlay.remove();
      }
    }, SEEK_HUD_MS);
  }

  function triggerVolumeIndicator(logicalVolume: number, muted: boolean, action: 'up' | 'down'): void {
    if (!ctx.session.element) return;

    const existing = ctx.queryPlayerUi('.theater-everywhere-volume-overlay') as HTMLElement | null;
    const overlay = existing ?? document.createElement('div');
    delete overlay.dataset.playbackAction;
    delete overlay.dataset.level;
    // Hover discovery may point elsewhere; boost belongs to the theater player.
    const isBoosted = !muted && logicalVolume > 1.0 && ctx.session.element.dataset.theaterBoostReady === 'true';
    overlay.className = `theater-everywhere-volume-overlay ${HUD_PLATE_CLASS}` + (isBoosted ? ' boosted' : '');
    ctx.paintOverlay(overlay);
    overlay.setAttribute('aria-hidden', 'true');

    const pct = muted ? 0 : (logicalVolume <= 1.0 ? Math.round(logicalVolume * 100) : Math.round(100 + (logicalVolume - 1.0) * 400));

    announcePlayerStatus(`${ctx.t('volumeLabel')}: ${pct}%`);
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

    renderConfirmation(overlay, icon, `${pct}%`, action === 'up' ? 'zoom-in' : 'zoom-out');

    mountConfirmation(overlay);

    restartCenteredHud(overlay);
  }

  /** `level` is the confirmed setting's level; the stylesheet recolours the HUD for the red bass levels. */
  function triggerStatusIndicator(text: string, icon: string, level?: string): void {
    if (!ctx.session.element) return;

    const existing = ctx.queryPlayerUi('.theater-everywhere-volume-overlay') as HTMLElement | null;
    const overlay = existing ?? document.createElement('div');
    delete overlay.dataset.playbackAction;
    delete overlay.dataset.level;
    overlay.className = `theater-everywhere-volume-overlay ${HUD_PLATE_CLASS} status-hud`;
    if (level) overlay.dataset.level = level;
    ctx.paintOverlay(overlay);
    overlay.setAttribute('aria-hidden', 'true');

    const content = document.createElement('div');
    content.className = 'volume-hud-content';
    const iconEl = document.createElement('div');
    iconEl.className = 'volume-hud-icon zoom-in';
    if (icon) iconEl.append(createSvgIcon(icon));
    const textEl = document.createElement('span');
    textEl.className = 'volume-hud-text';
    textEl.textContent = text;
    announcePlayerStatus(text);
    content.append(iconEl, textEl);
    overlay.replaceChildren(content);

    mountConfirmation(overlay);

    restartCenteredHud(overlay);
  }

  function triggerPlaybackIndicator(action: 'play' | 'pause'): void {
    if (!ctx.session.element) return;

    const existing = ctx.queryPlayerUi('.theater-everywhere-volume-overlay') as HTMLElement | null;
    // A click previews its action before the command runs; the command then
    // reports the same action and must not flash a second icon.
    if (existing?.dataset.playbackAction === action) {
      restartCenteredHud(existing);
      return;
    }

    const overlay = existing ?? document.createElement('div');
    delete overlay.dataset.level;
    overlay.className = `theater-everywhere-volume-overlay ${HUD_PLATE_CLASS}`;
    overlay.dataset.playbackAction = action;
    ctx.paintOverlay(overlay);
    overlay.setAttribute('aria-hidden', 'true');

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
    announcePlayerStatus(text);

    renderConfirmation(overlay, icon, text);

    mountConfirmation(overlay);

    restartCenteredHud(overlay);
  }

  /** Withdraws a previewed play/pause icon whose click was cancelled. */
  function dismissPlaybackIndicator(): void {
    if (ctx.queryPlayerUi('.theater-everywhere-volume-overlay[data-playback-action]')) removeCenteredHud();
  }

  const languageHud = createLanguageHud(ctx, clock);

  function createPlayerHeader(): HTMLElement {
    let header = ctx.queryPlayerUi(`.${HEADER_HUD_CLASS}`) as HTMLElement | null;
    if (!header) {
      header = document.createElement('div');
      header.className = HEADER_HUD_CLASS;
      // The containing page is the active service when the video is embedded.
      const homeUrl = serviceHomeUrl(discoverParentOrigin() || window.location.href);
      if (homeUrl) {
        const home = document.createElement('a');
        home.className = `theater-home-pill ${HUD_PLATE_CLASS}`;
        home.href = homeUrl;
        home.target = '_top';
        home.setAttribute('aria-label', ctx.t('homepage'));
        bindTooltip(home, () => ctx.t('homepage'), undefined, 'below');
        home.append(createSvgIcon('<svg class="theater-filter-glyph" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/></svg>'));
        home.addEventListener('click', (event) => event.stopPropagation());
        home.addEventListener('dblclick', (event) => event.stopPropagation());
        header.appendChild(home);
      }
      header.classList.toggle('visible', ctx.ui().toolbarVisible);
      header.inert = !ctx.ui().toolbarVisible;
      ctx.mountPlayerUi(header);
    }
    // Inline accent is captured at creation, so reapply it for a later theme change.
    ctx.paintOverlay(header);
    return header;
  }

  function syncContentTitle(title: ContentTitle | null): void {
    const header = createPlayerHeader();
    const cleaned = contentTitle(title?.title, title?.subtitle);
    const existing = ctx.queryPlayerUi(`.${TITLE_HUD_CLASS}`) as HTMLElement | null;
    if (!cleaned) {
      stopTitleWatch?.();
      existing?.remove();
      return;
    }

    let overlay = existing;
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = `${TITLE_HUD_CLASS} ${HUD_PLATE_CLASS}`;
      const keepPointerOnTitle = (event: Event) => event.stopPropagation();
      overlay.addEventListener('pointerdown', keepPointerOnTitle);
      overlay.addEventListener('mousedown', keepPointerOnTitle);
      overlay.addEventListener('click', keepPointerOnTitle);
      overlay.addEventListener('dblclick', keepPointerOnTitle);
      ctx.paintOverlay(overlay);
      const viewport = document.createElement('div');
      viewport.className = 'theater-title-hud-viewport';
      const track = document.createElement('div');
      track.className = 'theater-title-hud-track';
      const text = document.createElement('span');
      text.className = 'theater-title-hud-text';
      track.appendChild(text);
      // Reduced motion swaps the scrolling track for this static head…tail rendering (shadow.css).
      const smart = document.createElement('div');
      smart.className = 'theater-title-hud-smart';
      smart.setAttribute('aria-hidden', 'true');
      smart.append(document.createElement('span'), document.createElement('span'));
      smart.children[0].className = 'theater-title-hud-head';
      smart.children[1].className = 'theater-title-hud-tail';
      overlay.addEventListener('keydown', dismissTitleReveal);
      viewport.append(track, smart);
      overlay.appendChild(viewport);
      header.appendChild(overlay);
      watchTitleLayout(overlay, header);
    }

    const text = overlay.querySelector('.theater-title-hud-text:not(.theater-title-hud-text-clone)');
    const subtitle = text?.querySelector('.theater-title-hud-subtitle');
    if (text && (text.firstChild?.textContent !== cleaned.title || (subtitle?.textContent ?? null) !== cleaned.subtitle)) {
      renderTitleText(text, cleaned);
      renderSmartTitle(overlay.querySelector('.theater-title-hud-smart')!, cleaned);
      // Relayout restarts the marquee, so an unchanged title must not trigger it. The new title is
      // measured without the marquee in the frame's read phase, before that frame paints.
      resetTitleMarquee(overlay);
      requestTitleLayout(overlay);
    }
  }

  function renderTitleText(text: Element, content: ContentTitle): void {
    if (!content.subtitle) {
      text.replaceChildren(content.title);
      return;
    }
    const title = document.createElement('span');
    title.className = 'theater-title-hud-title';
    title.textContent = content.title;
    // Real spaces keep the copied and spoken title readable.
    const separator = document.createElement('span');
    separator.className = 'theater-title-hud-separator';
    separator.textContent = ' • ';
    const subtitle = document.createElement('span');
    subtitle.className = 'theater-title-hud-subtitle';
    subtitle.textContent = content.subtitle;
    text.replaceChildren(title, separator, subtitle);
  }

  function renderSmartTitle(smart: Element, content: ContentTitle): void {
    const segments: TitleSegment[] = content.subtitle
      ? [{ text: content.title, className: 'theater-title-hud-title' }, { text: ' • ', className: 'theater-title-hud-separator' },
        { text: content.subtitle, className: 'theater-title-hud-subtitle' }]
      : [{ text: content.title }];
    const { head, tail } = splitTitleForTruncation(segments);
    const render = (parts: readonly TitleSegment[]) => parts.map(part => {
      const span = document.createElement('span');
      if (part.className) span.className = part.className;
      span.textContent = part.text;
      return span;
    });
    smart.children[0].replaceChildren(...render(head));
    smart.children[1].replaceChildren(...render(tail));
  }

  // The first Escape only closes a keyboard reveal; theater exit keeps working afterwards.
  function dismissTitleReveal(event: KeyboardEvent): void {
    const overlay = event.currentTarget as HTMLElement;
    if (event.key !== 'Escape' || !overlay.matches(':focus-visible')) return;
    event.preventDefault();
    event.stopPropagation();
    overlay.blur();
  }

  let stopTitleWatch: (() => void) | null = null;
  /**
   * Re-lays out the title when the header width or the Reduce motion setting changes. Both
   * are events, coalesced to one frame; nothing runs per playback tick.
   */
  function watchTitleLayout(overlay: HTMLElement, header: HTMLElement): void {
    stopTitleWatch?.();
    const relayout = () => requestTitleLayout(overlay);
    const size = typeof ResizeObserver === 'function' ? new ResizeObserver(relayout) : null;
    size?.observe(header);
    const host = (header.getRootNode() as ShadowRoot).host;
    const motion = host && typeof MutationObserver === 'function' ? new MutationObserver(relayout) : null;
    motion?.observe(host, { attributes: true, attributeFilter: ['data-motion'] });
    stopTitleWatch = () => {
      cancelTitleLayout?.();
      cancelTitleLayout = null;
      size?.disconnect();
      motion?.disconnect();
      stopTitleWatch = null;
    };
  }

  let cancelTitleLayout: (() => void) | null = null;
  /** Lays the title out in the frame's read phase, once per frame. */
  function requestTitleLayout(overlay: HTMLElement): void {
    if (cancelTitleLayout) return;
    cancelTitleLayout = measureNextFrame(window, () => {
      cancelTitleLayout = null;
      if (!overlay.isConnected) {
        stopTitleWatch?.();
        return;
      }
      // A running marquee changes the widths it depends on; it is reset and measured again.
      if (overlay.classList.contains('marquee')) return () => layoutTitleMarquee(overlay);
      const widths = measureTitleMarquee(overlay);
      return widths ? () => applyTitleMarquee(overlay, widths) : undefined;
    });
  }

  type TitleParts = { track: HTMLElement; text: HTMLElement; viewport: HTMLElement };
  function titleParts(overlay: HTMLElement): TitleParts | null {
    const track = overlay.querySelector('.theater-title-hud-track') as HTMLElement | null;
    const text = track?.querySelector('.theater-title-hud-text:not(.theater-title-hud-text-clone)') as HTMLElement | null;
    const viewport = overlay.querySelector('.theater-title-hud-viewport') as HTMLElement | null;
    return track && text && viewport ? { track, text, viewport } : null;
  }

  function resetTitleMarquee(overlay: HTMLElement): void {
    overlay.classList.remove('marquee');
    overlay.querySelector('.theater-title-hud-text-clone')?.remove();
    overlay.style.removeProperty('--theater-title-duration');
    overlay.removeAttribute('title');
  }

  /** The title's width and the room for it, read while no marquee runs. */
  function measureTitleMarquee(overlay: HTMLElement): { viewWidth: number; textWidth: number } | null {
    const parts = titleParts(overlay);
    return parts ? { viewWidth: parts.viewport.clientWidth, textWidth: parts.text.scrollWidth } : null;
  }

  function layoutTitleMarquee(overlay: HTMLElement): void {
    resetTitleMarquee(overlay);
    const widths = measureTitleMarquee(overlay);
    if (widths) applyTitleMarquee(overlay, widths);
  }

  function applyTitleMarquee(overlay: HTMLElement, { viewWidth, textWidth }: { viewWidth: number; textWidth: number }): void {
    const parts = titleParts(overlay);
    if (!parts) return;
    // Only a reduced-motion overflowing title is focusable. Changing the attribute only when it
    // differs keeps focus on the title across a relayout.
    const focusable = viewWidth > 0 && textWidth > viewWidth + 1 && isMotionReduced();
    if (focusable) { if (!overlay.hasAttribute('tabindex')) overlay.tabIndex = 0; }
    else overlay.removeAttribute('tabindex');
    if (viewWidth <= 0 || textWidth <= viewWidth + 1) return;

    // Reduced motion shows a static head…tail and reveals the full title on hover/focus
    // (see shadow.css). Assistive technology reads the whole text either way.
    overlay.classList.add('marquee');
    if (!isMotionReduced()) overlay.title = parts.text.textContent ?? '';
    const clone = parts.text.cloneNode(true) as HTMLElement;
    clone.classList.add('theater-title-hud-text-clone');
    clone.setAttribute('aria-hidden', 'true');
    parts.track.appendChild(clone);

    const travel = parts.text.offsetWidth;
    const scrollSeconds = travel / 80;
    const duration = Math.min(16, Math.max(6, scrollSeconds / 0.84));
    overlay.style.setProperty('--theater-title-duration', `${duration.toFixed(2)}s`);
  }

  return {
    triggerSeekIndicator,
    triggerVolumeIndicator,
    triggerStatusIndicator,
    triggerPlaybackIndicator,
    dismissPlaybackIndicator,
    ...languageHud,
    removeCenteredHud,
    createPlayerHeader,
    syncContentTitle
  };
}
