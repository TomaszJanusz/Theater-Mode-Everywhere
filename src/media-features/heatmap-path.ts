/** Open ridge of a closed heatmap area, for a top-only stroke. */
export function heatmapRidgePath(d: string): string {
  const src = d.trim();
  if (!src) return '';
  const closed = src.match(
    /^(.*?)(?:[Ll][\s,]*-?[\d.]+(?:e[-+]?\d+)?[\s,]+-?[\d.]+(?:e[-+]?\d+)?\s*){1,2}[Zz]?\s*$/
  );
  if (closed?.[1]) return closed[1].trim();
  return src.replace(/\s*[Zz]\s*$/, '').trim();
}

