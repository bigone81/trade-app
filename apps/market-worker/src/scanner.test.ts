import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualLevel, getMarketClusters, getMarketSettings, getMarketStates, getMarketSymbols, listMarketSignals, listNotifications, openDatabase, saveMarketSettings, saveMarketWatchSymbol } from '@trade/database';
import { detectLevels } from '@trade/domain';
import type { Candle, MarketMonitorStatus } from '@trade/shared';
import { closedBarTime, MarketScanner as BaseMarketScanner, nextScanTime, RequestQueue, type PublicMarketData } from './scanner.js';
import { TestClock } from './test-clock.js';

class MarketScanner extends BaseMarketScanner {
  constructor(db: ReturnType<typeof openDatabase>, source: PublicMarketData) {
    super(db, source, '', new RequestQueue(2, { clock: new TestClock(), random: () => 0, log: () => {} }));
  }
  override async scan(now: number, progress: (patch: Partial<MarketMonitorStatus>) => void) {
    const clock = this.queue.clock as TestClock; clock.time = now;
    return clock.run(super.scan(now, progress));
  }
}

test('schedule analyzes each closed M5 bar only after the configured delay', () => {
  const boundary = Date.UTC(2026, 0, 1, 12);
  assert.equal(closedBarTime(boundary + 4999, 5), boundary / 1000 - 600);
  assert.equal(closedBarTime(boundary + 5000, 5), boundary / 1000 - 300);
  assert.equal(nextScanTime(boundary + 5000, 5), boundary + 305000);
});
test('scanner shares chart levels, persists silent observations, caches HTF and deduplicates restart', async () => {
  const db = openDatabase(':memory:');
  let now = Date.UTC(2026, 0, 1, 12, 0, 5);
  const history: Record<string, number> = {};
  const source: PublicMarketData = {
    getTickers: async () => [{ symbol: 'XLMUSDT', turnover24h: 60_000_000 }],
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

test('manual-only analysis follows turnover hysteresis across restarts and watchlist overrides it', async () => {
  const db = openDatabase(':memory:');
  let now = Date.UTC(2026, 0, 1, 12, 0, 5), turnover = 60_000_000, chartRequests = 0;
  const source: PublicMarketData = {
    getTickers: async () => [{ symbol: 'XLMUSDT', turnover24h: turnover }],
    getInstruments: async () => ({ list: [{ symbol: 'XLMUSDT', status: 'Trading', contractType: 'LinearPerpetual', quoteCoin: 'USDT', settleCoin: 'USDT' }] }),
    getCandles: async (symbol, interval, limit) => {
      if (symbol === 'XLMUSDT' && interval === 'D' && limit === 30) chartRequests++;
      const period = interval === 'D' ? 86400 : Number(interval) * 60;
      const end = Math.floor(now / 1000 / period) * period;
      const closes = interval === '5' && symbol === 'XLMUSDT' ? [...Array(30).fill(110), 109, 108, 106, 104, 102, 101, 99] : Array(limit).fill(110);
      return closes.map((close, i): Candle => ({ time: end - (closes.length - 1 - i) * period, open: closes[i - 1] ?? close, high: Math.max(close, closes[i - 1] ?? close) + .15, low: Math.min(close, closes[i - 1] ?? close) - .15, close, volume: 100 }));
    },
  };
  const scan = async (value: number, expectedAuto: boolean, expectedAutoLevels = expectedAuto) => {
    turnover = value; now += 900000;
    const before = chartRequests;
    await new MarketScanner(db, source).scan(now, () => {});
    const row = getMarketSymbols(db)[0]!;
    assert.equal(row.error, null);
    assert.equal(row.sources.includes('auto'), expectedAuto);
    const members = getMarketClusters(db, 'XLMUSDT').flatMap(x => x.members);
    assert.ok(members.some(x => x.type === 'manual' && x.price === 100.4));
    assert.equal(members.some(x => x.type !== 'manual'), expectedAutoLevels);
    assert.equal(chartRequests - before, Number(expectedAutoLevels));
    if (!expectedAutoLevels) {
      const observations = listMarketSignals(db).filter(x => x.barTime === closedBarTime(now, 5));
      assert.ok(observations.length > 0);
      assert.ok(observations.every(x => x.cluster.members.every(m => m.type === 'manual')));
      assert.ok(observations.every(x => x.cluster.price === 100.4));
    }
  };
  try {
    saveMarketSettings(db, { ...getMarketSettings(db), enabled: true });
    createManualLevel(db, { symbol: 'XLMUSDT', price: 100.4 });
    await scan(60_000_000, true);
    await scan(45_000_000, true);
    await scan(40_000_000, true);
    await scan(39_999_999, false);
    await scan(45_000_000, false);
    await scan(50_000_000, true);
    await scan(900_000, false);
    saveMarketWatchSymbol(db, 'XLMUSDT');
    await scan(900_000, false, true);
    saveMarketWatchSymbol(db, 'XLMUSDT', false);
    // A high-turnover manual symbol still gets all levels when Auto selection is disabled.
    saveMarketSettings(db, { ...getMarketSettings(db), universeMode: 'WATCHLIST' });
    await scan(60_000_000, false, true);
  } finally { db.close(); }
});
