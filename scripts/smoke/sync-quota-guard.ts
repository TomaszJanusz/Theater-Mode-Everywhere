import { extensionWorker, type BrowserContext } from './helpers';
import {
  assertBudgetFits, assertWithinBudget, isSyncQuotaMessage, SyncWriteQuotaError, SyncWriteWindow, waitForRoom, type QuotaClock
} from './sync-quota';

interface WorkerWrites { __tmeSyncWrites?: number[] }

/** Counts sync changes made anywhere (options pages, popup, content scripts, the worker) from inside the extension background. */
export interface SyncQuotaGuard {
  /** Gates `name` on its declared budget, runs it and checks what it measured. */
  run(name: string, syncWrites: number, action: () => Promise<void>): Promise<void>;
}

export async function installSyncQuota(context: BrowserContext, clock: QuotaClock): Promise<SyncQuotaGuard> {
  const window = new SyncWriteWindow();
  let total = 0;
  let quotaLog: string | null = null;
  const note = (text: string) => { if (isSyncQuotaMessage(text)) quotaLog ??= text; };
  context.on('console', message => note(message.text()));
  context.on('weberror', error => note(error.error().message));

  // Idempotent: a restarted service worker has lost its listener, so each drain checks and reinstalls it.
  const install = async () => {
    const worker = await extensionWorker(context);
    const fresh = await worker.evaluate(() => {
      const host = globalThis as WorkerWrites;
      if (host.__tmeSyncWrites) return false;
      host.__tmeSyncWrites = [];
      chrome.storage.onChanged.addListener((_changes, area) => { if (area === 'sync') host.__tmeSyncWrites?.push(Date.now()); });
      return true;
    });
    return { worker, fresh };
  };
  await install();
  const drain = async () => {
    const { worker, fresh } = await install();
    if (fresh) console.warn('smoke sync quota: the extension worker restarted; its earlier sync changes are not counted.');
    const times = await worker.evaluate(() => {
      const host = globalThis as WorkerWrites;
      const taken = host.__tmeSyncWrites ?? [];
      host.__tmeSyncWrites = [];
      return taken;
    });
    total += times.length;
    window.record(times);
  };

  return {
    async run(name, syncWrites, action) {
      assertBudgetFits(name, syncWrites);
      const waited = await waitForRoom(window, clock, syncWrites, drain);
      if (waited > 0) console.log(`smoke sync quota: waited ${(waited / 1000).toFixed(1)} s before ${name} (${window.live(clock.now()).length} changes in the last minute, ${syncWrites} declared)`);
      quotaLog = null;
      const before = total;
      let failure: unknown = null;
      try { await action(); } catch (error) { failure = error; }
      await drain();
      const measured = total - before;
      if (process.env.THEATER_SMOKE_TIMING === '1') console.log(`SYNCWRITES ${name} ${measured}/${syncWrites}`);
      const message = failure instanceof Error ? failure.message : '';
      const quota = quotaLog ?? (isSyncQuotaMessage(message) ? message : null);
      if (quota) {
        throw new SyncWriteQuotaError(
          `Smoke scenario "${name}" hit Chrome's chrome.storage.sync write quota (${measured} changes in it, ${window.live(clock.now()).length} in the last minute): ${quota}`,
          { cause: failure ?? undefined });
      }
      if (failure) throw failure;
      assertWithinBudget(name, syncWrites, measured);
    }
  };
}
