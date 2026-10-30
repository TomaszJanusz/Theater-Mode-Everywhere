import { sanitizedCaptionCue } from '../sanitize';
import type { CaptionCue } from '../types';

function assClock(value: string): number | null {
  const match = /^(\d+):(\d{2}):(\d{2}\.\d{1,3})$/.exec(value.trim());
  if (!match) return null;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/** Drops ASS override tags and drawing segments. `\p1` starts a drawing; `\pos` does not. */
function assPlainText(value: string): string {
  let drawing = false;
  let text = '';
  const parts = value.split(/\{([^{}]*)\}/);
  const keep = (segment: string) => {
    if (!drawing && segment) text += segment;
  };
  keep(parts[0] || '');
  for (let index = 1; index < parts.length; index += 2) {
    const modes = [...(parts[index] || '').matchAll(/\\p(\d+)/g)];
    if (modes.length) drawing = Number(modes[modes.length - 1][1]) > 0;
    keep(parts[index + 1] || '');
  }
  return text.replace(/\\N/g, '\n').replace(/\\n/g, '\n').replace(/\\h/g, ' ');
}

/** Dialogue lines of an ASS/SSA file, honoring its `Format:` line; override tags and drawings are dropped. */
export function parseAssCaptions(body: string): CaptionCue[] {
  let startIndex = 1;
  let endIndex = 2;
  let textIndex = 9;
  const cues: CaptionCue[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (cues.length >= 20000) break;
    if (line.startsWith('Format:') && /\bStart\b/.test(line) && /\bText\b/.test(line)) {
      const names = line.slice('Format:'.length).split(',').map((name) => name.trim().toLowerCase());
      const start = names.indexOf('start');
      const end = names.indexOf('end');
      const text = names.indexOf('text');
      if (start >= 0 && end >= 0 && text === names.length - 1) {
        startIndex = start;
        endIndex = end;
        textIndex = text;
      }
      continue;
    }
    if (!line.startsWith('Dialogue:')) continue;
    const fields = line.slice('Dialogue:'.length).split(',');
    if (fields.length <= textIndex) continue;
    const start = assClock(fields[startIndex] || '');
    const end = assClock(fields[endIndex] || '');
    const next = start !== null && end !== null ? sanitizedCaptionCue(start, end, assPlainText(fields.slice(textIndex).join(','))) : null;
    if (next) cues.push(next);
  }
  return cues.sort((left, right) => left.start - right.start);
}
