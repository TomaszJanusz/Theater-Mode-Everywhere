export type TestEngine = 'chromium' | 'firefox';

export function parseTestEngines(value = process.env.THEATER_TEST_ENGINES): TestEngine[] {
  if (value === undefined) return ['chromium', 'firefox'];
  const engines = value.split(',').map(engine => engine.trim());
  const valid = (engine: string): engine is TestEngine => engine === 'chromium' || engine === 'firefox';
  if (engines.length === 0 || !engines.every(valid) || new Set(engines).size !== engines.length) {
    throw new Error('THEATER_TEST_ENGINES must be chromium, firefox, or chromium,firefox');
  }
  return engines;
}

export function testEngines(): TestEngine[] {
  return parseTestEngines();
}

/** Keep existing labels and browser types while selecting the requested engines. */
export function selectTestEngines<T>(values: readonly T[], name: (value: T) => string): T[] {
  const engines: readonly string[] = testEngines();
  return values.filter(value => engines.includes(name(value).toLowerCase()));
}

/**
 * The `skip` option of a test or suite tied to one engine: false when that engine is selected (always when
 * THEATER_TEST_ENGINES is unset), otherwise the reason. The CI Firefox lane runs only when the required Chromium
 * lane runs the same files, so an engine-tied case skipped there still runs on its own engine's lane.
 */
export function skipUnlessEngine(engine: TestEngine, value = process.env.THEATER_TEST_ENGINES): string | false {
  const engines = parseTestEngines(value);
  return engines.includes(engine) ? false : `needs ${engine}; THEATER_TEST_ENGINES=${engines.join(',')}`;
}
