import test from 'node:test';
import assert from 'node:assert/strict';
import { claimMarketLease, createManualLevel, getMarketSettings, getMarketWatchlist, initializeMarketMonitor, listManualLevels, openDatabase, releaseMarketLease, saveMarketWatchSymbol } from './index.js';

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
