import type { UiClock } from './ui-clock';

/**
 * What the language notice reports, one line each, stacked in this order so lines never swap places:
 * the subtitles, the audio track playing, and an audio pick the host refused.
 */
export const LANGUAGE_SOURCES = ['subtitles', 'audio', 'audioRefused'] as const;
export type LanguageSource = typeof LANGUAGE_SOURCES[number];

/** `title` names the source (the row's label); `detail` is what it reports (the row's value). */
export type LanguageLine =
  | { kind: 'loading'; title: string; detail?: string }
  | { kind: 'status'; title: string; detail?: string };
export type LanguageLines = ReadonlyArray<readonly [LanguageSource, LanguageLine]>;
/** Lines to set; `null` withdraws a source's line, an absent source keeps its line. */
export type LanguageChanges = Partial<Record<LanguageSource, LanguageLine | null>>;

/** A notice stays at least this long from when it first has something to read, so a name can be read after looking up. */
export const LANGUAGE_MIN_VISIBLE_MS = 4_000;
/** And at least this long after its last update, so a line that joins late is read too. */
export const LANGUAGE_AFTER_UPDATE_MS = 2_000;
/** A loading line waits this long, so a fast download never flashes a spinner. */
export const LANGUAGE_LOAD_DELAY_MS = 400;

/** The session a notice belongs to; work for another one must not show, hide or remove anything. */
export type LanguageOwner = { element: object; epoch: number };

export interface LanguageNoticeView {
  /** Paints `lines` into one plate; only the `changed` sources differ from what is on screen. */
  render(lines: LanguageLines, changed: ReadonlySet<LanguageSource>): void;
  fadeOut(): void;
  /** Removes the plate and stops its motion; safe to repeat. */
  remove(): void;
}

/** The merged text, read once per update. */
export function languageNoticeText(lines: LanguageLines): string {
  return lines.map(([, line]) => line.detail ? `${line.title}: ${line.detail}` : line.title).join('. ');
}

/**
 * One notice for the language versions the viewer gets. Each source owns its line and an update
 * never removes another source's line. A spinner is not something to read: the plate stays while
 * one turns, and its minimum time starts once every line can be read. From then the plate hides at
 * the later of that start plus `LANGUAGE_MIN_VISIBLE_MS` and the last update plus
 * `LANGUAGE_AFTER_UPDATE_MS`. An update that arrives while the plate fades out starts a
 * fresh notice; the lines that already had their time are not shown again.
 */
export class LanguageNotice {
  private readonly lines = new Map<LanguageSource, LanguageLine>();
  private readonly pending = new Map<LanguageSource, number>();
  private owner: LanguageOwner | null = null;
  /** When the plate last became fully readable (no spinner); null while a spinner turns or nothing shows. */
  private readableSince: number | null = null;
  private hideTimer: number | null = null;
  private fadeTimer: number | null = null;

  constructor(
    private readonly clock: UiClock,
    private readonly view: LanguageNoticeView,
    /** The session now playing, or null outside one. */
    private readonly session: () => LanguageOwner | null,
    private readonly fadeMs: number
  ) {}

  /** Whether the lines on screen belong to the session now playing. */
  isCurrent(): boolean {
    const now = this.session();
    return Boolean(now && this.owner && now.element === this.owner.element && now.epoch === this.owner.epoch);
  }

  update(changes: LanguageChanges): void {
    const now = this.session();
    if (!now) {
      this.clear();
      return;
    }
    if (!this.isCurrent()) this.clear();
    else if (this.fadeTimer !== null) this.expire();
    this.owner = now;
    const changed = new Set<LanguageSource>();
    for (const source of LANGUAGE_SOURCES) {
      if (source in changes && this.set(source, changes[source] ?? null)) changed.add(source);
    }
    if (changed.size) this.paint(changed);
  }

  /** Applies one source's change; true when the line on screen changed now. */
  private set(source: LanguageSource, line: LanguageLine | null): boolean {
    this.cancelPending(source);
    if (line?.kind !== 'loading') return line ? Boolean(this.lines.set(source, line)) : this.lines.delete(source);
    // A spinner already on screen keeps turning; a new load withdraws the old result at once.
    if (this.lines.get(source)?.kind === 'loading') return false;
    this.pending.set(source, this.clock.setTimeout(() => {
      this.pending.delete(source);
      if (!this.isCurrent()) return;
      if (this.fadeTimer !== null) this.expire();
      this.lines.set(source, line);
      this.paint(new Set([source]));
    }, LANGUAGE_LOAD_DELAY_MS));
    return this.lines.delete(source);
  }

  /** Forgets every line and pending loader and removes the plate; safe to repeat. */
  clear(): void {
    for (const source of [...this.pending.keys()]) this.cancelPending(source);
    this.expire();
    this.owner = null;
  }

  private paint(changed: ReadonlySet<LanguageSource>): void {
    this.clearTimers();
    const lines = LANGUAGE_SOURCES.flatMap(source => {
      const line = this.lines.get(source);
      return line ? [[source, line] as const] : [];
    });
    if (!lines.length) {
      this.expire();
      return;
    }
    this.view.render(lines, changed);
    if (lines.some(([, line]) => line.kind === 'loading')) {
      this.readableSince = null;
      return;
    }
    const now = this.clock.now();
    this.readableSince ??= now;
    const hideAt = Math.max(this.readableSince + LANGUAGE_MIN_VISIBLE_MS, now + LANGUAGE_AFTER_UPDATE_MS);
    this.hideTimer = this.clock.setTimeout(() => {
      this.hideTimer = null;
      if (!this.isCurrent()) return;
      this.view.fadeOut();
      this.fadeTimer = this.clock.setTimeout(() => {
        this.fadeTimer = null;
        if (this.isCurrent()) this.expire();
      }, this.fadeMs);
    }, hideAt - now);
  }

  /** Drops the lines on screen and the plate; a loader still waiting for its delay may start a new one. */
  private expire(): void {
    this.clearTimers();
    this.lines.clear();
    this.readableSince = null;
    this.view.remove();
  }

  private clearTimers(): void {
    if (this.hideTimer !== null) this.clock.clearTimeout(this.hideTimer);
    if (this.fadeTimer !== null) this.clock.clearTimeout(this.fadeTimer);
    this.hideTimer = this.fadeTimer = null;
  }

  private cancelPending(source: LanguageSource): void {
    const timer = this.pending.get(source);
    if (timer === undefined) return;
    this.clock.clearTimeout(timer);
    this.pending.delete(source);
  }
}
