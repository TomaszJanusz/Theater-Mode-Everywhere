import { sanitizeCaptionText } from '../sanitize';
import type { CaptionCue, CaptionWord } from '../types';

const TIMESTAMP_RE = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/;

export function parseTimestamp(value: string): number | null {
  const match = value.trim().match(TIMESTAMP_RE);
  if (!match) return null;
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = match[4] ? Number(match[4].padEnd(3, '0')) : 0;
  if (![hours, minutes, seconds, fraction].every(Number.isFinite)) return null;
  return hours * 3600 + minutes * 60 + seconds + fraction / 1000;
}

function pushCue(cues: CaptionCue[], start: number, end: number, text: string, words?: CaptionWord[]): void {
  const sanitized = sanitizeCaptionText(text);
  if (!sanitized) return;
  const safeEnd = end > start ? end : start + 0.001;
  const cue: CaptionCue = { start, end: safeEnd, text: sanitized };
  if (words && words.length > 0) cue.words = words;
  cues.push(cue);
}

function assignWordEnds(words: CaptionWord[], fallbackEnd: number): CaptionWord[] {
  return words.map((word, index) => {
    const next = words[index + 1];
    const end = next ? next.start : fallbackEnd;
    return {
      ...word,
      end: end > word.start ? end : word.start + 0.05
    };
  });
}

export function parseWebVtt(input: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const normalized = input.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  let i = 0;

  while (i < lines.length && (lines[i].trim() === '' || /^WEBVTT/i.test(lines[i]) || /^NOTE\b/i.test(lines[i]) || /^STYLE\b/i.test(lines[i]) || /^REGION\b/i.test(lines[i]) || /^Kind:/i.test(lines[i]) || /^Language:/i.test(lines[i]))) {
    if (/^NOTE\b/i.test(lines[i]) || /^STYLE\b/i.test(lines[i]) || /^REGION\b/i.test(lines[i])) {
      i += 1;
      while (i < lines.length && lines[i].trim() !== '') i += 1;
    } else {
      i += 1;
    }
  }

  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === '') i += 1;
    if (i >= lines.length) break;
    if (/^NOTE\b/i.test(lines[i]) || /^STYLE\b/i.test(lines[i])) {
      i += 1;
      while (i < lines.length && lines[i].trim() !== '') i += 1;
      continue;
    }
    if (/^\d+$/.test(lines[i].trim()) && i + 1 < lines.length && lines[i + 1].includes('-->')) {
      i += 1;
    }
    if (!lines[i] || !lines[i].includes('-->')) {
      i += 1;
      continue;
    }
    const [startRaw, endRaw] = lines[i].split('-->');
    const start = parseTimestamp(startRaw.split(/\s+/)[0] || '');
    const end = parseTimestamp((endRaw || '').trim().split(/\s+/)[0] || '');
    i += 1;
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      textLines.push(lines[i]);
      i += 1;
    }
    if (start === null || end === null) continue;
    pushCue(cues, start, end, textLines.join(' '));
  }

  return cues;
}

export function parseSrt(input: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const blocks = input.replace(/^\uFEFF/, '').split(/\r?\n\r?\n/);

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((line) => line.length > 0);
    if (lines.length < 2) continue;
    const timingLine = /^[0-9]+$/.test(lines[0]) ? lines[1] : lines[0];
    if (!timingLine || !timingLine.includes('-->')) continue;
    const [startRaw, endRaw] = timingLine.split('-->');
    const start = parseTimestamp(startRaw.trim());
    const end = parseTimestamp((endRaw || '').trim());
    if (start === null || end === null) continue;
    const textLines = /^[0-9]+$/.test(lines[0]) ? lines.slice(2) : lines.slice(1);
    pushCue(cues, start, end, textLines.join(' '));
  }

  return cues;
}

