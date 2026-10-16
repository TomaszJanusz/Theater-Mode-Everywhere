/** A tiny Markdown subset parser (no DOM): headings, paragraphs, bullet lists, links, emphasis, code. */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong' | 'em'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] };

export type Block =
  | { type: 'heading'; level: number; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; items: Inline[][] };

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** Returns the normalized URL, or null when the scheme could run script or navigate unexpectedly. */
export function safeLinkHref(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function pushText(out: Inline[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last?.type === 'text') last.text += text;
  else out.push({ type: 'text', text });
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length && /[\\`*_[\]()#<>]/.test(src[i + 1])) {
      pushText(out, src[i + 1]);
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i) {
        out.push({ type: 'code', text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '*' || ch === '_') {
      const double = src[i + 1] === ch;
      const marker = double ? ch + ch : ch;
      const end = src.indexOf(marker, i + marker.length);
      if (end > i + marker.length) {
        out.push({ type: double ? 'strong' : 'em', children: parseInline(src.slice(i + marker.length, end)) });
        i = end + marker.length;
        continue;
      }
    }
    if (ch === '[') {
      const close = findLabelEnd(src, i);
      if (close > 0 && src[close + 1] === '(') {
        const paren = findDestinationEnd(src, close + 2);
        if (paren > 0) {
          const children = parseInline(src.slice(i + 1, close));
          const href = safeLinkHref(src.slice(close + 2, paren));
          // An unsafe target keeps the label as plain text rather than a dead or dangerous anchor.
          if (href) out.push({ type: 'link', href, children });
          else out.push(...children);
          i = paren + 1;
          continue;
        }
      }
    }
    pushText(out, ch);
    i++;
  }
  return out;
}

/** Index of the ")" closing a link destination; balanced parentheses stay part of the URL. */
function findDestinationEnd(src: string, start: number): number {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && depth-- === 0) return i;
  }
  return -1;
}

function findLabelEnd(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '\\') i++;
    else if (src[i] === '[') depth++;
    else if (src[i] === ']' && --depth === 0) return i;
  }
  return -1;
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;
  const flush = (): void => {
    if (paragraph.length) blocks.push({ type: 'paragraph', children: parseInline(paragraph.join(' ')) });
    if (list) blocks.push({ type: 'list', items: list.map(parseInline) });
    paragraph = [];
    list = null;
  };
  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^[-*+]\s+(.*)$/.exec(line);
    if (!line) flush();
    else if (heading) {
      flush();
      blocks.push({ type: 'heading', level: heading[1].length, children: parseInline(heading[2]) });
    } else if (item) {
      if (!list) {
        flush();
        list = [];
      }
      list.push(item[1]);
    } else if (list) {
      // A wrapped continuation line belongs to the previous list item.
      list[list.length - 1] += ` ${line}`;
    } else paragraph.push(line);
  }
  flush();
  return blocks;
}
