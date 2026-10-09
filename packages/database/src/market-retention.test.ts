import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { cleanupMarketSignals, MARKET_SIGNAL_RETENTION_MS, openDatabase, createNotification } from './index.js';

const now = Date.UTC(2026, 9, 9, 12);
const boundary = now - MARKET_SIGNAL_RETENTION_MS;
const utc = (time: number) => new Date(time).toISOString().replace('T', ' ').replace(/(?:\.000)?Z$/, '');
function seed(db: ReturnType<typeof openDatabase>, dates: string[]) {
  const insert = db.prepare(`INSERT INTO market_signals (
    symbol, bar_time, direction, level_price, level_key, level_types_json, approach_score,
    breakout_score, rejection_score, priority, signal_type, features_json, metrics_json, payload_json, notified, created_at
  ) VALUES (?, ?, 'UP', 100, 'test-level', '[]', 1, 2, 3, ?, ?, '[]', '{}', '{}', ?, ?)`);
  dates.forEach((date, i) => insert.run('BTCUSDT', i, ['LOW', 'HIGH', 'CRITICAL'][i % 3]!, i % 2 ? 'BREAKOUT_SETUP' : null, i % 2, date));
}
const remaining = (db: ReturnType<typeof openDatabase>) => db.prepare('SELECT id, created_at FROM market_signals ORDER BY id').all();

test('retention removes all older observations/signals, preserves newer and exact 72-hour boundary in UTC', async t => {
  const db = openDatabase(':memory:'); t.after(() => db.close());
  const dates = [utc(boundary - 86400000), utc(boundary - 1000), utc(boundary - 1), utc(boundary), utc(boundary + 1), utc(now)];
  seed(db, dates);
  const result = await cleanupMarketSignals(db, { now });
  assert.equal(result.error, null); assert.equal(result.deletedRows, 3);
  assert.equal(result.cutoffAt, new Date(boundary).toISOString());
  assert.deepEqual(remaining(db).map(row => row.created_at), dates.slice(3));
});

test('millisecond cutoff removes the older whole second but retains the exact fractional boundary', async t => {
  const db = openDatabase(':memory:'); t.after(() => db.close());
  seed(db, [utc(boundary), utc(boundary + 122), utc(boundary + 123), utc(boundary + 124)]);
  const result = await cleanupMarketSignals(db, { now: now + 123 });
  assert.equal(result.deletedRows, 2);
  assert.deepEqual(remaining(db).map(row => row.created_at), [utc(boundary + 123), utc(boundary + 124)]);
});

test('other tables and notification dedupe remain intact, including rows linked to deleted signals', async t => {
  const db = openDatabase(':memory:'); t.after(() => db.close());
  seed(db, [utc(boundary - 1)]);
  const notification = createNotification(db, { category: 'market', eventType: 'test', title: 'test', message: 'test', dedupeKey: 'market-monitor:1' })!;
  db.prepare('UPDATE market_signals SET notified=1, notification_id=?').run(notification.id);
  db.exec(`
    INSERT INTO journal_orders(id,occurred_at,symbol) VALUES(1,'2020-01-01 00:00:00','BTCUSDT');
    INSERT INTO journal_execution_events(exec_id,journal_order_id,exec_price,exec_qty) VALUES('exec',1,100,1);
    INSERT INTO system_events(event_type,message) VALUES('test','preserved');
    INSERT INTO market_monitor_state VALUES('BTCUSDT','test-level','BREAKOUT_SETUP','ALERTED',1,5,1,'{}','2020-01-01 00:00:00');
    INSERT INTO market_monitor_symbols(symbol,payload_json) VALUES('BTCUSDT','{}');
    INSERT INTO market_monitor_watchlist(symbol) VALUES('BTCUSDT');
    INSERT INTO manual_levels(symbol,price) VALUES('BTCUSDT',100);
  `);
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name <> 'market_signals'").all().map(row => String(row.name));
  const snapshot = () => tables.map(name => db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all());
  const before = snapshot();
  assert.equal((await cleanupMarketSignals(db, { now })).deletedRows, 1);
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(createNotification(db, { category: 'market', eventType: 'test', title: 'test', message: 'test', dedupeKey: 'market-monitor:1' }), notification);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notifications').get()!.count, 1);
});

