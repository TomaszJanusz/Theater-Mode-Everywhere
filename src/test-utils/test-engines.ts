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
