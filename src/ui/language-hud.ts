import { HUD_FADE_OUT_MS, HUD_PLATE_CLASS } from './hud-plate';
import {
  LanguageNotice, languageNoticeText,
  type LanguageChanges, type LanguageLine, type LanguageLines, type LanguageNoticeView, type LanguageSource
} from './language-notice';
import { announcePlayerStatus } from './root';
import type { PlayerChromeContext } from './runtime-context';
import { animateReveal, exitSpinner, isElementMotionReduced } from './spinner-exit';
import type { UiClock } from './ui-clock';

/** The subtitles line of the language notice, or `dismiss` to withdraw it. */
export type CaptionHudView = { kind: 'dismiss' } | LanguageLine;

type LanguageHudHost = Pick<PlayerChromeContext, 'mountPlayerUi' | 'paintOverlay'> & {
  session: Pick<PlayerChromeContext['session'], 'element' | 'currentEpoch'>;
};
type StatusLine = Extract<LanguageLine, { kind: 'status' }>;
type PlateBox = { box: DOMRect; tops: Array<readonly [LanguageSource, number]> };

const PLATE_MORPH_MS = 225;

const lineNode = (plate: HTMLElement, source: LanguageSource) =>
  plate.querySelector<HTMLElement>(`:scope > [data-language-line="${source}"]`);

function detailNode(text: string): HTMLElement {
  const detail = document.createElement('span');
  detail.className = 'volume-hud-detail';
  detail.textContent = text;
  return detail;
}

function buildLine(source: LanguageSource, line: LanguageLine): HTMLElement {
  const node = document.createElement('div');
  node.className = 'volume-hud-content caption-hud-content';
  node.dataset.languageLine = source;
  if (line.kind === 'loading') {
    node.classList.add('loading');
    const slot = document.createElement('div');
    slot.className = 'volume-hud-icon caption-hud-spinner-slot';
    const spinner = document.createElement('div');
    spinner.className = 'caption-hud-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    slot.appendChild(spinner);
    node.appendChild(slot);
  }
  const copy = document.createElement('div');
  copy.className = 'volume-hud-copy';
  const text = document.createElement('span');
  text.className = 'volume-hud-text';
  text.textContent = line.title;
  copy.appendChild(text);
  if (line.kind === 'status' && line.detail) copy.appendChild(detailNode(line.detail));
  node.appendChild(copy);
  return node;
}

/** Where the plate and its lines are now, running motion included, so an update can ease from there. */
function measurePlate(plate: HTMLElement): PlateBox {
  return {
    box: plate.getBoundingClientRect(),
    tops: [...plate.querySelectorAll<HTMLElement>(':scope > [data-language-line]')]
      .map(node => [node.dataset.languageLine as LanguageSource, node.getBoundingClientRect().top] as const)
  };
}

/**
 * The language notice on screen: one plate, one line per source. Each line keeps its node and its
 * own motion (a spinner's exit, a reveal), so painting one line never restarts or cuts another's.
 */
class LanguagePlate implements LanguageNoticeView {
  private plate: HTMLElement | null = null;
  /** The plate's size morph and the slides of lines that move; one set at a time. */
  private plateMotion: Animation[] = [];
  private readonly lineMotion = new Map<LanguageSource, () => void>();

  constructor(
    private readonly host: LanguageHudHost,
    private readonly clock: UiClock,
    private readonly isCurrent: () => boolean
  ) {}

  render(lines: LanguageLines, changed: ReadonlySet<LanguageSource>): void {
    announcePlayerStatus(languageNoticeText(lines));
    const existing = this.plate?.isConnected ? this.plate : null;
    const plate = existing ?? document.createElement('div');
    const before = existing && !isElementMotionReduced(existing) ? measurePlate(existing) : null;
    this.stopPlateMotion();
    plate.className = `theater-everywhere-caption-hud ${HUD_PLATE_CLASS} status-hud`
      + (lines.some(([, line]) => line.kind === 'loading') ? ' loading' : '');
    this.host.paintOverlay(plate);
    plate.setAttribute('aria-hidden', 'true');

    const shown = new Set(lines.map(([source]) => source));
    for (const node of plate.querySelectorAll<HTMLElement>(':scope > [data-language-line]')) {
      const source = node.dataset.languageLine as LanguageSource;
      if (shown.has(source)) continue;
      this.stopLineMotion(source);
      node.remove();
    }
    let anchor = plate.firstElementChild;
    for (const [source, line] of lines) {
      const current = lineNode(plate, source);
      const node = current && !changed.has(source) ? current : this.renderLine(plate, source, line, !existing);
      if (node !== anchor) plate.insertBefore(node, anchor);
      anchor = node.nextElementSibling;
    }
    if (!existing) {
      this.host.mountPlayerUi(plate);
      this.plate = plate;
    }
    if (before) this.morph(plate, before);
  }

