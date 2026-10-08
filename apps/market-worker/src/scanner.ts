import { detectLevels, analyzeMarket, marketAtr, clusterLevels, advanceMarketState, priorityRank, selectMarketUniverse, formatMarketNotification } from '@trade/domain';
import { attachMarketNotification, createNotification, deliverNotificationTelegram, getManualLevelSymbols, getMarketClusters, getMarketSettings, getMarketStates, getMarketSymbols, getMarketWatchlist, getNotificationSettings, insertMarketObservation, listManualLevels, pruneMarketUniverse, saveMarketState, saveMarketSymbol, type SqliteDb } from '@trade/database';
import type { Candle, MarketMonitorSettings, MarketMonitorStatus, MarketObservation, MarketSymbol, MonitorLevel } from '@trade/shared';

export interface PublicMarketData {
  getCandles(symbol: string, interval: string, limit: number): Promise<Candle[]>;
  getTickers(): Promise<{ symbol: string; turnover24h: number }[]>;
  getInstruments(cursor?: string): Promise<{ list: { symbol: string; status: string; contractType: string; quoteCoin: string; settleCoin: string }[]; nextPageCursor?: string }>;
}
export const closedBarTime = (now: number, delaySeconds: number) => Math.floor((now - delaySeconds * 1000) / 300_000) * 300 - 300;
export const nextScanTime = (now: number, delaySeconds: number) => (Math.floor((now - delaySeconds * 1000) / 300_000) + 1) * 300_000 + delaySeconds * 1000;

/** A shared request queue bounds concurrency and spaces starts across all symbols. */
export class RequestQueue {
  private active = 0;
  private waiters: (() => void)[] = [];
  private nextStart = 0;
  requests = 0;
  constructor(public concurrency = 3, private spacingMs = 100) {}
  async run<T>(request: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) await new Promise<void>(resolve => this.waiters.push(resolve)); else this.active++;
    try {
      const start = Math.max(Date.now(), this.nextStart); this.nextStart = start + this.spacingMs;
      if (start > Date.now()) await new Promise(resolve => setTimeout(resolve, start - Date.now()));
      this.requests++; return await request();
    } finally { const next = this.waiters.shift(); if (next) next(); else this.active--; }
  }
}
export class MarketScanner {
  readonly queue = new RequestQueue();
  private candles = new Map<string, { bucket: number; data: Candle[] }>();
  private universe: ReturnType<typeof selectMarketUniverse> = [];
  private universeAt = 0;
  private universeSignature = '';
  constructor(private db: SqliteDb, private data: PublicMarketData) {}

