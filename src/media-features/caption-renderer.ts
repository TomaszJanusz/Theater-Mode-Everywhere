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
  private lastWordKey = '';
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
    applyCaptionStyle(this.root, this.style);
    applyCaptionStyle(document.documentElement, this.style);
  }

  setStyle(style: CaptionStyle): void {
    this.style = style;
    applyCaptionStyle(this.root, style);
    applyCaptionStyle(document.documentElement, style);
  }

  /** Returns true when the next update must redraw because the row cap changed. */
  setMaxLines(maxLines: number): boolean {
    const next = maxLines >= 3 ? 3 : 2;
    if (next === this.maxLines) return false;
    this.maxLines = next;
    this.lastLineKey = null;
    this.lastWordKey = '';
    return true;
  }

  setCues(cues: CaptionCue[] | null): void {
    this.cues = cues || [];
    this.lastLineKey = '';
    this.lastWordKey = '';
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
        this.lastWordKey = '';
        this.onChange?.();
      }
      return;
    }
    const active = visibleCaptionLines(this.cues, time, this.maxLines);
    const lineKey = active.map((cue) => cue.text).join('\n');
    if (lineKey !== this.lastLineKey) {
      this.lastLineKey = lineKey;
      this.lastWordKey = '';
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
    this.root.remove();
    const root = document.documentElement.style;
    root.removeProperty('--theater-caption-color');
    root.removeProperty('--theater-caption-font');
    root.removeProperty('--theater-caption-scale');
    root.removeProperty('--theater-caption-bg');
    root.removeProperty('--theater-caption-bg-alpha');
    root.removeProperty('--theater-caption-shadow');
  }

  private appendCue(cue: CaptionCue, time: number): void {
    if (!cueHasWordTimings(cue) || !cue.words) {
      this.text.appendChild(document.createTextNode(cue.text));
      return;
    }
    cue.words.forEach((word, index) => {
      const span = document.createElement('span');
      span.className = `theater-caption-word is-${classifyCaptionWord(cue.words!, index, time)}`;
      span.textContent = index === 0 ? word.text : ` ${word.text}`;
      this.text.appendChild(span);
    });
  }

  private updateWordStates(time: number): void {
    const words = [...this.text.querySelectorAll('.theater-caption-word')];
    if (words.length === 0) return;
    const states: string[] = [];
    let cursor = 0;
    for (const cue of visibleCaptionLines(this.cues, time, this.maxLines)) {
      if (!cueHasWordTimings(cue) || !cue.words) continue;
      for (let i = 0; i < cue.words.length; i++) {
        const span = words[cursor++];
        if (!span) return;
        const state = classifyCaptionWord(cue.words, i, time);
        states.push(state);
        span.className = `theater-caption-word is-${state}`;
      }
    }
    const wordKey = states.join(',');
    if (wordKey === this.lastWordKey) return;
    this.lastWordKey = wordKey;
  }
}
