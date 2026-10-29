import { classifyCaptionWord, cueHasWordTimings, visibleCaptionLines } from './cue-index';
import type { CaptionStyle } from './caption-style';
import { applyCaptionStyle, DEFAULT_CAPTION_STYLE } from './caption-style';
import type { CaptionCue } from './types';
import { mountPlayerUi } from '../player-ui-root';

export class CaptionRenderer {
  private root: HTMLDivElement;
  private text: HTMLDivElement;
  private cues: CaptionCue[] = [];
  private lastLineKey: string | null = '';
  private activeCues: CaptionCue[] = [];
  private wordNodes: { cue: CaptionCue; index: number; span: HTMLSpanElement; state: string }[] = [];
  private maxLines = 2;
  private style: CaptionStyle = { ...DEFAULT_CAPTION_STYLE };

  constructor(private onChange?: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'theater-caption-overlay';
    this.root.setAttribute('aria-live', 'polite');
    this.text = document.createElement('div');
    this.text.className = 'theater-caption-overlay-text';
    this.root.appendChild(this.text);
    mountPlayerUi(this.root);
    // The page-wide copy of the style, for host captions, belongs to the theater session.
    applyCaptionStyle(this.root, this.style);
  }

  setStyle(style: CaptionStyle): void {
    this.style = style;
    this.lastLineKey = null;
    applyCaptionStyle(this.root, style);
  }

  /** Returns true when the next update must redraw because the row cap changed. */
  setMaxLines(maxLines: number): boolean {
    const next = maxLines >= 3 ? 3 : 2;
    if (next === this.maxLines) return false;
    this.maxLines = next;
    this.lastLineKey = null;
    this.wordNodes = [];
    this.activeCues = [];
    return true;
  }

  setCues(cues: CaptionCue[] | null): void {
    this.cues = cues || [];
    this.lastLineKey = '';
    this.wordNodes = [];
    this.activeCues = [];
    if (this.cues.length === 0) {
      this.text.textContent = '';
      this.root.classList.remove('visible');
    }
    this.onChange?.();
  }

  update(time: number): void {
    if (this.cues.length === 0) {
      if (this.lastLineKey !== '') {
        this.text.textContent = '';
        this.root.classList.remove('visible');
        this.lastLineKey = '';
        this.wordNodes = [];
        this.activeCues = [];
        this.onChange?.();
      }
      return;
    }
    const active = visibleCaptionLines(this.cues, time, this.maxLines);
    const lineKey = active.map((cue) => cue.text).join('\n');
    if (lineKey !== this.lastLineKey || active.length !== this.activeCues.length
      || active.some((cue, index) => cue !== this.activeCues[index])) {
      this.lastLineKey = lineKey;
      this.wordNodes = [];
      this.activeCues = active;
      this.text.replaceChildren();
      for (let i = 0; i < active.length; i++) {
        if (i > 0) this.text.appendChild(document.createElement('br'));
        this.appendCue(active[i], time);
      }
      this.root.classList.toggle('visible', lineKey.length > 0);
      this.onChange?.();
    } else {
      this.updateWordStates(time);
    }
  }

  dispose(): void {
    this.cues = [];
    this.wordNodes = [];
    this.activeCues = [];
    this.root.remove();
  }

  private appendCue(cue: CaptionCue, time: number): void {
    if (!cueHasWordTimings(cue) || !cue.words) {
      this.text.appendChild(document.createTextNode(cue.text));
      return;
    }
    cue.words.forEach((word, index) => {
      const span = document.createElement('span');
      const state = classifyCaptionWord(cue.words!, index, time);
      span.className = `theater-caption-word is-${state}`;
      this.wordNodes.push({ cue, index, span, state });
      span.textContent = index === 0 ? word.text : ` ${word.text}`;
      this.text.appendChild(span);
    });
  }

  private updateWordStates(time: number): void {
    for (const word of this.wordNodes) {
      const state = classifyCaptionWord(word.cue.words!, word.index, time);
      if (state === word.state) continue;
      word.state = state;
      word.span.className = `theater-caption-word is-${state}`;
    }
  }
}
