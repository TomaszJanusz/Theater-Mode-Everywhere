/** Audio chart axes use the same fractional coordinates before mapping to a plot rectangle. */
export function logFraction(hz: number, min: number, max: number): number {
  return Math.log(hz / min) / Math.log(max / min);
}

export function amplitudeDb(level: number, floor = -120): number {
  return Math.max(floor, 20 * Math.log10(level));
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);
}

export function chartDocument(title: string, style: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title>
<style>${style}</style>
</head>
<body>${body}</body>
</html>\n`;
}