export function parseTtml(input: string): CaptionCue[] {
  if (typeof DOMParser !== 'undefined') {
    const cues: CaptionCue[] = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(input, 'text/xml');
    if (!doc.querySelector('parsererror')) {
      const nodes = Array.from(doc.getElementsByTagName('*')).filter((el) => {
        const name = el.localName.toLowerCase();
        return name === 'p' || name === 'span';
      });

      for (const node of nodes) {
        const begin = node.getAttribute('begin') || node.getAttribute('start');
        if (!begin) continue;
        const start = parseTtmlClock(begin);
        if (start === null) continue;
        const endAttr = node.getAttribute('end');
        const durAttr = node.getAttribute('dur') || node.getAttribute('duration');
        let end = endAttr ? parseTtmlClock(endAttr) : null;
        if (end === null && durAttr) {
          const duration = parseTtmlClock(durAttr);
          end = duration === null ? null : start + duration;
        }
        if (end === null) end = start + 2;
        pushCue(cues, start, end, node.textContent || '');
      }
      return cues;
    }
  }

  return parseTaggedCues(input, /<p\b([^>]*)>([\s\S]*?)<\/p>/gi);
}

function parseTtmlClock(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.endsWith('t')) {
    const ticks = Number(trimmed.slice(0, -1));
    return Number.isFinite(ticks) ? ticks / 10000000 : null;
  }
  if (trimmed.endsWith('ms')) {
    const ms = Number(trimmed.slice(0, -2));
    return Number.isFinite(ms) ? ms / 1000 : null;
  }
  if (trimmed.endsWith('s')) {
    const seconds = Number(trimmed.slice(0, -1));
    return Number.isFinite(seconds) ? seconds : null;
  }
  return parseTimestamp(trimmed.replace('.', ',').includes(':') ? trimmed.replace('.', ',') : `0:00:${trimmed}`);
}

export function parseTimedTextXml(input: string): CaptionCue[] {
  if (typeof DOMParser !== 'undefined') {
    const cues: CaptionCue[] = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(input, 'text/xml');
    if (!doc.querySelector('parsererror')) {
      for (const node of Array.from(doc.getElementsByTagName('text'))) {
        const start = Number(node.getAttribute('start'));
        if (!Number.isFinite(start)) continue;
        const duration = optionalNumber(node.getAttribute('dur'));
        const endAttr = optionalNumber(node.getAttribute('end'));
        const end = endAttr ?? start + (duration ?? 2);
        pushCue(cues, start, end, node.textContent || '');
      }
      return cues;
    }
  }

  return parseTaggedCues(input, /<text\b([^>]*)>([\s\S]*?)<\/text>/gi, true);
}

function parseTaggedCues(input: string, tagRe: RegExp, timedText = false): CaptionCue[] {
  const cues: CaptionCue[] = [];
  for (const match of input.matchAll(tagRe)) {
    const attrs = match[1] || '';
    const text = match[2] || '';
    if (timedText) {
      const start = Number(attrValue(attrs, 'start'));
      if (!Number.isFinite(start)) continue;
      const duration = optionalNumber(attrValue(attrs, 'dur'));
      const endAttr = optionalNumber(attrValue(attrs, 'end'));
      const end = endAttr ?? start + (duration ?? 2);
      pushCue(cues, start, end, text);
      continue;
    }
    const begin = attrValue(attrs, 'begin') || attrValue(attrs, 'start');
    if (!begin) continue;
    const start = parseTtmlClock(begin);
    if (start === null) continue;
    const endAttr = attrValue(attrs, 'end');
    const durAttr = attrValue(attrs, 'dur') || attrValue(attrs, 'duration');
    let end = endAttr ? parseTtmlClock(endAttr) : null;
    if (end === null && durAttr) {
      const duration = parseTtmlClock(durAttr);
      end = duration === null ? null : start + duration;
    }
    if (end === null) end = start + 2;
    pushCue(cues, start, end, text);
  }
  return cues;
}

function attrValue(attrs: string, name: string): string {
  const match = attrs.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
  return match ? match[1] : '';
}

