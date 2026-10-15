/** WCAG 2 relative luminance for opaque sRGB colors. */
export function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Expected six-digit sRGB color: ${hex}`);
    const channels = hex.slice(1).match(/../g)!;
    const [r, g, b] = channels.map(channel => {
      const c = parseInt(channel, 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function accentForeground(color: string): string {
  return contrastRatio('#ffffff', color) > contrastRatio('#09090b', color) ? '#ffffff' : '#09090b';
}

/** Retain the preset hue, raising lightness until it can also label a dark panel. */
export function contrastSafeAccent(color: string): string {
  let result = color;
  while (contrastRatio(result, '#18181b') < 7) {
    result = '#' + result.slice(1).match(/../g)!.map(channel =>
      Math.min(255, parseInt(channel, 16) + 4).toString(16).padStart(2, '0')).join('');
  }
  return result;
}