test('multiple batches release the event loop and transactions; repeat and overlapping calls are safe', async t => {
  const db = openDatabase(':memory:'); t.after(() => db.close());
  seed(db, [...Array<string>(751).fill(utc(boundary - 1)), utc(now)]);
  const work = cleanupMarketSignals(db, { now });
  assert.equal(cleanupMarketSignals(db, { now }), work);
  await yieldToEventLoop();
  assert.equal(remaining(db).length, 502, 'one batch completed before yielding');
  assert.equal(db.isTransaction, false);
  const result = await work;
  assert.equal(result.deletedRows, 751); assert.equal(result.batches, 4);
  assert.equal(remaining(db).length, 1);
  assert.equal((await cleanupMarketSignals(db, { now })).deletedRows, 0);
  const plan = db.prepare('EXPLAIN QUERY PLAN SELECT id FROM market_signals WHERE created_at < ? ORDER BY created_at,id LIMIT ?').all(utc(boundary), 250);
  assert.match(plan.map(row => row.detail).join(' '), /USING COVERING INDEX idx_market_signals_created_at/);
});

test('stop between batches preserves remaining records and allows a later run', async t => {
  const db = openDatabase(':memory:'); t.after(() => db.close());
  seed(db, Array<string>(600).fill(utc(boundary - 1)));
  const controller = new AbortController();
  const work = cleanupMarketSignals(db, { now, signal: controller.signal });
  await yieldToEventLoop(); controller.abort();
  const result = await work;
  assert.equal(result.stopped, true); assert.equal(result.deletedRows, 250); assert.equal(result.error, null);
  assert.equal((await cleanupMarketSignals(db, { now })).deletedRows, 350);
});

test('busy during a later batch returns partial count without rejecting or leaking error contents', async t => {
  const db = openDatabase(':memory:'); t.after(() => db.close());
  seed(db, Array<string>(600).fill(utc(boundary - 1)));
  const prepare = db.prepare.bind(db);
  const mock = t.mock.method(db, 'prepare', (sql: string) => {
    const statement = prepare(sql);
    if (sql.startsWith('DELETE FROM market_signals')) {
      const run = statement.run.bind(statement); let calls = 0;
      t.mock.method(statement, 'run', (...args: Parameters<typeof run>) => {
        if (++calls === 2) throw Object.assign(new Error('sensitive JSON/token'), { code: 'ERR_SQLITE_ERROR', errcode: 5 });
        return run(...args);
      });
    }
    return statement;
  });
  const result = await cleanupMarketSignals(db, { now });
  assert.equal(result.deletedRows, 250); assert.deepEqual(result.error, { code: 'SQLITE_BUSY', sqliteCode: 5 });
  assert.equal(JSON.stringify(result).includes('sensitive'), false);
  mock.mock.restore();
  assert.equal((await cleanupMarketSignals(db, { now })).deletedRows, 350);
});

test('closed database error is reported without rejection; pre-aborted run does no work', async () => {
  const db = openDatabase(':memory:'); db.close();
  assert.ok((await cleanupMarketSignals(db, { now })).error);
  const result = await cleanupMarketSignals(db, { now, signal: AbortSignal.abort() });
  assert.equal(result.stopped, true); assert.equal(result.deletedRows, 0); assert.equal(result.error, null);
});

test('cleanup refuses to join a caller transaction', async t => {
  const db = openDatabase(':memory:'); t.after(() => db.close());
  seed(db, [utc(boundary - 1)]); db.exec('BEGIN');
  const result = await cleanupMarketSignals(db, { now });
  assert.ok(result.error); assert.equal(remaining(db).length, 1); assert.equal(db.isTransaction, true);
  db.exec('ROLLBACK');
});
