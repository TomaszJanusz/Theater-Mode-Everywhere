/**
 * Band energies: the level of a signal per frequency band over chosen frames, to show which part
 * of the spectrum an effect changes.
 *
 * A band is a run of whole bins of the 1024-point grid (46.9 Hz apart at 48 kHz), so its real
 * edges are bin edges, not the round numbers it was asked for. An earlier harness labelled bins
 * centred on 46.9 to 187.5 Hz "80-250 Hz". Here a band takes the bins whose centre lies inside the
 * nominal range and is labelled with what those bins cover, half a bin beyond the outer centres.
 * The window lets neighbouring bins leak into each other, so a tone at an edge shows in both bands.
 */
import { BINS, binRange, framePower, maskedLevel, type Grid } from './grid';

/** Nominal edges; octaves from 250 Hz, with the voice's fundamental range below. */
const NOMINAL_EDGES = [80, 250, 500, 1000, 2000, 4000, 8000, 16000];

export type Band = { id: string; label: string; bins: [number, number]; lowHz: number; highHz: number };

export function bandsOf(grid: Grid): Band[] {
  const bands: Band[] = [];
  for (let i = 0; i + 1 < NOMINAL_EDGES.length; i++) {
    const bins = binRange(grid, NOMINAL_EDGES[i], NOMINAL_EDGES[i + 1]);
    if (bins[1] <= bins[0] || bins[0] >= BINS) continue;
    const [lowHz, highHz] = [(bins[0] - 0.5) * grid.binHz, (bins[1] - 0.5) * grid.binHz];
    const [low, high] = [Math.round(lowHz), Math.round(highHz)];
    bands.push({ id: `band-${low}-${high}`, label: `${low} to ${high} Hz`, bins, lowHz, highHz });
  }
  return bands;
}

export const bandLevel = (grid: Grid, band: Band, mask: Uint8Array): number => maskedLevel(framePower(grid, band.bins), mask);
