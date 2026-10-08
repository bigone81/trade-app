import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { openDatabase } from '@trade/database';
import { registerMarketMonitorRoutes } from './market-monitor.js';

test('Market Monitor API validates settings, watchlist, pagination and missing signals', async () => {
  const db = openDatabase(':memory:'), app = Fastify();
  registerMarketMonitorRoutes(app, db);
  try {
    const initial = (await app.inject('/api/market-monitor/settings')).json(); assert.equal(initial.universeMode, 'HYBRID'); assert.equal(initial.enabled, false);
    assert.equal((await app.inject({ method: 'PUT', url: '/api/market-monitor/settings', payload: { enabled: true, minTurnover: 60e6 } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'PUT', url: '/api/market-monitor/settings', payload: { maxAutoSymbols: 0 } })).statusCode, 400);
    assert.equal((await app.inject('/api/market-monitor/settings')).json().maxAutoSymbols, 100);
    assert.equal((await app.inject({ method: 'POST', url: '/api/market-monitor/watchlist', payload: { symbol: 'btcusdt' } })).statusCode, 201);
    assert.equal((await app.inject('/api/market-monitor/watchlist')).json()[0].symbol, 'BTCUSDT');
    assert.equal((await app.inject({ method: 'POST', url: '/api/market-monitor/watchlist', payload: { symbol: "';DROP TABLE manual_levels;--" } })).statusCode, 400);
    assert.equal((await app.inject('/api/market-monitor/signals?limit=99999')).statusCode, 400);
    assert.equal((await app.inject('/api/market-monitor/signals?signalsOnly=true')).statusCode, 200);
    assert.equal((await app.inject('/api/market-monitor/signals/1')).statusCode, 404);
    assert.equal((await app.inject('/api/market-monitor/signals/NaN')).statusCode, 400);
    assert.equal((await app.inject('/api/market-monitor/status')).json().workerStatus, 'OFFLINE');
    assert.equal((await app.inject({ method: 'DELETE', url: '/api/market-monitor/watchlist/BTCUSDT' })).statusCode, 200);
  } finally { await app.close(); db.close(); }
});
