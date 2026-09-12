const TAG_RE = /<[^>]+>/g;
const ENTITY_RE = /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
};

export function decodeEntities(value: string): string {
  return value.replace(ENTITY_RE, (match, entity: string) => {
    if (entity[0] === '#') {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const code = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0) return '';
      try {
        return String.fromCodePoint(code);
      } catch {
        return '';
      }
    }
    return NAMED_ENTITIES[entity] ?? match;
  });
}

export function sanitizeCaptionCueText(value: string): string {
  const withBreaks = value
    .replace(/\r\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(TAG_RE, ' ');
  return decodeEntities(withBreaks)
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sanitizeCaptionText(value: string): string {
  return sanitizeCaptionCueText(value).replace(/\s+/g, ' ').trim();
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
