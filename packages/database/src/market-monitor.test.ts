import test from 'node:test';
import assert from 'node:assert/strict';
import { claimMarketLease, createManualLevel, getMarketSettings, getMarketWatchlist, initializeMarketMonitor, insertMarketObservation, listManualLevels, listMarketSignalPage, listMarketSignals, openDatabase, releaseMarketLease, saveMarketWatchSymbol, type SqliteDb } from './index.js';
import type { MarketObservation, MarketPriority } from '@trade/shared';

function observation(priority: MarketPriority, index: number, scenario: MarketObservation['scenario'] = 'BREAKOUT_SETUP'): MarketObservation {
  return {
    symbol: 'BTCUSDT', barTime: 1_000 + index, price: 100 + index, direction: 'UP',
    cluster: { key: `level-${index}`, price: 100 + index, types: [], members: [], autoTouches: 0, autoStrength: 0 },
    features: [], metrics: {}, scores: { approach: index, breakout: index, rejection: index, priority, conflict: false, contributions: { approach: {}, breakout: {}, rejection: {} } }, scenario,
  };
}
function seedSignals(db: SqliteDb) {
  const rows: Array<[MarketPriority, string, MarketObservation['scenario']]> = [
    ['LOW', '2026-10-09 10:00:00', 'BREAKOUT_SETUP'], ['CRITICAL', '2026-10-09 11:00:00', 'BREAKOUT_SETUP'],
    ['MEDIUM', '2026-10-08 23:00:00', null], ['HIGH', '2026-10-09 12:00:00', 'REJECTION_SETUP'],
  ];
  for (const [index, [priority, createdAt, scenario]] of rows.entries()) {
    const id = insertMarketObservation(db, observation(priority, index, scenario));
    db.prepare('UPDATE market_signals SET created_at=? WHERE id=?').run(createdAt, id);
  }
}

test('market schema initialization is idempotent and preserves existing manual levels/settings', () => {
  const db = openDatabase(':memory:');
  try {
    createManualLevel(db, { symbol: 'BTCUSDT', price: 100 });
    saveMarketWatchSymbol(db, 'ETHUSDT'); initializeMarketMonitor(db); initializeMarketMonitor(db);
    assert.equal(listManualLevels(db, 'BTCUSDT').length, 1); assert.equal(getMarketWatchlist(db).length, 1);
    assert.equal(getMarketSettings(db).maxAutoSymbols, 100);
  } finally { db.close(); }
});
test('worker lease prevents concurrent owners and can be recovered after expiry', () => {
  const db = openDatabase(':memory:');
  try {
    assert.equal(claimMarketLease(db, 'a', 1000), true);
    assert.equal(claimMarketLease(db, 'b', 2000), false);
    assert.equal(claimMarketLease(db, 'a', 2000), true);
    assert.equal(claimMarketLease(db, 'b', 63000), true);
    releaseMarketLease(db, 'a'); assert.equal(claimMarketLease(db, 'c', 64000), false);
    releaseMarketLease(db, 'b'); assert.equal(claimMarketLease(db, 'c', 64000), true);
  } finally { db.close(); }
});

test('market signal pages apply identical filters to count and rows with stable SQL sorting', () => {
  const db = openDatabase(':memory:');
  try {
    seedSignals(db);
    const priorityPage = listMarketSignalPage(db, { page: 1, pageSize: 10, priority: 'HIGH', sort: 'newest' });
    assert.equal(priorityPage.total, 1); assert.equal(priorityPage.totalPages, 1); assert.equal(priorityPage.items[0]?.scores.priority, 'HIGH');
    const important = listMarketSignalPage(db, { page: 1, pageSize: 10, signalsOnly: true, sort: 'priority_desc' });
    assert.deepEqual(important.items.map(row => row.scores.priority), ['CRITICAL', 'HIGH', 'LOW']);
    const old = listMarketSignalPage(db, { page: 1, pageSize: 10, sort: 'oldest' });
    assert.deepEqual(old.items.map(row => row.createdAt), ['2026-10-08 23:00:00', '2026-10-09 10:00:00', '2026-10-09 11:00:00', '2026-10-09 12:00:00']);
  } finally { db.close(); }
});

test('market signal pages support inclusive UTC date boundaries, direct pages and retention shrinkage', () => {
  const db = openDatabase(':memory:');
  try {
    seedSignals(db);
    const day = listMarketSignalPage(db, { page: 1, pageSize: 2, dateFromUtc: '2026-10-09 00:00:00', dateToUtcExclusive: '2026-10-10 00:00:00', sort: 'newest' });
    assert.equal(day.total, 3); assert.equal(day.totalPages, 2); assert.equal(day.items.length, 2);
    const second = listMarketSignalPage(db, { page: 2, pageSize: 2, dateFromUtc: '2026-10-09 00:00:00', dateToUtcExclusive: '2026-10-10 00:00:00', sort: 'newest' });
    assert.equal(second.items.length, 1); assert.equal(new Set([...day.items, ...second.items].map(row => row.id)).size, 3);
    const last = listMarketSignalPage(db, { page: 99, pageSize: 2, sort: 'newest' });
    assert.equal(last.page, 2); assert.equal(last.items.length, 2);
    db.prepare('DELETE FROM market_signals WHERE id=?').run(last.items[0]!.id);
    const shrunk = listMarketSignalPage(db, { page: 2, pageSize: 2, sort: 'newest' });
    assert.equal(shrunk.totalPages, 2); assert.equal(shrunk.page, 2);
    db.prepare('DELETE FROM market_signals WHERE id<>?').run(shrunk.items[0]!.id);
    const emptyPage = listMarketSignalPage(db, { page: 2, pageSize: 2, sort: 'newest' });
    assert.equal(emptyPage.totalPages, 1); assert.equal(emptyPage.page, 1); assert.equal(emptyPage.items.length, 1);
  } finally { db.close(); }
});

test('legacy market signal list remains cursor-compatible', () => {
  const db = openDatabase(':memory:');
  try {
    seedSignals(db);
    const first = listMarketSignals(db, { limit: 2 });
    const older = listMarketSignals(db, { before: first[1]!.id, limit: 10 });
    assert.equal(first.length, 2); assert.equal(older.length, 2); assert.ok(first.every(row => row.id > older[0]!.id));
  } finally { db.close(); }
});
