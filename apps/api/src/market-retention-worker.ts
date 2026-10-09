import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { cleanupMarketSignals, marketRetentionError, MARKET_SIGNAL_RETENTION_MS, type MarketRetentionResult } from '@trade/database';

const port = parentPort!;
const controller = new AbortController();
port.on('message', message => { if (message === 'stop') controller.abort(); });
const now = Date.now(), started = performance.now();
let db: DatabaseSync | undefined;
let result: MarketRetentionResult;
try {
  // Existing API database only: do not run schema initialization in the maintenance thread.
  if (!existsSync(workerData.path)) throw new Error('Database does not exist');
  db = new DatabaseSync(workerData.path, { timeout: 100 });
  db.exec('PRAGMA cache_size = -2048; PRAGMA temp_store = FILE; PRAGMA foreign_keys = ON;');
  result = await cleanupMarketSignals(db, { now, signal: controller.signal });
} catch (error) {
  result = { startedAt: new Date(now).toISOString(), cutoffAt: new Date(now - MARKET_SIGNAL_RETENTION_MS).toISOString(), deletedRows: 0, batches: 0, durationMs: Math.round(performance.now() - started), stopped: controller.signal.aborted, error: marketRetentionError(error) };
} finally { db?.close(); }
port.postMessage(result);
port.close();
