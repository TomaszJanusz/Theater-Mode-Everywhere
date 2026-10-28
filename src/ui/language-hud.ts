import { HUD_FADE_OUT_MS, HUD_PLATE_CLASS } from './hud-plate';
import {
  LanguageNotice, languageNoticeText,
  type LanguageChanges, type LanguageLine, type LanguageLines, type LanguageNoticeView, type LanguageSource
} from './language-notice';
import { announcePlayerStatus } from './root';
import type { PlayerChromeContext } from './runtime-context';
import { animateReveal, exitSpinner, isElementMotionReduced, SPINNER_PASSIVE_EXIT_MS } from './spinner-exit';
import type { UiClock } from './ui-clock';

/** The subtitles line of the language notice, or `dismiss` to withdraw it. */
export type CaptionHudView = { kind: 'dismiss' } | LanguageLine;

type LanguageHudHost = Pick<PlayerChromeContext, 'mountPlayerUi' | 'paintOverlay'> & {
  session: Pick<PlayerChromeContext['session'], 'element' | 'currentEpoch'>;
};
type StatusLine = Extract<LanguageLine, { kind: 'status' }>;
type PlateBox = { box: DOMRect; places: Map<LanguageSource, { x: number; y: number }> };
type LeavingCell = { cell: HTMLElement; left: number; top: number; width: number; opacity: string };

const PLATE_MORPH_MS = 225;
/** "Loading..." gives way in the first part of the ring's exit, before the value starts to reveal. */
const LOADING_TEXT_FADE_MS = SPINNER_PASSIVE_EXIT_MS * 0.4;
const ROWS_CLASS = 'language-hud-rows';

const rowOf = (plate: HTMLElement, source: LanguageSource) =>
  plate.querySelector<HTMLElement>(`.${ROWS_CLASS} > [data-language-line="${source}"]`);
/** A row is `display: contents` so its label and value sit in the shared columns; motion goes to its cells. */
const cellsOf = (row: HTMLElement) => [...row.children] as HTMLElement[];

function span(className: string, text = ''): HTMLSpanElement {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
}

function buildRow(source: LanguageSource, line: LanguageLine): HTMLElement {
  const row = document.createElement('div');
  row.className = 'language-hud-row';
  row.dataset.languageLine = source;
  const value = span('language-hud-value');
  if (line.kind === 'loading') {
    const loading = span('language-hud-loading');
    const spinner = span('language-hud-spinner');
    spinner.setAttribute('aria-hidden', 'true');
    loading.append(spinner, span('language-hud-loading-text', line.detail));
    value.append(loading);
  } else value.append(span('language-hud-text', line.detail));
  row.append(span('language-hud-label', line.title), value);
  return row;
}

/** Where the plate and its rows are now, running motion included, so an update can ease from there. */
function measurePlate(plate: HTMLElement): PlateBox {
  const places = new Map<LanguageSource, { x: number; y: number }>();
  for (const row of plate.querySelectorAll<HTMLElement>(`.${ROWS_CLASS} > [data-language-line]`)) {
    const { left, top } = row.firstElementChild!.getBoundingClientRect();
    places.set(row.dataset.languageLine as LanguageSource, { x: left, y: top });
  }
  return { box: plate.getBoundingClientRect(), places };
}

/**
 * The language notice on screen: one plate, one row per source, each a label and a value in two
 * shared columns. Each row keeps its nodes and its own motion (a spinner's exit, a reveal), so painting
 * one row never restarts or cuts another's. The plate morphs between sizes; rows that stay slide, a
 * row that joins fades in, and a row that leaves fades out in place while the plate closes over it.
 */
class LanguagePlate implements LanguageNoticeView {
  private plate: HTMLElement | null = null;
  /** The plate's morph, the slides of rows that move and the rows fading out; one set at a time. */
  private plateMotion: Animation[] = [];
  private leaving: HTMLElement[] = [];
  private readonly lineMotion = new Map<LanguageSource, () => void>();

  constructor(
    private readonly host: LanguageHudHost,
    private readonly clock: UiClock,
    private readonly isCurrent: () => boolean
  ) {}

