import { afterEach, describe, expect, test } from 'vitest';

import recorded from '../../test/fixtures/youtube-timedtext-broadcast-captions.json';
import { queryPlayerUi } from '../ui/root';

import { CaptionRenderer } from './caption-renderer';
import { parseCaptionPayload } from './parsers/captions';
import type { CaptionCue } from './types';

let renderer: CaptionRenderer | undefined;
afterEach(() => { renderer?.dispose(); renderer = undefined; });

/** Shows `cues` at `time` and returns the overlay's lines as their word spans. */
function show(cues: CaptionCue[], time: number): HTMLSpanElement[][] {
  renderer = new CaptionRenderer();
  renderer.setCues(cues);
  renderer.update(time);
  const lines: HTMLSpanElement[][] = [[]];
  for (const node of queryPlayerUi('.theater-caption-overlay-text')!.childNodes) {
    if (node instanceof HTMLBRElement) lines.push([]);
    else lines.at(-1)!.push(node as HTMLSpanElement);
  }
  return lines;
}

const text = (spans: HTMLSpanElement[]) => spans.map((span) => span.textContent).join('');
const lit = (spans: HTMLSpanElement[]) => spans.filter((span) => !span.classList.contains('is-upcoming'));

describe('caption overlay words', () => {
  test('draws a broadcast track in its words, with the highlight inside them', () => {
    // 1:28 of the recorded video, as in the report: "THE" is spoken, "FIRST DISTRICT" is next.
    const lines = show(parseCaptionPayload(JSON.stringify(recorded.tracks.cc1.body)), 88);
    expect(lines.map(text)).toEqual(["CERTAINLY HERE. BUT IT WASN'T", 'JUST HERE IN THE FIRST DISTRICT']);
    expect(text(lit(lines[1]))).toBe('JUST HERE IN THE');
    // "FIRST" and "DISTRICT" are five pieces; a piece has no space and no gap to the one before it.
    const second = lines[1];
    for (let index = 1; index < second.length; index++) {
      const piece = second[index];
      if (piece.textContent!.startsWith(' ')) continue;
      expect(piece.textContent).toMatch(/^\S+$/);
      const gap = piece.getBoundingClientRect().left - second[index - 1].getBoundingClientRect().right;
      expect(Math.abs(gap), `before ${piece.textContent}`).toBeLessThan(0.5);
    }
  });

  test('keeps auto-generated words one space apart', () => {
    const cues = parseCaptionPayload(JSON.stringify(recorded.tracks.asr.body));
    const lines = show(cues, 88);
    expect(lines.map(text)).toEqual(['North Carolina screen because I think', "there's a much bigger story in North"]);
    expect(text(lit(lines[1]))).toBe("there's a");
    expect(lines[1].slice(1).every((span) => /^ \S+$/.test(span.textContent!))).toBe(true);
  });
});
