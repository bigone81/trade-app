import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualLevel, getMarketSettings, getMarketSymbols, listMarketSignals, listNotifications, openDatabase, saveMarketSettings } from '@trade/database';
import type { Candle, MarketMonitorStatus } from '@trade/shared';
import { MarketScanner, type PublicMarketData } from './scanner.js';
import { RequestQueue } from './request-queue.js';
import { TestClock } from './test-clock.js';

function fixture() {
  const db = openDatabase(':memory:'), clock = new TestClock(), logs: Record<string, unknown>[] = [];
  const queue = new RequestQueue(2, { clock, random: () => 0, log: entry => logs.push(entry) });
  const requests: string[] = [];
  const source: PublicMarketData = {
    getTickers: async () => [{ symbol: 'XLMUSDT', turnover24h: 60000000 }],
    getInstruments: async () => ({ list: [{ symbol: 'XLMUSDT', status: 'Trading', contractType: 'LinearPerpetual', quoteCoin: 'USDT', settleCoin: 'USDT' }] }),
    getCandles: async (symbol, interval, limit) => {
      requests.push(`${symbol}:${interval}:${limit}`);
      const period = interval === 'D' ? 86400 : Number(interval) * 60;
      const end = Math.floor(clock.now() / 1000 / period) * period;
      const closes = interval === '5' && symbol === 'XLMUSDT' ? [...Array<number>(30).fill(110), 109, 108, 106, 104, 102, 101, 99] : Array<number>(limit).fill(110);
      return closes.map((close, i): Candle => ({ time: end - (closes.length - 1 - i) * period, open: closes[i - 1] ?? close, high: Math.max(close, closes[i - 1] ?? close) + .15, low: Math.min(close, closes[i - 1] ?? close) - .15, close, volume: 100 }));
    },
  };
  saveMarketSettings(db, { ...getMarketSettings(db), enabled: true, concurrency: 5 });
  createManualLevel(db, { symbol: 'XLMUSDT', price: 100.4 });
  const scanner = new MarketScanner(db, source, '', queue);
  const status: Partial<MarketMonitorStatus> = {};
  const scan = () => clock.run(scanner.scan(clock.now(), patch => Object.assign(status, patch)));
  return { db, clock, queue, source, scanner, status, scan, logs, requests };
}

test('recovery and restart preserve observations and send Telegram only once', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  process.env.TELEGRAM_BOT_TOKEN = 'offline-test-token'; process.env.TELEGRAM_CHAT_ID = 'offline-test-chat';
  t.after(() => {
    if (token === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = token;
    if (chat === undefined) delete process.env.TELEGRAM_CHAT_ID; else process.env.TELEGRAM_CHAT_ID = chat;
  });
  let sends = 0;
  t.mock.method(globalThis, 'fetch', async () => { sends++; return new Response('{}', { status: 200 }); });
  saveMarketSettings(f.db, { ...getMarketSettings(f.db), telegramEnabled: true, minPriority: 'LOW' });
  const original = f.source.getCandles; let first = true;
  f.source.getCandles = async (...args) => { if (first) { first = false; throw { retCode: 10006 }; } return original(...args); };
  await f.scan();
  assert.equal(f.status.rateLimitHits, 1); assert.equal(f.status.errors, 0); assert.ok(sends > 0);
  const observations = listMarketSignals(f.db), notifications = listNotifications(f.db), sent = sends;
  const before = f.requests.filter(x => x.startsWith('XLMUSDT:')).length;
  await f.scan();
  const restart = new MarketScanner(f.db, f.source, '', new RequestQueue(2, { clock: f.clock, random: () => 0, log: () => {} }));
  await f.clock.run(restart.scan(f.clock.now(), () => {}));
  assert.deepEqual(listMarketSignals(f.db), observations); assert.deepEqual(listNotifications(f.db), notifications);
  assert.equal(sends, sent);
  assert.equal(f.requests.filter(x => x.startsWith('XLMUSDT:')).length, before, 'already saved symbol/bar is not analyzed again');
});

test('persistent limits defer the cycle once, then next M5 resumes with fresh candles', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const original = f.source.getCandles;
  f.source.getCandles = async () => { throw { retCode: 10006 }; };
  const started = f.clock.now();
  await f.scan();
  assert.equal(f.status.errors, 1); assert.equal(f.status.workerStatus, 'DEGRADED');
  assert.equal(f.status.requestsFailed, 4); assert.equal(listMarketSignals(f.db).length, 0);
  assert.equal(f.logs.filter(x => x.event === 'market-monitor.scan-deferred').length, 1);
  assert.ok(f.clock.now() - started <= 60000);
  f.source.getCandles = original; f.clock.time = started + 300000;
  await f.scan();
  assert.equal(f.status.errors, 0); assert.ok(listMarketSignals(f.db).length > 0);
  assert.equal(getMarketSettings(f.db).concurrency, 5, 'saved concurrency was not rewritten');
});

test('response delayed into next M5 cannot create fresh observations or notifications', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const original = f.source.getCandles;
  f.source.getCandles = async (...args) => { const data = await original(...args); f.clock.time += 300000; return data; };
  await f.scan();
  assert.equal(f.status.errors, 1); assert.match(f.status.error!, /deadline/);
  assert.equal(listMarketSignals(f.db).length, 0); assert.equal(listNotifications(f.db).length, 0);
  assert.equal(getMarketSymbols(f.db)[0]!.scannedAt, null);
});

test('scanner refuses overlapping cycles and combines identical in-flight candle reads', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const work = f.scanner.scan(f.clock.now(), () => {});
  await assert.rejects(f.scanner.scan(f.clock.now(), () => {}), /already running/);
  await f.clock.run(work);
  const before = f.requests.length;
  await f.clock.run(Promise.all([
    f.scanner['cachedCandles']('BTCUSDT', '60', 80, 3600, f.clock.now()),
    f.scanner['cachedCandles']('BTCUSDT', '60', 80, 3600, f.clock.now()),
  ]));
  assert.equal(f.requests.length - before, 1);
});

for (const stale of ['60', '240', 'D:400', 'D:30', 'BTC']) test(`stale ${stale} data cannot produce signals`, async t => {
  const f = fixture(); t.after(() => f.db.close());
  const original = f.source.getCandles;
  f.source.getCandles = async (...args) => {
    const [symbol, interval, limit] = args;
    const candles = await original(...args);
    if (interval === stale || `${interval}:${limit}` === stale || (stale === 'BTC' && symbol === 'BTCUSDT')) return candles.slice(0, -2);
    return candles;
  };
  await f.scan();
  assert.equal(f.status.errors, 1); assert.match(getMarketSymbols(f.db)[0]!.error!, /stale/);
  assert.equal(listMarketSignals(f.db).length, 0); assert.equal(listNotifications(f.db).length, 0);
});
