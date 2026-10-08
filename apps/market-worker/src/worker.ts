import { randomUUID } from 'node:crypto';
import { BybitAdapter } from '@trade/exchanges-bybit';
import { claimMarketLease, getMarketSettings, getMarketStatus, openDatabase, releaseMarketLease, saveMarketStatus } from '@trade/database';
import { MarketScanner, closedBarTime, nextScanTime } from './scanner.js';

const db = openDatabase();
const owner = randomUUID();
// No account resolver or credentials: this process can only request public market data.
const bybit = new BybitAdapter(() => { throw new Error('Market Monitor has no trading account access'); });
const scanner = new MarketScanner(db, {
  getCandles: (symbol, interval, limit) => bybit.getCandles(symbol, interval, limit),
  getTickers: () => bybit.getTickers(),
  getInstruments: async cursor => {
    const response = await bybit.getPublicClient().getInstrumentsInfo({ category: 'linear', status: 'Trading', limit: 1000, ...(cursor ? { cursor } : {}) });
    if (response.retCode !== 0) throw new Error(response.retMsg || 'Bybit instruments error');
    return response.result as Awaited<ReturnType<import('./scanner.js').PublicMarketData['getInstruments']>>;
  },
});
if (!claimMarketLease(db, owner)) throw new Error('Another market-worker owns the database lease');
let status = { ...getMarketStatus(db), workerStatus: 'STARTING' as const } as ReturnType<typeof getMarketStatus>;
let busy = false, stopping = false, lastBar: number | null = null;
function heartbeat() {
  if (!claimMarketLease(db, owner)) { console.error('Lost market-worker lease'); process.exit(1); }
  status.heartbeatAt = new Date().toISOString();
  saveMarketStatus(db, status);
}
heartbeat();
const heartbeats = setInterval(heartbeat, 15_000);
async function tick() {
  if (busy || stopping) return;
  const s = getMarketSettings(db), now = Date.now();
  if (!s.enabled) { status.workerStatus = 'DISABLED'; status.nextScan = null; lastBar = null; heartbeat(); return; }
  const bar = closedBarTime(now, s.scanDelaySeconds);
  status.nextScan = new Date(nextScanTime(now, s.scanDelaySeconds)).toISOString();
  if (bar === lastBar) return;
  busy = true; lastBar = bar;
  status = { ...status, workerStatus: 'SCANNING', symbolsScanned: 0, requestsMade: 0, cycleDurationMs: 0, errors: 0, signalsDetected: 0, alertsSent: 0, error: null };
  heartbeat();
  try {
    await scanner.scan(now, patch => { Object.assign(status, patch); saveMarketStatus(db, status); });
    status.workerStatus = getMarketSettings(db).enabled ? status.errors ? 'DEGRADED' : 'LIVE' : 'DISABLED';
    status.lastScan = new Date(now).toISOString();
  } catch (error) { status.workerStatus = 'DEGRADED'; status.errors++; status.error = error instanceof Error ? error.message : String(error); }
  finally {
    status.nextScan = getMarketSettings(db).enabled ? new Date(nextScanTime(Date.now(), s.scanDelaySeconds)).toISOString() : null;
    heartbeat(); console.log(JSON.stringify({ event: 'market-monitor.cycle', ...status })); busy = false;
    if (stopping) shutdown();
  }
}
const timer = setInterval(() => { void tick().catch(error => { console.error(error); process.exit(1); }); }, 2000);
function shutdown() { clearInterval(timer); clearInterval(heartbeats); releaseMarketLease(db, owner); db.close(); process.exit(0); }
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { stopping = true; if (!busy) shutdown(); });
await tick();
