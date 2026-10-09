import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import type { SqliteDb } from './index.js';

export const MARKET_SIGNAL_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
export interface MarketRetentionResult {
  startedAt: string;
  cutoffAt: string;
  deletedRows: number;
  batches: number;
  durationMs: number;
  stopped: boolean;
  error: { code: string; sqliteCode?: number } | null;
}
interface CleanupOptions {
  now?: number;
  batchSize?: number;
  signal?: AbortSignal;
}
const active = new WeakMap<SqliteDb, Promise<MarketRetentionResult>>();

/** Do not log database messages: they may contain SQL, JSON or user data. */
export function marketRetentionError(error: unknown): NonNullable<MarketRetentionResult['error']> {
  const value = error as { errcode?: unknown; code?: unknown } | null;
  const sqliteCode = typeof value?.errcode === 'number' ? value.errcode : undefined;
  const primary = sqliteCode === undefined ? undefined : sqliteCode & 255;
  return {
    code: primary === 5 || value?.code === 'SQLITE_BUSY' ? 'SQLITE_BUSY'
      : primary === 6 || value?.code === 'SQLITE_LOCKED' ? 'SQLITE_LOCKED'
      : sqliteCode !== undefined ? 'SQLITE_ERROR' : 'CLEANUP_ERROR',
    ...(sqliteCode !== undefined ? { sqliteCode } : {}),
  };
}

/** One autocommit DELETE per batch. Only market_signals is modified. */
export function cleanupMarketSignals(db: SqliteDb, options: CleanupOptions = {}): Promise<MarketRetentionResult> {
  const running = active.get(db);
  if (running) return running;
  const run = clean(db, options);
  active.set(db, run);
  void run.then(() => active.delete(db), () => active.delete(db));
  return run;
}

async function clean(db: SqliteDb, { now = Date.now(), batchSize = 250, signal }: CleanupOptions): Promise<MarketRetentionResult> {
  const clockStart = performance.now();
  const result: MarketRetentionResult = {
    startedAt: '', cutoffAt: '', deletedRows: 0, batches: 0, durationMs: 0, stopped: false, error: null,
  };
  try {
    result.startedAt = new Date(now).toISOString();
    result.cutoffAt = new Date(now - MARKET_SIGNAL_RETENTION_MS).toISOString();
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error('Invalid cleanup batch size');
    // created_at uses SQLite CURRENT_TIMESTAMP (UTC, YYYY-MM-DD HH:mm:ss).
    // Strip .000 only: keeping it at an exact second would incorrectly delete
    // a row exactly 72 hours old because the shorter TEXT sorts first.
    const cutoff = result.cutoffAt.replace('T', ' ').replace(/(?:\.000)?Z$/, '');
    await yieldToEventLoop();
    if (signal?.aborted) { result.stopped = true; return result; }
    if (db.isTransaction) throw new Error('Cleanup requires an autocommit connection');
    // Lazy creation keeps this maintenance migration out of the trading workers' startup.
    db.exec('CREATE INDEX IF NOT EXISTS idx_market_signals_created_at ON market_signals(created_at)');
    const remove = db.prepare(`DELETE FROM market_signals WHERE id IN (
      SELECT id FROM market_signals WHERE created_at < ? ORDER BY created_at, id LIMIT ?
    )`);
    while (!signal?.aborted) {
      const deleted = Number(remove.run(cutoff, batchSize).changes);
      result.deletedRows += deleted;
      if (deleted > 0) result.batches++;
      if (deleted < batchSize) break;
      // No transaction/statement remains open while other work is allowed to run.
      await yieldToEventLoop();
    }
    result.stopped = signal?.aborted ?? false;
  } catch (error) {
    // BUSY/LOCKED and other errors stop this run; the hourly scheduler retries later.
    // Previously committed batches remain deleted and are included in the result.
    result.error = marketRetentionError(error);
  } finally { result.durationMs = Math.round(performance.now() - clockStart); }
  return result;
}
