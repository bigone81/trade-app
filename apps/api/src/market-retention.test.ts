import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { cleanupMarketSignals, getMarketSettings, openDatabase, type MarketRetentionResult } from '@trade/database';
import { MARKET_RETENTION_INTERVAL_MS, registerMarketRetention, runMarketRetention } from './market-retention.js';

const result = (): MarketRetentionResult => ({ startedAt: new Date().toISOString(), cutoffAt: new Date(Date.now() - 259200000).toISOString(), deletedRows: 0, batches: 0, durationMs: 0, stopped: false, error: null });

test('API schedules at startup and every hour even with Market Monitor disabled, and clears the timer', async t => {
  const db = openDatabase(':memory:'), app = Fastify();
  t.after(async () => { await app.close(); db.close(); });
  const interval = globalThis.setInterval;
  let tick!: () => void, delay = 0, calls = 0;
  t.mock.method(globalThis, 'setInterval', (callback: () => void, ms?: number) => {
    tick = callback; delay = ms!; return interval(callback, ms);
  });
  const clear = t.mock.method(globalThis, 'clearInterval');
  registerMarketRetention(app, ':memory:', async (_path, signal) => { calls++; return cleanupMarketSignals(db, { signal }); });
  assert.equal(getMarketSettings(db).enabled, false);
  await app.ready(); assert.equal(calls, 0);
  await app.listen({ host: '127.0.0.1', port: 0 });
  await yieldToEventLoop(); await yieldToEventLoop();
  assert.equal(calls, 1); assert.equal(delay, MARKET_RETENTION_INTERVAL_MS); assert.equal(delay, 3600000);
  tick(); await yieldToEventLoop(); await yieldToEventLoop();
  assert.equal(calls, 2);
  await app.close();
  assert.ok(clear.mock.callCount() > 0);
  tick(); await yieldToEventLoop(); assert.equal(calls, 2);
});

test('overlapping ticks share one job; closing the API aborts and awaits it', async t => {
  const app = Fastify(); t.after(() => app.close());
  let calls = 0, aborted = false;
  const scheduler = registerMarketRetention(app, 'unused', async (_path, signal) => {
    calls++;
    return new Promise(resolve => signal.addEventListener('abort', () => { aborted = true; resolve({ ...result(), stopped: true }); }, { once: true }));
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  await yieldToEventLoop();
  const first = scheduler.runNow(), second = scheduler.runNow();
  assert.equal(first, second); assert.equal(calls, 1);
  await app.close(); await first;
  assert.equal(aborted, true);
  await scheduler.runNow(); assert.equal(calls, 1);
});

for (const failure of ['database', 'thread']) test(`${failure} failure is logged safely and API stays available`, async t => {
  const db = openDatabase(':memory:'); db.close();
  const app = Fastify(); t.after(() => app.close());
  const logs: Record<string, unknown>[] = [];
  t.mock.method(app.log, 'error', (entry: Record<string, unknown>) => { logs.push(entry); });
  registerMarketRetention(app, ':memory:', async () => {
    if (failure === 'thread') throw new Error('secret-token JSON must not appear in logs');
    return cleanupMarketSignals(db);
  });
  app.get('/api/health', async () => ({ status: 'ok' }));
  await app.listen({ host: '127.0.0.1', port: 0 });
  await yieldToEventLoop(); await yieldToEventLoop();
  assert.equal((await app.inject('/api/health')).statusCode, 200);
  const entry = logs.find(x => x.event === 'market-monitor.retention')!;
  assert.ok(entry.error); assert.ok(entry.startedAt); assert.equal(typeof entry.durationMs, 'number');
  assert.ok('deletedRows' in entry);
  assert.equal(JSON.stringify(logs).includes('secret-token'), false);
});

test('maintenance thread uses the real WAL database and returns SQLITE_BUSY without touching other data', async t => {
  const path = fileURLToPath(new URL(`../../../data/retention-test-${randomUUID()}.sqlite`, import.meta.url));
  const db = openDatabase(path);
  t.after(() => {
    db.close();
    // Only the three explicitly named test files; never recursively delete a directory.
    for (const file of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(file)) unlinkSync(file);
  });
  assert.equal(db.prepare('PRAGMA journal_mode').get()!.journal_mode, 'wal');
  db.exec(`INSERT INTO market_signals(symbol,bar_time,direction,level_price,level_key,level_types_json,
    approach_score,breakout_score,rejection_score,priority,features_json,metrics_json,payload_json,created_at)
    VALUES('BTCUSDT',1,'UP',100,'test','[]',0,0,0,'LOW','[]','{}','{}','2000-01-01 00:00:00')`);
  const stopped = await runMarketRetention(path, AbortSignal.abort());
  assert.equal(stopped.stopped, true); assert.equal(stopped.deletedRows, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM market_signals').get()!.count, 1);
  db.exec('BEGIN IMMEDIATE');
  try {
    const busy = await runMarketRetention(path, new AbortController().signal);
    assert.equal(busy.error?.code, 'SQLITE_BUSY'); assert.equal(busy.deletedRows, 0);
  } finally { db.exec('ROLLBACK'); }
  const cleaned = await runMarketRetention(path, new AbortController().signal);
  assert.equal(cleaned.error, null); assert.equal(cleaned.deletedRows, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM market_signals').get()!.count, 0);
});