function optionalNumber(value: string | null): number | null {
  if (value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseCaptionPayload(input: string, contentType = ''): CaptionCue[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  const type = contentType.toLowerCase();
  if (type.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return parseJson3(trimmed);
  }
  if (type.includes('ttml') || trimmed.includes('<tt ') || trimmed.includes('<ttml')) {
    return parseTtml(trimmed);
  }
  if (trimmed.includes('<transcript') || trimmed.includes('<text start=') || trimmed.includes('<text ')) {
    return parseTimedTextXml(trimmed);
  }
  if (trimmed.includes('<timedtext') || /<p\b[^>]*\bt=/.test(trimmed)) {
    return parseYoutubeSrv3(trimmed);
  }
  if (trimmed.includes('-->') && /^\s*\d+\s*$/m.test(trimmed) && !trimmed.includes('WEBVTT')) {
    return parseSrt(trimmed);
  }
  if (trimmed.includes('-->')) {
    return parseWebVtt(trimmed);
  }
  if (trimmed.includes('<p ') || trimmed.includes('<p>')) {
    return parseTtml(trimmed);
  }
  return parseSrt(trimmed);
}

function parseYoutubeSrv3(input: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  for (const match of input.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)) {
    const startMs = optionalNumber(attrValue(match[1] || '', 't'));
    if (startMs === null) continue;
    const durationMs = optionalNumber(attrValue(match[1] || '', 'd')) ?? 2000;
    const start = startMs / 1000;
    const end = (startMs + durationMs) / 1000;
    const inner = match[2] || '';
    const words = wordsFromSrv3Spans(start, end, inner);
    pushCue(cues, start, end, inner, words);
  }
  return cues;
}

function wordsFromSrv3Spans(start: number, end: number, inner: string): CaptionWord[] | undefined {
  const spans = [...inner.matchAll(/<s\b([^>]*)>([\s\S]*?)<\/s>/gi)];
  if (spans.length < 2) return undefined;
  const words: CaptionWord[] = [];
  for (const span of spans) {
    const offsetMs = optionalNumber(attrValue(span[1] || '', 't')) ?? 0;
    const text = sanitizeCaptionText(span[2] || '');
    if (!text) continue;
    words.push({ start: start + offsetMs / 1000, end, text });
  }
  const timed = assignWordEnds(words, end);
  return timed.length >= 2 ? timed : undefined;
}

function parseJson3(input: string): CaptionCue[] {
  try {
    const data = JSON.parse(input) as {
      events?: Array<{
        tStartMs?: number;
        dDurationMs?: number;
        aAppend?: number;
        segs?: Array<{ utf8?: string; tOffsetMs?: number }>;
      }>;
    };
    const cues: CaptionCue[] = [];
    for (const event of data.events || []) {
      const startMs = Number(event.tStartMs);
      if (!Number.isFinite(startMs)) continue;
      if (!event.segs || event.segs.length === 0) continue;
      const raw = event.segs.map((seg) => seg.utf8 || '').join('');
      const text = raw
        .split(/\n+/)
        .map((line) => sanitizeCaptionText(line))
        .filter(Boolean)
        .join('\n');
      if (!text) continue;
      let durationMs = Number(event.dDurationMs);
      if (!Number.isFinite(durationMs) || durationMs <= 0) durationMs = 2000;
      const start = startMs / 1000;
      const end = start + durationMs / 1000;
      const words = wordsFromJson3Segs(start, end, event.segs);

      if (event.aAppend && cues.length > 0) {
        const last = cues[cues.length - 1];
        last.text = last.text ? `${last.text} ${text}` : text;
        if (end > last.end) last.end = end;
        if (words && last.words) {
          last.words = assignWordEnds([...last.words, ...words], last.end);
        } else if (words) {
          last.words = words;
        }
        continue;
      }

      pushCue(cues, start, end, text, words);
      if (cues.length >= 3) {
        const oldest = cues[cues.length - 3];
        if (oldest.end > start) oldest.end = Math.max(oldest.start + 0.001, start);
      }
    }
    return cues;
  } catch {
    return [];
  }
}

function wordsFromJson3Segs(
  start: number,
  end: number,
  segs: Array<{ utf8?: string; tOffsetMs?: number }>
): CaptionWord[] | undefined {
  const words: CaptionWord[] = [];
  for (const seg of segs) {
    const text = sanitizeCaptionText(seg.utf8 || '');
    if (!text) continue;
    const offsetMs = Number(seg.tOffsetMs);
    const wordStart = start + (Number.isFinite(offsetMs) ? offsetMs / 1000 : 0);
    words.push({ start: wordStart, end, text });
  }
  const timed = assignWordEnds(words, end);
  if (timed.length < 2) return undefined;
  if (!timed.some((word) => word.start > timed[0].start + 0.05)) return undefined;
  return timed;
}