  render(lines: LanguageLines, changed: ReadonlySet<LanguageSource>): void {
    announcePlayerStatus(languageNoticeText(lines));
    const existing = this.plate?.isConnected ? this.plate : null;
    const plate = existing ?? this.createPlate();
    const animate = Boolean(existing) && !isElementMotionReduced(plate);
    const before = animate ? measurePlate(plate) : null;
    this.stopPlateMotion();
    this.host.paintOverlay(plate);
    // Mounted before its rows are built (same task, so nothing paints between): the rows read Reduce
    // motion from the player UI host, which a detached plate cannot reach.
    if (!existing) {
      this.host.mountPlayerUi(plate);
      this.plate = plate;
    }

    const rows = plate.querySelector<HTMLElement>(`.${ROWS_CLASS}`)!;
    this.dropRows(plate, rows, new Set(lines.map(([source]) => source)), animate);
    let anchor = rows.firstElementChild;
    for (const [source, line] of lines) {
      const current = rowOf(plate, source);
      const row = current && !changed.has(source) ? current : this.renderRow(plate, source, line, !existing);
      if (row !== anchor) rows.insertBefore(row, anchor);
      anchor = row.nextElementSibling;
    }
    if (before) this.morph(plate, rows, before);
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

  private createPlate(): HTMLElement {
    const plate = document.createElement('div');
    plate.className = `theater-everywhere-caption-hud ${HUD_PLATE_CLASS} language-hud`;
    plate.setAttribute('aria-hidden', 'true');
    const rows = document.createElement('div');
    rows.className = ROWS_CLASS;
    plate.append(rows);
    return plate;
  }

  /**
   * A status updates its row in place, so a spinner there zooms out into the new value; a loading
   * row, or a row the plate did not have, is built new.
   */
  private renderRow(plate: HTMLElement, source: LanguageSource, line: LanguageLine, freshPlate: boolean): HTMLElement {
    this.stopLineMotion(source);
    const current = rowOf(plate, source);
    if (current && line.kind === 'status') {
      this.updateStatus(current, source, line);
      return current;
    }
    const row = buildRow(source, line);
    current?.replaceWith(row);
    if (isElementMotionReduced(plate)) return row;
    // A row joining a plate on screen fades in; a fresh plate reveals its value as one notice always has.
    const targets = freshPlate ? [...row.querySelectorAll<HTMLElement>('.language-hud-text')] : cellsOf(row);
    const reveals = targets.filter(node => node.textContent).map(node => animateReveal(node));
    if (reveals.length) this.lineMotion.set(source, () => { for (const reveal of reveals) reveal.cancel(); });
    return row;
  }

  private updateStatus(row: HTMLElement, source: LanguageSource, line: StatusLine): void {
    const [label, value] = cellsOf(row);
    label.textContent = line.title;
    // An exit cut short by this update leaves its spinner behind; it goes at once.
    for (const stale of value.querySelectorAll('.language-hud-loading.leaving')) stale.remove();
    value.style.removeProperty('min-width');
    value.querySelector('.language-hud-text')?.remove();
    const text = span('language-hud-text', line.detail);
    value.append(text);
    const loading = value.querySelector<HTMLElement>('.language-hud-loading');
    const reduced = isElementMotionReduced(row.parentElement!);
    if (loading) {
      // The value takes the spinner's place; the slot keeps the spinner's width until it has gone, so
      // "Loading..." is never cut, and then the plate eases to the value's own width.
      value.style.minWidth = `${loading.offsetWidth}px`;
      loading.classList.add('leaving');
      const fade = reduced ? null : loading.querySelector('.language-hud-loading-text')!.animate(
        [{ opacity: 1 }, { opacity: 0 }], { duration: LOADING_TEXT_FADE_MS, easing: 'ease-out', fill: 'both' });
      const stopExit = exitSpinner(loading.querySelector<HTMLElement>('.language-hud-spinner')!, {
        mode: 'passive', reveal: line.detail ? text : undefined, clock: this.clock,
        isCurrent: () => row.isConnected && this.isCurrent(),
        onFinish: () => this.reflow(() => {
          loading.remove();
          value.style.removeProperty('min-width');
        })
      });
      this.lineMotion.set(source, () => { stopExit(); fade?.cancel(); });
    } else if (line.detail && !reduced) {
      const reveal = animateReveal(text);
      this.lineMotion.set(source, () => reveal.cancel());
    }
  }

  /** Removes the rows of sources no longer shown: fading in place while the plate morphs, or at once. */
  private dropRows(plate: HTMLElement, rows: HTMLElement, shown: ReadonlySet<LanguageSource>, animate: boolean): void {
    for (const row of [...rows.children] as HTMLElement[]) {
      const source = row.dataset.languageLine as LanguageSource;
      if (shown.has(source)) continue;
      // Measured where it shows, mid-reveal included, before its own motion stops.
      const cells = animate ? this.measureCells(plate, row) : [];
      this.stopLineMotion(source);
      if (animate) this.leave(plate, row, cells);
      else row.remove();
    }
  }

  /** A row's cells as they show, relative to the plate's padding box (where absolute positions start). */
  private measureCells(plate: HTMLElement, row: HTMLElement): LeavingCell[] {
    const origin = plate.getBoundingClientRect();
    return cellsOf(row).map(cell => {
      const rect = cell.getBoundingClientRect();
      return { cell, left: rect.left - origin.left - plate.clientLeft, top: rect.top - origin.top - plate.clientTop,
        width: rect.width, opacity: getComputedStyle(cell).opacity };
    });
  }

  /**
   * Keeps a row that leaves where it shows, out of the flow, fading from its current opacity while the
   * plate closes over it. All cells were measured first: taking one out of the grid would reflow the other.
   */
  private leave(plate: HTMLElement, row: HTMLElement, cells: readonly LeavingCell[]): void {
    for (const { cell, left, top, width, opacity } of cells) {
      Object.assign(cell.style, { position: 'absolute', left: `${left}px`, top: `${top}px`, width: `${width}px` });
      plate.append(cell);
      this.leaving.push(cell);
      this.play(cell, [{ opacity }, { opacity: 0 }]);
    }
    row.remove();
  }

  /** Applies a change that ends motion rather than an update (a spinner gone) and eases the plate to it. */
  private reflow(change: () => void): void {
    const plate = this.plate;
    const rows = plate?.querySelector<HTMLElement>(`.${ROWS_CLASS}`);
    if (!plate?.isConnected || !rows || isElementMotionReduced(plate)) {
      change();
      return;
    }
    const before = measurePlate(plate);
    this.stopPlateMotion({ keepLeaving: true });
    change();
    this.morph(plate, rows, before);
  }

  /**
   * Eases the plate from its old size to the new one and slides the rows that stay from where they
   * showed to their new place, so nothing on screen jumps. The plate clips its overflow and the rows keep their final
   * width meanwhile, so a value wider than the easing box is cut at the plate's edge, never rewrapped.
   * The motion holds its last frame until it is cancelled, which finishing does at once.
   */
  private morph(plate: HTMLElement, rows: HTMLElement, before: PlateBox): void {
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
    if (Object.keys(from).length) {
      const minWidth = `${rows.getBoundingClientRect().width}px`;
      this.play(rows, [{ minWidth }, { minWidth }]);
      this.play(plate, [from, to]);
    }
    // Columns follow the widest row, so a row that stays can move both ways when another joins or leaves.
    for (const [source, place] of before.places) {
      const row = rowOf(plate, source);
      if (!row) continue;
      const now = row.firstElementChild!.getBoundingClientRect();
      const dx = place.x - now.left;
      const dy = place.y - now.top;
      if (Math.abs(dx) <= 0.5 && Math.abs(dy) <= 0.5) continue;
      for (const cell of cellsOf(row)) this.play(cell, [{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }]);
    }
  }

  private play(node: HTMLElement, keyframes: Keyframe[]): void {
    const animation = node.animate(keyframes, { duration: PLATE_MORPH_MS, easing: 'ease', fill: 'forwards' });
    animation.onfinish = () => this.settle(animation);
    this.plateMotion.push(animation);
  }

  /** A finished part of the morph lets go of its last frame; the rows that left go with the last part. */
  private settle(animation: Animation): void {
    animation.cancel();
    this.plateMotion = this.plateMotion.filter(item => item !== animation);
    if (this.plateMotion.length) return;
    for (const node of this.leaving) node.remove();
    this.leaving = [];
  }

  private stopLineMotion(source: LanguageSource): void {
    this.lineMotion.get(source)?.();
    this.lineMotion.delete(source);
  }

  /** Stops the morph; rows still fading out stay for `keepLeaving`, so a later ease does not cut them. */
  private stopPlateMotion({ keepLeaving = false } = {}): void {
    const kept = (animation: Animation) => keepLeaving && animation.effect instanceof KeyframeEffect
      && this.leaving.includes(animation.effect.target as HTMLElement);
    for (const animation of this.plateMotion) {
      if (kept(animation)) continue;
      animation.onfinish = null;
      animation.cancel();
    }
    this.plateMotion = this.plateMotion.filter(kept);
    if (keepLeaving) return;
    for (const node of this.leaving) node.remove();
    this.leaving = [];
  }
}

/** The language notice for one player UI: subtitles and audio rows merged into one plate. */
export function createLanguageHud(host: LanguageHudHost, clock: UiClock) {
  const notice: LanguageNotice = new LanguageNotice(clock, new LanguagePlate(host, clock, () => notice.isCurrent()),
    () => host.session.element ? { element: host.session.element, epoch: host.session.currentEpoch } : null, HUD_FADE_OUT_MS);
  return {
    /** Sets rows of the notice; a source left out keeps its row. */
    updateLanguageHud: (changes: LanguageChanges) => notice.update(changes),
    /** Sets the subtitles row; `dismiss` withdraws it and leaves the other rows. */
    triggerCaptionHud: (view: CaptionHudView) => notice.update({ subtitles: view.kind === 'dismiss' ? null : view }),
    /** Removes the notice with every row and pending loader, as theater exit does; safe to repeat. */
    removeCaptionHud: () => notice.clear()
  };
}
