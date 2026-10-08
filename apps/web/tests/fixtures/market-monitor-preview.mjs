// Isolated UI preview: no exchange calls, production database, or Telegram delivery.
// Run: node apps/web/tests/fixtures/market-monitor-preview.mjs
import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import react from '@vitejs/plugin-react';
import { defaultMarketMonitorSettings } from '@trade/shared';
import { validateMarketSettings } from '@trade/domain';

let settings = structuredClone(defaultMarketMonitorSettings);
settings.enabled = true;
let watchlist = [{ symbol: 'XLMUSDT', enabled: true }];
const now = Date.now();
const observation = {
  symbol: 'XLMUSDT', barTime: Math.floor(now / 300000) * 300 - 300, price: .19949, direction: 'DOWN',
  cluster: { key: 'manual:1', price: .19671, types: ['manual', 'mirror', 'support'], autoTouches: 4, autoStrength: 4,
    members: [{ id: 'manual:1', price: .1967, type: 'manual', touches: 0, strength: 0, dates: [] }, { id: 'auto:1', price: .19672, type: 'mirror', touches: 4, strength: 4, dates: ['2026-09-01', '2026-09-04'] }] },
  scores: { approach: 7, breakout: 3, rejection: 11, priority: 'CRITICAL', conflict: false, contributions: { approach: { DIRECTIONAL_MOVE: 2, ATR_EXPANSION: 2, DISTANCE_SHRINKING: 2, INDEPENDENT_MOVE: 1 }, breakout: { STICKING_TO_LEVEL: 3 }, rejection: { LONG_NO_PULLBACK_MOVE: 3, ATR_EXPANSION: 2, FAR_RETEST: 3, BIG_BARS_APPROACH: 3 } } },
  features: [
    { key: 'DIRECTIONAL_MOVE', detected: true, value: -1.24, scoreApproach: 2 },
    { key: 'DISTANCE_SHRINKING', detected: true, value: .5, scoreApproach: 2 },
    { key: 'INDEPENDENT_MOVE', detected: true, value: -1.1, scoreApproach: 1 },
    { key: 'STICKING_TO_LEVEL', detected: true, scoreBreakout: 3 },
    { key: 'LONG_NO_PULLBACK_MOVE', detected: true, value: 1.73, scoreRejection: 3 },
    { key: 'ATR_EXPANSION', detected: true, value: 1.73, scoreRejection: 2, scoreApproach: 2 },
    { key: 'FAR_RETEST', detected: true, value: 34, scoreRejection: 3 },
    { key: 'BIG_BARS_APPROACH', detected: true, value: 1.73, scoreRejection: 3 },
    { key: 'COMPRESSION', detected: false, value: 1.04, details: { pressing: false } },
    { key: 'BTC_RELATIVE_STRENGTH', detected: true, value: -1.1, details: { m5: -.8, m15: -1.1, m30: -1.4 } },
  ],
  metrics: { atr: .00662, atrExpansion: 1.73, move3: -1.24, move6: -1.73, efficiency: .82, distanceAtr: .42, distancePercent: 1.39, volumeRatio: 1.62, daysSinceLastTouch: 34, lastTouchAt: Math.floor(now / 1000) - 34 * 86400, touchCount: 4, dailyAtrUsed: null },
  scenario: 'REJECTION_SETUP',
};
const conflict = structuredClone(observation);
conflict.symbol = 'SOLUSDT'; conflict.price = 154.1; conflict.direction = 'UP';
conflict.cluster = { key: 'auto:sol', price: 154.2, types: ['resistance'], autoTouches: 4, autoStrength: 4, members: [{ id: 'auto:sol', price: 154.2, type: 'resistance', touches: 4, strength: 4, dates: ['2026-09-01'] }] };
conflict.metrics = { ...conflict.metrics, atr: 1.6, move3: .8, move6: 1.5, distanceAtr: .0625, distancePercent: .065 };
conflict.scenario = 'FAST_APPROACH';
conflict.features = conflict.features.filter(f => f.key !== 'BIG_BARS_APPROACH').map(f => f.key === 'COMPRESSION' ? { ...f, detected: true, scoreBreakout: 3 } : f);
conflict.features.push({ key: 'SMALL_BARS_APPROACH', detected: true, scoreBreakout: 3 });
conflict.scores = { ...conflict.scores, breakout: 9, rejection: 8, conflict: true, priority: 'HIGH' };
const observations = [observation, conflict];
const vite = await createViteServer({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false }, appType: 'spa' });
const server = createHttpServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:4180');
  const mode = url.searchParams.get('preview') ?? req.headers.cookie?.match(/mm_preview=(\w+)/)?.[1] ?? 'live';
  if (url.searchParams.has('preview')) res.setHeader('set-cookie', `mm_preview=${mode}; Path=/; SameSite=Strict`);
  if (!url.pathname.startsWith('/api/')) return vite.middlewares(req, res);
  const send = (data, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
  const body = async () => { let text = ''; for await (const chunk of req) text += chunk; return JSON.parse(text || '{}'); };
  if (mode === 'error' && url.pathname.startsWith('/api/market-monitor/')) return send({ error: 'Preview: market data service unavailable' }, 503);
  if (mode === 'loading' && url.pathname.startsWith('/api/market-monitor/')) await new Promise(resolve => setTimeout(resolve, 5000));
  const path = url.pathname.replace('/api/market-monitor', '');
  try {
    if (path === '/settings') {
      if (req.method === 'PUT') { await new Promise(resolve => setTimeout(resolve, 500)); settings = validateMarketSettings({ ...settings, ...await body() }); }
      return send({ ...settings, enabled: mode === 'disabled' ? false : settings.enabled });
    }
    if (path === '/watchlist') {
      if (req.method === 'POST') { const data = await body(); watchlist = [...watchlist.filter(x => x.symbol !== data.symbol), { symbol: data.symbol, enabled: data.enabled ?? true }]; }
      return send(watchlist);
    }
    if (path.startsWith('/watchlist/') && req.method === 'DELETE') { watchlist = watchlist.filter(x => x.symbol !== path.split('/').at(-1)); return send({ ok: true }); }
    if (path === '/status') return send({ workerStatus: mode === 'disabled' ? 'DISABLED' : 'LIVE', heartbeatAt: new Date().toISOString(), lastScan: new Date(now).toISOString(), nextScan: new Date(now + 300000).toISOString(), monitoring: mode === 'empty' || mode === 'disabled' ? 0 : 3, auto: 2, watchlist: 1, manual: 1, symbolsScanned: 2, requestsMade: 8, cycleDurationMs: 1500, errors: 1, signalsDetected: 2, alertsSent: 0, error: null });
    if (path === '/symbols') return send(['empty', 'disabled'].includes(mode) ? [] : [...observations.map(o => ({ symbol: o.symbol, observation: o, sources: ['manual'], turnover: 60000000, lastSignal: { scenario: o.scenario, at: new Date(now).toISOString() }, error: null, scannedAt: new Date(now).toISOString() })), { symbol: 'BTCUSDT', observation: null, sources: ['auto'], turnover: 100000000, lastSignal: null, scannedAt: null, error: 'Missing or stale closed M5 candles' }]);
    if (path === '/signals') return send(mode === 'empty' ? [] : Array.from({ length: 52 }, (_, i) => ({ ...observation, id: 52 - i, createdAt: new Date(now - i * 300000).toISOString(), notified: false, notificationId: null })).filter(x => !url.searchParams.has('before') || x.id < Number(url.searchParams.get('before'))).slice(0, Number(url.searchParams.get('limit') || 50)));
    if (url.pathname.endsWith('/unread-count')) return send({ count: 0 });
    if (url.pathname === '/api/config') return send({ accounts: [], liveTradingEnabled: false, defaultSymbol: 'BTCUSDT', defaultTimeframe: '5', telegramConfigured: false });
    if (url.pathname === '/api/market/levels') return send({ limitLevels: [], mirrorLevels: [] });
    if (url.pathname === '/api/market/atr') return send({ atr: .01 });
    if (url.pathname === '/api/market/instrument') return send({ tickSize: '.0001', qtyStep: '1' });
    if (url.pathname === '/api/market/tickers') return send(observations.map(o => ({ symbol: o.symbol, lastPrice: o.price, turnover24h: 60e6, price24hPcnt: .01 })));
    return send([]);
  } catch (error) { send({ error: error.message }, 400); }
});
server.listen(4180, '127.0.0.1', () => console.log('Market Monitor isolated preview: http://127.0.0.1:4180/market-monitor?preview=live'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await vite.close(); server.close(); process.exit(0); });
