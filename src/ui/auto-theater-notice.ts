import { mountPlayerUi } from './root';
import { HUD_PLATE_CLASS } from './hud';
import { renderKbdText } from './kbd-text';
import { t } from './messages';

export const AUTO_THEATER_NOTICE_CLASS = 'theater-auto-notice';

/**
 * Corner notice for a pending automatic theater entry. It reuses the caption
 * loading plate and spinner; unlike HUDs it takes clicks, but never focus.
 * The role=status region announces itself on insertion. Returns idempotent cleanup.
 */
export function showAutoTheaterNotice(paintOverlay: (element: HTMLElement) => void, onCancel: () => void): () => void {
  const hint = t('autoEnterNoticeHint', 'Esc');
  const title = t('autoEnterNoticeTitle');
  const overlay = document.createElement('div');
  overlay.className = `theater-everywhere-caption-hud ${HUD_PLATE_CLASS} status-hud loading ${AUTO_THEATER_NOTICE_CLASS}`;
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.setAttribute('aria-label', `${title} ${hint.replace(/<\/?kbd>/g, '')}`);
  paintOverlay(overlay);

  const content = document.createElement('div');
  content.className = 'volume-hud-content caption-hud-content';
  const icon = document.createElement('div');
  icon.className = 'volume-hud-icon';
  const spinner = document.createElement('div');
  spinner.className = 'caption-hud-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  icon.appendChild(spinner);
  const copy = document.createElement('div');
  copy.className = 'volume-hud-copy';
  const titleEl = document.createElement('span');
  titleEl.className = 'volume-hud-text';
  titleEl.textContent = title;
  const hintEl = document.createElement('span');
  hintEl.className = 'volume-hud-detail theater-auto-notice-hint';
  renderKbdText(hintEl, hint);
  copy.append(titleEl, hintEl);
  content.append(icon, copy);
  overlay.appendChild(content);

  overlay.addEventListener('click', event => {
    event.stopPropagation();
    onCancel();
  });
  // Pointer presses must not reach the host player or move focus.
  overlay.addEventListener('mousedown', event => event.preventDefault());
  mountPlayerUi(overlay);
  return () => overlay.remove();
}
