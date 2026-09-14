export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(error: unknown): Result<T> {
  return { ok: false, error };
}

export async function allSettledResults<T>(promises: Array<Promise<T>>): Promise<Array<Result<T>>> {
  const settled = await Promise.allSettled(promises);
  return settled.map((item) => (
    item.status === 'fulfilled' ? ok(item.value) : err(item.reason)
  ));
}

export function fulfilledValues<T>(results: Array<Result<T>>): T[] {
  return results.filter((item): item is { ok: true; value: T } => item.ok).map((item) => item.value);
}
