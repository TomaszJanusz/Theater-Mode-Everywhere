import { assignShortcut, defaultShortcuts, isReservedShortcut, shortcutConflicts, type Shortcuts } from './shortcuts';

export type ShortcutUpdate = { type: 'resetAll' } | {
  type: 'assign'; action: keyof Shortcuts; shortcut: string; confirmedOwners: Array<keyof Shortcuts>;
};
export type ShortcutUpdateResult = { status: 'saved' | 'reserved' | 'error' } | { status: 'conflict'; owners: Array<keyof Shortcuts> };

export function readShortcutUpdate(value: unknown): ShortcutUpdate | null {
  if (!value || typeof value !== 'object') return null;
  const request = value as Record<string, unknown>;
  if (request.type === 'resetAll') return { type: 'resetAll' };
  if (request.type !== 'assign' || typeof request.action !== 'string' || !Object.hasOwn(defaultShortcuts, request.action)
      || typeof request.shortcut !== 'string' || request.shortcut.length > 80 || !Array.isArray(request.confirmedOwners)
      || !request.confirmedOwners.every(key => typeof key === 'string' && Object.hasOwn(defaultShortcuts, key))) return null;
  return request as ShortcutUpdate;
}

/** A single extension-owned writer prevents concurrent settings tabs from overwriting each other. */
export function createShortcutUpdateQueue(storage: { read(): Promise<Shortcuts>; write(value: Shortcuts): Promise<void> }) {
  let tail: Promise<unknown> = Promise.resolve();
  function apply(request: ShortcutUpdate): Promise<ShortcutUpdateResult> {
    const operation = tail.then(async (): Promise<ShortcutUpdateResult> => {
      if (request.type === 'resetAll') {
        await storage.write({ ...defaultShortcuts });
        return { status: 'saved' };
      }
      if (isReservedShortcut(request.action, request.shortcut)) return { status: 'reserved' };
      const latest = await storage.read();
      const owners = shortcutConflicts(latest, request.action, request.shortcut);
      if (owners.length && [...owners].sort().join(',') !== [...request.confirmedOwners].sort().join(',')) {
        return { status: 'conflict', owners };
      }
      await storage.write(assignShortcut(latest, request.action, request.shortcut));
      return { status: 'saved' };
    });
    tail = operation.catch(() => {});
    return operation;
  }
  return { apply };
}
