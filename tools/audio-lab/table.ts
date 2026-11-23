import type { LabRun } from './types';

const number = (value: number, signed = false): string => {
  if (!Number.isFinite(value)) return 'n/a';
  return `${signed && value >= 0 ? '+' : ''}${value.toFixed(Math.abs(value) < 10 ? 3 : 2)}`;
};

/** The metric table as text: one row per metric with its change, and the notes below it. */
export function formatRun(run: LabRun): string {
  const head = ['Metric', 'Before', 'After', 'Change', 'Unit'];
  const rows = run.metrics.map(row => [row.label, number(row.before), number(row.after), number(row.after - row.before, true), row.unit]);
  const widths = head.map((title, column) => Math.max(title.length, ...rows.map(row => row[column].length)));
  const line = (cells: string[]) => cells.map((cell, column) => (column === 0 || column === 4 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join('  ').trimEnd();
  const notes = [...new Set(run.metrics.flatMap(row => (row.note ? [`${row.label}: ${row.note}`] : [])))];
  const seconds = run.input.channels[0].length / run.input.sampleRate;
  return [
    `${run.effect} on ${run.material} (${seconds.toFixed(1)} s at ${run.input.sampleRate} Hz)`,
    line(head), line(widths.map(width => '-'.repeat(width))), ...rows.map(line),
    ...(notes.length > 0 ? ['', 'Notes', ...notes.map(note => `- ${note}`)] : [])
  ].join('\n');
}
