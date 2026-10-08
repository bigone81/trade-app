import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualLevel, getMarketClusters, getMarketSettings, getMarketStates, getMarketSymbols, listMarketSignals, listNotifications, openDatabase, saveMarketSettings } from '@trade/database';
import { detectLevels } from '@trade/domain';
import type { Candle } from '@trade/shared';
import { closedBarTime, MarketScanner, nextScanTime, RequestQueue, type PublicMarketData } from './scanner.js';

test('schedule analyzes each closed M5 bar only after the configured delay', () => {
  const boundary = Date.UTC(2026, 0, 1, 12);
  assert.equal(closedBarTime(boundary + 4999, 5), boundary / 1000 - 600);
  assert.equal(closedBarTime(boundary + 5000, 5), boundary / 1000 - 300);
  assert.equal(nextScanTime(boundary + 5000, 5), boundary + 305000);
});
test('request queue bounds concurrency even when requests reject', async () => {
  const queue = new RequestQueue(2, 0); let active = 0, max = 0;
  await Promise.allSettled(Array.from({ length: 8 }, (_, i) => queue.run(async () => {
    max = Math.max(max, ++active); await new Promise(resolve => setTimeout(resolve, 2)); active--; if (i === 3) throw new Error('test');
  })));
  assert.equal(max, 2); assert.equal(queue.requests, 8); assert.equal(active, 0);
});
test('scanner shares chart levels, persists silent observations, caches HTF and deduplicates restart', async () => {
  const db = openDatabase(':memory:');
  let now = Date.UTC(2026, 0, 1, 12, 0, 5);
  const history: Record<string, number> = {};
  const source: PublicMarketData = {
    getTickers: async () => [{ symbol: 'XLMUSDT', turnover24h: 1 }],
    getInstruments: async () => ({ list: [{ symbol: 'XLMUSDT', status: 'Trading', contractType: 'LinearPerpetual', quoteCoin: 'USDT', settleCoin: 'USDT' }] }),
    getCandles: async (symbol, interval, limit) => {
      history[`${symbol}:${interval}:${limit}`] = (history[`${symbol}:${interval}:${limit}`] ?? 0) + 1;
      const period = interval === 'D' ? 86400 : Number(interval) * 60;
      const end = Math.floor(now / 1000 / period) * period;
      const closes = interval === '5' && symbol === 'XLMUSDT' ? [...Array(30).fill(110), 109, 108, 106, 104, 102, 101, 99] : Array(limit).fill(110);
      return closes.map((close, i): Candle => ({ time: end - (closes.length - 1 - i) * period, open: closes[i - 1] ?? close, high: Math.max(close, closes[i - 1] ?? close) + .15, low: Math.min(close, closes[i - 1] ?? close) - .15, close, volume: 100 }));
    },
  };
  try {
    saveMarketSettings(db, { ...getMarketSettings(db), enabled: true });
    createManualLevel(db, { symbol: 'XLMUSDT', price: 100.4 });
    const scanner = new MarketScanner(db, source); await scanner.scan(now, () => {});
    const first = listMarketSignals(db); assert.ok(first.length > 0); assert.ok(first[0]!.scores.approach >= 5);
    assert.equal(first[0]!.price, 101, 'open M5 candle must be excluded');
    assert.equal(first[0]!.scenario, 'REJECTION_SETUP');
    assert.equal(getMarketSymbols(db)[0]!.sources.includes('manual'), true);
    assert.equal(listNotifications(db)[0]!.telegramStatus, 'not_requested');
    const chartLevels = detectLevels(await source.getCandles('XLMUSDT', 'D', 30));
    const monitorAuto = getMarketClusters(db, 'XLMUSDT').flatMap(x => x.members).filter(x => x.type !== 'manual').map(x => [x.type, x.price, x.touches, x.strength]);
    assert.deepEqual(monitorAuto, [...chartLevels.limitLevels, ...chartLevels.mirrorLevels].map(x => [x.type, x.price, x.touches, x.strength]));
    const notifications = listNotifications(db).length;
    await new MarketScanner(db, source).scan(now, () => {});
    assert.equal(listMarketSignals(db).length, first.length); assert.equal(listNotifications(db).length, notifications);
    assert.ok(getMarketStates(db, 'XLMUSDT').length > 0);
    const dailyRequests = history['XLMUSDT:D:400'], h4Requests = history['XLMUSDT:240:80'];
    now += 300000; await scanner.scan(now, () => {});
    assert.equal(history['XLMUSDT:D:400'], dailyRequests); assert.equal(history['XLMUSDT:240:80'], h4Requests);
    assert.ok(listMarketSignals(db).length > first.length, 'unchanged scores still produce historical observations');
    assert.equal(listNotifications(db).length, notifications, 'cooldown suppresses a duplicate alert');
  } finally { db.close(); }
});
test('stale candles mark a symbol degraded without generating signals', async () => {
  const db = openDatabase(':memory:');
  try {
    saveMarketSettings(db, { ...getMarketSettings(db), enabled: true });
    createManualLevel(db, { symbol: 'XLMUSDT', price: 100 });
    const scanner = new MarketScanner(db, {
      getTickers: async () => [], getInstruments: async () => ({ list: [{ symbol: 'XLMUSDT', status: 'Trading', contractType: 'LinearPerpetual', quoteCoin: 'USDT', settleCoin: 'USDT' }] }), getCandles: async () => [],
    });
    await scanner.scan(Date.UTC(2026, 0, 1, 12, 0, 5), () => {});
    assert.equal(listMarketSignals(db).length, 0); assert.match(getMarketSymbols(db)[0]!.error!, /stale/);
  } finally { db.close(); }
});