  private async cachedCandles(symbol: string, interval: string, limit: number, periodSeconds: number, now: number) {
    const key = `${symbol}:${interval}:${limit}`, bucket = Math.floor(now / 1000 / periodSeconds);
    const cached = this.candles.get(key);
    if (cached?.bucket === bucket) return cached.data;
    const data = await this.queue.run(() => this.data.getCandles(symbol, interval, limit));
    if (data.some(c => ![c.time, c.open, c.high, c.low, c.close, c.volume ?? 0].every(Number.isFinite) || c.close <= 0 || c.low <= 0 || c.high < c.low)) throw new Error(`Invalid ${interval} candles for ${symbol}`);
    this.candles.set(key, { bucket, data }); return data;
  }
  private async refreshUniverse(s: MarketMonitorSettings, now: number) {
    const watchlist = getMarketWatchlist(this.db).filter(x => x.enabled).map(x => x.symbol), manual = getManualLevelSymbols(this.db);
    const signature = JSON.stringify([s.universeMode, s.minTurnover, s.exitTurnover, s.maxAutoSymbols, s.alwaysMonitorManualLevels, watchlist, manual]);
    if (signature === this.universeSignature && now - this.universeAt < s.universeRefreshMinutes * 60_000) return;
    const eligible = new Set<string>(); let cursor: string | undefined;
    const cursors = new Set<string>();
    do {
      const page = await this.queue.run(() => this.data.getInstruments(cursor));
      page.list.filter(x => x.status === 'Trading' && x.contractType === 'LinearPerpetual' && x.quoteCoin === 'USDT' && x.settleCoin === 'USDT').forEach(x => eligible.add(x.symbol));
      cursor = page.nextPageCursor || undefined;
      if (cursor && cursors.has(cursor)) throw new Error('Repeated Bybit instruments cursor');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    const tickers = await this.queue.run(() => this.data.getTickers());
    const previousAuto = new Set(getMarketSymbols(this.db).filter(x => x.sources.includes('auto')).map(x => x.symbol));
    this.universe = selectMarketUniverse(tickers, eligible, previousAuto, watchlist, manual, s);
    this.universeAt = now; this.universeSignature = signature;
    const symbols = new Set(this.universe.map(x => x.symbol));
    pruneMarketUniverse(this.db, symbols);
    const existing = new Map(getMarketSymbols(this.db).map(x => [x.symbol, x]));
    for (const row of this.universe) saveMarketSymbol(this.db, { observation: null, lastSignal: null, scannedAt: null, error: null, ...existing.get(row.symbol), ...row });
    for (const key of this.candles.keys()) if (!symbols.has(key.split(':')[0]!) && !key.startsWith('BTCUSDT:')) this.candles.delete(key);
  }
  async scan(now: number, onProgress: (patch: Partial<MarketMonitorStatus>) => void) {
    const start = Date.now(), beforeRequests = this.queue.requests, settings = getMarketSettings(this.db);
    this.queue.concurrency = settings.concurrency;
    let symbolsScanned = 0, errors = 0, signalsDetected = 0, alertsSent = 0;
    const progress = () => onProgress({ symbolsScanned, errors, signalsDetected, alertsSent, requestsMade: this.queue.requests - beforeRequests, cycleDurationMs: Date.now() - start });
    await this.refreshUniverse(settings, now);
    onProgress({ monitoring: this.universe.length, auto: this.universe.filter(x => x.sources.includes('auto')).length, watchlist: this.universe.filter(x => x.sources.includes('watchlist')).length, manual: this.universe.filter(x => x.sources.includes('manual')).length });
    const barTime = closedBarTime(now, settings.scanDelaySeconds);
    const closed = (candles: Candle[], period: number) => candles.filter(x => x.time + period <= barTime + 300);
    const btc = closed(await this.cachedCandles('BTCUSDT', '5', 310, 300, now), 300);
    const existing = new Map(getMarketSymbols(this.db).map(x => [x.symbol, x]));
    let index = 0;
    const runSymbol = async () => {
      while (index < this.universe.length) {
        if (!getMarketSettings(this.db).enabled) return;
        const row = this.universe[index++]!;
        try {
          const [rawM5, rawH1, rawH4, historicalDaily, chartDaily] = await Promise.all([
            this.cachedCandles(row.symbol, '5', 310, 300, now),
            this.cachedCandles(row.symbol, '60', 80, 3600, now),
            this.cachedCandles(row.symbol, '240', 80, 14400, now),
            this.cachedCandles(row.symbol, 'D', 400, 86400, now),
            // The chart includes the open D1 candle. Refresh exactly its 30-bar input once per M5 scan.
            this.cachedCandles(row.symbol, 'D', 30, 300, now),
          ]);
          const m5 = closed(rawM5, 300), h1 = closed(rawH1, 3600), h4 = closed(rawH4, 14400), daily = closed(historicalDaily, 86400);
          if (m5.at(-1)?.time !== barTime || m5.length < 30 || m5.slice(-30).some((x, i, a) => i > 0 && x.time - a[i - 1]!.time !== 300)) throw new Error('Missing or stale closed M5 candles');
          const atr = marketAtr(m5);
          if (atr <= 0) throw new Error('Insufficient ATR history');
          const auto = detectLevels(chartDaily);
          const levels: MonitorLevel[] = [...auto.limitLevels, ...auto.mirrorLevels].map(x => ({ ...x, id: `auto:${x.type}:${x.price}` }));
          levels.push(...listManualLevels(this.db, row.symbol).map(x => ({ id: `manual:${x.id}`, price: x.price, type: 'manual' as const, touches: 0, strength: 0, dates: [] })));
          const clusters = clusterLevels(levels, atr, settings.levelClusterAtr, getMarketClusters(this.db, row.symbol));
          const observations = analyzeMarket({ symbol: row.symbol, m5, h1, h4, daily, btc, clusters, settings });
          // Reset even clusters which are no longer the nearest level ahead.
          for (const state of getMarketStates(this.db, row.symbol)) {
            const level = clusters.find(x => x.key === state.levelKey);
            if (!level || Math.abs(m5.at(-1)!.close - level.price) / atr > settings.resetDistanceAtr) saveMarketState(this.db, { ...state, state: 'RESET' });
          }
          for (const observation of observations) {
            const result = this.persist(observation, settings, now);
            if (result.saved && observation.scenario) signalsDetected++;
            if (result.notification) {
              const current = getMarketSettings(this.db), global = getNotificationSettings(this.db);
              const allowed = current.enabled && current.telegramEnabled && global.telegramMarket && priorityRank(observation.scores.priority) >= priorityRank(current.minPriority) && ['FAST_APPROACH', 'BREAKOUT_SETUP', 'REJECTION_SETUP'].includes(observation.scenario!);
              const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
              await deliverNotificationTelegram(this.db, result.notification, escape(formatMarketNotification(observation, global.language)), allowed);
              const sent = this.db.prepare('SELECT telegram_status FROM notifications WHERE id=?').get(result.notification.id) as { telegram_status: string };
              if (sent.telegram_status === 'sent') alertsSent++;
            }
          }
          const best = [...observations].sort((a, b) => Number(!!b.scenario) - Number(!!a.scenario) || Math.max(b.scores.approach, b.scores.breakout, b.scores.rejection) - Math.max(a.scores.approach, a.scores.breakout, a.scores.rejection))[0] ?? null;
          const signal = observations.find(x => x.scenario);
          const symbol: MarketSymbol = { ...row, observation: best, error: null, scannedAt: new Date(now).toISOString(), lastSignal: signal ? { scenario: signal.scenario!, at: new Date((barTime + 300) * 1000).toISOString() } : existing.get(row.symbol)?.lastSignal ?? null };
          saveMarketSymbol(this.db, symbol, clusters); symbolsScanned++;
        } catch (error) {
          errors++;
          saveMarketSymbol(this.db, { ...row, observation: existing.get(row.symbol)?.observation ?? null, lastSignal: existing.get(row.symbol)?.lastSignal ?? null, scannedAt: existing.get(row.symbol)?.scannedAt ?? null, error: error instanceof Error ? error.message : String(error) });
        }
        progress();
      }
    };
    await Promise.all(Array.from({ length: settings.concurrency }, () => runSymbol()));
    progress();
  }
  private persist(o: MarketObservation, settings: MarketMonitorSettings, now: number) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const id = insertMarketObservation(this.db, o);
      let notification: ReturnType<typeof createNotification> = null;
      if (id && o.scenario) {
        const previous = getMarketStates(this.db, o.symbol).find(x => x.levelKey === o.cluster.key && x.scenario === o.scenario) ?? null;
        const next = advanceMarketState(previous, o, settings, now);
        saveMarketState(this.db, next.state);
        if (next.alert) {
          const message = formatMarketNotification(o, getNotificationSettings(this.db).language);
          notification = createNotification(this.db, { category: 'market', eventType: `market_${o.scenario.toLowerCase()}`, title: message.split('\n')[0]!, message, symbol: o.symbol, actionUrl: `/?symbol=${encodeURIComponent(o.symbol)}&level=${o.cluster.price}`, payload: o, dedupeKey: `market-monitor:${id}` });
          if (notification) attachMarketNotification(this.db, id, notification.id);
        }
      }
      this.db.exec('COMMIT'); return { saved: id !== null, notification };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
