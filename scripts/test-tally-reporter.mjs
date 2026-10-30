// node:test reporter for scripts/run-tests.mjs: counts, per test file, the executed tests that reached the
// reporters. Its destination file is only written when the stream ends, so a run that exits before the
// reporters drained leaves it empty, which the runner treats as lost results.
export default async function* tally(source) {
  const counts = {};
  for await (const { type, data } of source) {
    if (type !== 'test:pass' && type !== 'test:fail') continue;
    // Suites hold no body, and skipped tests never ran one (todo tests do run).
    if (!data.file || data.details?.type === 'suite' || data.skip) continue;
    counts[data.file] = (counts[data.file] ?? 0) + 1;
  }
  yield JSON.stringify(counts);
}
