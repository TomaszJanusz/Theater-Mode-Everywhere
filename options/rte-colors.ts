import type { ProviderCapabilities } from '../src/providers/capabilities';

/** One palette-to-CSS boundary. TME-48's data-contrast="high" and
 * data-transparency="reduced" hooks can flatten --rte-tint/--rte-border and
 * hide .rte-tile::before with one shared override, without provider selectors. */
export function serviceColorProperties(provider: ProviderCapabilities): Record<string, string> {
  const { brand } = provider;
  const colors = [brand.primary, ...(brand.secondary ? [brand.secondary] : []), ...(brand.extra ?? [])];
  const tint = colors.map((color, index) => {
    // White is only an 8% tint, never a light surface inside the dark theme.
    const light = color === '#FFFFFF' || color === '#FAFCFD';
    return `color-mix(in srgb, ${color} ${light ? 8 : 14}%, transparent) ${colors.length === 1 ? 0 : index * 68 / (colors.length - 1)}%`;
  });
  const border = brand.uiBorder.map(color => `color-mix(in srgb, ${color} 55%, var(--border-color))`);
  const stripeColors = brand.stripes ?? [];
  // Column samples retain their order; varied widths evoke narrow title-card ribbons.
  const widths = stripeColors.map((_, index) => [1, 2, 1, 3, 2][index % 5]);
  const total = widths.reduce((sum, width) => sum + width, 0);
  let position = 0;
  const stripes = stripeColors.map((color, index) => {
    const start = position * 100 / total;
    position += widths[index];
    return `${color} ${start}% ${position * 100 / total}%`;
  });
  return {
    '--service-color': brand.uiAccent,
    '--rte-tint': brand.tile
      ? `linear-gradient(150deg, ${brand.tile.join(', ')})`
      : `linear-gradient(150deg, ${tint.join(', ')}, transparent ${colors.length === 1 ? 68 : 100}%)`,
    '--rte-border': `linear-gradient(150deg, ${border.length === 1 ? [border[0], border[0]].join(', ') : border.join(', ')})`,
    '--rte-stripes': stripes.length ? `linear-gradient(90deg, ${stripes.join(', ')})` : 'none',
    '--rte-arc': `conic-gradient(from 240deg, transparent 0deg, ${brand.primary} 30deg, ${brand.secondary ?? brand.uiAccent} 100deg, transparent 140deg)`
  };
}