  fadeOut(): void {
    this.plate?.classList.add('fade-out');
  }

  remove(): void {
    for (const source of [...this.lineMotion.keys()]) this.stopLineMotion(source);
    this.stopPlateMotion();
    this.plate?.remove();
    this.plate = null;
  }

  /**
   * A status updates its line in place, so a spinner there zooms out into the new detail; a loading
   * line, or a line the plate did not have, is built new.
   */
  private renderLine(plate: HTMLElement, source: LanguageSource, line: LanguageLine, freshPlate: boolean): HTMLElement {
    this.stopLineMotion(source);
    const current = lineNode(plate, source);
    if (current && line.kind === 'status') {
      this.updateStatus(current, source, line);
      return current;
    }
    const node = buildLine(source, line);
    current?.replaceWith(node);
    if (isElementMotionReduced(plate)) return node;
    // A line joining a plate on screen fades in; a fresh plate reveals its detail as one notice always has.
    const detail = node.querySelector<HTMLElement>('.volume-hud-detail');
    const reveal = freshPlate ? detail && animateReveal(detail) : animateReveal(node);
    if (reveal) this.lineMotion.set(source, () => reveal.cancel());
    return node;
  }

  private updateStatus(current: HTMLElement, source: LanguageSource, line: StatusLine): void {
    current.classList.remove('loading');
    const text = current.querySelector<HTMLElement>('.volume-hud-text')!;
    text.textContent = line.title;
    current.querySelector('.volume-hud-detail')?.remove();
    const detail = line.detail ? detailNode(line.detail) : undefined;
    if (detail) text.after(detail);
    const spinner = current.querySelector<HTMLElement>('.caption-hud-spinner');
    if (spinner) {
      this.lineMotion.set(source, exitSpinner(spinner, {
        mode: 'passive', reveal: detail, clock: this.clock,
        isCurrent: () => current.isConnected && this.isCurrent()
      }));
    } else if (detail && !isElementMotionReduced(current)) {
      const reveal = animateReveal(detail);
      this.lineMotion.set(source, () => reveal.cancel());
    }
  }

  /**
   * Eases the plate from its old size to the new one and slides the lines that stay to their new
   * place, so nothing on screen jumps. The plate clips its overflow and each line holds its final
   * width meanwhile, so a line wider than the easing box is cut at its start edge, never rewrapped.
   */
  private morph(plate: HTMLElement, before: PlateBox): void {
    const box = plate.getBoundingClientRect();
    const from: Keyframe = {};
    const to: Keyframe = {};
    if (Math.abs(box.width - before.box.width) > 0.5) {
      from.width = `${before.box.width}px`;
      to.width = `${box.width}px`;
    }
    if (Math.abs(box.height - before.box.height) > 0.5) {
      from.height = `${before.box.height}px`;
      to.height = `${box.height}px`;
    }
    if (!Object.keys(from).length) return;
    const timing = { duration: PLATE_MORPH_MS, easing: 'ease' };
    const tops = new Map(before.tops);
    for (const node of plate.querySelectorAll<HTMLElement>(':scope > [data-language-line]')) {
      const rect = node.getBoundingClientRect();
      const top = tops.get(node.dataset.languageLine as LanguageSource);
      const minWidth = `${rect.width}px`;
      // A line that just joined has its own reveal; one that stays slides from where it was.
      this.plateMotion.push(node.animate(top === undefined ? [{ minWidth }, { minWidth }]
        : [{ minWidth, translate: `0 ${top - rect.top}px` }, { minWidth, translate: '0 0' }], timing));
    }
    this.plateMotion.push(plate.animate([from, to], timing));
  }

  private stopLineMotion(source: LanguageSource): void {
    this.lineMotion.get(source)?.();
    this.lineMotion.delete(source);
  }

  private stopPlateMotion(): void {
    for (const animation of this.plateMotion) animation.cancel();
    this.plateMotion = [];
  }
}

/** The language notice for one player UI: subtitles and audio lines merged into one plate. */
export function createLanguageHud(host: LanguageHudHost, clock: UiClock) {
  const notice: LanguageNotice = new LanguageNotice(clock, new LanguagePlate(host, clock, () => notice.isCurrent()),
    () => host.session.element ? { element: host.session.element, epoch: host.session.currentEpoch } : null, HUD_FADE_OUT_MS);
  return {
    /** Sets lines of the notice; a source left out keeps its line. */
    updateLanguageHud: (changes: LanguageChanges) => notice.update(changes),
    /** Sets the subtitles line; `dismiss` withdraws it and leaves the other lines. */
    triggerCaptionHud: (view: CaptionHudView) => notice.update({ subtitles: view.kind === 'dismiss' ? null : view }),
    /** Removes the notice with every line and pending loader, as theater exit does; safe to repeat. */
    removeCaptionHud: () => notice.clear()
  };
}
