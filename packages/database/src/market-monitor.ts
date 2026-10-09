import { defaultMarketMonitorSettings, type LevelCluster, type MarketAlertState, type MarketMonitorSettings, type MarketMonitorStatus, type MarketObservation, type MarketSignal, type MarketSymbol } from '@trade/shared';
import type { SqliteDb } from './index.js';

export function initializeMarketMonitor(db: SqliteDb) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_monitor_settings (
      id INTEGER PRIMARY KEY CHECK(id=1), settings_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS market_monitor_watchlist (
      symbol TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS market_monitor_state (
      symbol TEXT NOT NULL, level_key TEXT NOT NULL, scenario TEXT NOT NULL, state TEXT NOT NULL,
      last_alert_at INTEGER, last_score REAL NOT NULL, last_distance_atr REAL NOT NULL,
      payload_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(symbol,level_key,scenario)
    );
    CREATE TABLE IF NOT EXISTS market_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL, bar_time INTEGER NOT NULL,
      direction TEXT NOT NULL, level_price REAL NOT NULL, level_key TEXT NOT NULL, level_types_json TEXT NOT NULL,
      approach_score REAL NOT NULL, breakout_score REAL NOT NULL, rejection_score REAL NOT NULL,
      priority TEXT NOT NULL, signal_type TEXT, features_json TEXT NOT NULL, metrics_json TEXT NOT NULL,
      payload_json TEXT NOT NULL, notified INTEGER NOT NULL DEFAULT 0, notification_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(symbol,level_key,bar_time)
    );
    CREATE INDEX IF NOT EXISTS idx_market_signals_created ON market_signals(id DESC);
    CREATE INDEX IF NOT EXISTS idx_market_signals_created_at ON market_signals(created_at, id);
    CREATE INDEX IF NOT EXISTS idx_market_signals_priority_created ON market_signals(priority, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_market_signals_signal_created ON market_signals(created_at, id) WHERE signal_type IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_market_signals_symbol ON market_signals(symbol,id DESC);
    CREATE TABLE IF NOT EXISTS market_monitor_symbols (
      symbol TEXT PRIMARY KEY, payload_json TEXT NOT NULL, clusters_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS market_monitor_runtime (
      id INTEGER PRIMARY KEY CHECK(id=1), payload_json TEXT NOT NULL DEFAULT '{}', lease_owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO market_monitor_runtime(id) VALUES(1);
  `);
  db.prepare('INSERT OR IGNORE INTO market_monitor_settings(id,settings_json) VALUES(1,?)').run(JSON.stringify(defaultMarketMonitorSettings));
}
export function getMarketSettings(db: SqliteDb): MarketMonitorSettings {
  const row = db.prepare('SELECT settings_json FROM market_monitor_settings WHERE id=1').get() as { settings_json: string };
  const saved = JSON.parse(row.settings_json);
  return { ...structuredClone(defaultMarketMonitorSettings), ...saved, scoreWeights: {
    approach: { ...defaultMarketMonitorSettings.scoreWeights.approach, ...saved.scoreWeights?.approach },
    breakout: { ...defaultMarketMonitorSettings.scoreWeights.breakout, ...saved.scoreWeights?.breakout },
    rejection: { ...defaultMarketMonitorSettings.scoreWeights.rejection, ...saved.scoreWeights?.rejection },
  } };
}
export function saveMarketSettings(db: SqliteDb, settings: MarketMonitorSettings) {
  db.prepare('UPDATE market_monitor_settings SET settings_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(JSON.stringify(settings));
  return settings;
}
export function getMarketWatchlist(db: SqliteDb) {
  return (db.prepare('SELECT symbol,enabled,created_at FROM market_monitor_watchlist ORDER BY symbol').all() as { symbol: string; enabled: number; created_at: string }[])
    .map(x => ({ symbol: x.symbol, enabled: !!x.enabled, createdAt: x.created_at }));
}
export function saveMarketWatchSymbol(db: SqliteDb, symbol: string, enabled = true) {
  db.prepare('INSERT INTO market_monitor_watchlist(symbol,enabled) VALUES(?,?) ON CONFLICT(symbol) DO UPDATE SET enabled=excluded.enabled').run(symbol, Number(enabled));
}
export function deleteMarketWatchSymbol(db: SqliteDb, symbol: string) { return db.prepare('DELETE FROM market_monitor_watchlist WHERE symbol=?').run(symbol).changes > 0; }
export function getManualLevelSymbols(db: SqliteDb) { return (db.prepare('SELECT DISTINCT symbol FROM manual_levels ORDER BY symbol').all() as { symbol: string }[]).map(x => x.symbol); }
export function getMarketStates(db: SqliteDb, symbol: string): MarketAlertState[] {
  return (db.prepare('SELECT payload_json FROM market_monitor_state WHERE symbol=?').all(symbol) as { payload_json: string }[]).map(x => JSON.parse(x.payload_json));
}
export function saveMarketState(db: SqliteDb, s: MarketAlertState) {
  db.prepare(`INSERT INTO market_monitor_state(symbol,level_key,scenario,state,last_alert_at,last_score,last_distance_atr,payload_json) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(symbol,level_key,scenario) DO UPDATE SET state=excluded.state,last_alert_at=excluded.last_alert_at,last_score=excluded.last_score,last_distance_atr=excluded.last_distance_atr,payload_json=excluded.payload_json,updated_at=CURRENT_TIMESTAMP`)
    .run(s.symbol, s.levelKey, s.scenario, s.state, s.lastAlertAt, s.lastScore, s.lastDistanceAtr, JSON.stringify(s));
}
export function insertMarketObservation(db: SqliteDb, o: MarketObservation): number | null {
  const result = db.prepare(`INSERT OR IGNORE INTO market_signals(symbol,bar_time,direction,level_price,level_key,level_types_json,approach_score,breakout_score,rejection_score,priority,signal_type,features_json,metrics_json,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(o.symbol, o.barTime, o.direction, o.cluster.price, o.cluster.key, JSON.stringify(o.cluster.types), o.scores.approach, o.scores.breakout, o.scores.rejection, o.scores.priority, o.scenario, JSON.stringify(o.features), JSON.stringify(o.metrics), JSON.stringify(o));
  return result.changes ? Number(result.lastInsertRowid) : null;
}
const mapSignal = (row: any): MarketSignal => ({ ...JSON.parse(row.payload_json), id: Number(row.id), notified: !!row.notified, notificationId: row.notification_id, createdAt: row.created_at });
export function listMarketSignals(db: SqliteDb, filters: { symbol?: string; before?: number; limit?: number; signalsOnly?: boolean } = {}): MarketSignal[] {
  const conditions: string[] = []; const values: (string | number)[] = [];
  if (filters.symbol) { conditions.push('symbol=?'); values.push(filters.symbol); }
  if (filters.before) { conditions.push('id<?'); values.push(filters.before); }
  if (filters.signalsOnly) conditions.push('signal_type IS NOT NULL');
  values.push(Math.max(1, Math.min(200, filters.limit ?? 50)));
  return db.prepare(`SELECT * FROM market_signals ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`).all(...values).map(mapSignal);
}
export type MarketSignalSort = 'newest' | 'oldest' | 'priority_desc' | 'priority_asc';
export interface MarketSignalPageFilters {
  symbolSearch?: string;
  page: number;
  pageSize: number;
  priority?: MarketSignal['scores']['priority'];
  signalsOnly?: boolean;
  dateFromUtc?: string;
  dateToUtcExclusive?: string;
  sort: MarketSignalSort;
}
export interface MarketSignalPage {
  items: MarketSignal[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
const priorityRankSql = "CASE priority WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END";
const pageOrderSql: Record<MarketSignalSort, string> = {
  newest: 'created_at DESC, id DESC',
  oldest: 'created_at ASC, id ASC',
  priority_desc: `${priorityRankSql} DESC, created_at DESC, id DESC`,
  priority_asc: `${priorityRankSql} ASC, created_at DESC, id DESC`,
};
function marketSignalPageConditions(filters: MarketSignalPageFilters) {
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  if (filters.symbolSearch) { conditions.push('symbol LIKE ?'); values.push(`${filters.symbolSearch}%`); }
  if (filters.priority) { conditions.push('priority=?'); values.push(filters.priority); }
  if (filters.signalsOnly) conditions.push('signal_type IS NOT NULL');
  if (filters.dateFromUtc) { conditions.push('created_at>=?'); values.push(filters.dateFromUtc); }
  if (filters.dateToUtcExclusive) { conditions.push('created_at<?'); values.push(filters.dateToUtcExclusive); }
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', values };
}
/** Returns one page without parsing payload JSON for rows outside that page. */
export function listMarketSignalPage(db: SqliteDb, filters: MarketSignalPageFilters): MarketSignalPage {
  const { where, values } = marketSignalPageConditions(filters);
  const total = Number((db.prepare(`SELECT COUNT(*) AS total FROM market_signals ${where}`).get(...values) as { total: number }).total);
  const totalPages = Math.ceil(total / filters.pageSize);
  const page = totalPages === 0 ? 1 : Math.min(filters.page, totalPages);
  const offset = (page - 1) * filters.pageSize;
  const rows = db.prepare(`SELECT * FROM market_signals ${where} ORDER BY ${pageOrderSql[filters.sort]} LIMIT ? OFFSET ?`).all(...values, filters.pageSize, offset);
  return { items: rows.map(mapSignal), page, pageSize: filters.pageSize, total, totalPages };
}
export function getMarketSignal(db: SqliteDb, id: number): MarketSignal | null { const row = db.prepare('SELECT * FROM market_signals WHERE id=?').get(id); return row ? mapSignal(row) : null; }
export function attachMarketNotification(db: SqliteDb, id: number, notificationId: number) { db.prepare('UPDATE market_signals SET notified=1,notification_id=? WHERE id=?').run(notificationId, id); }
export function getMarketSymbols(db: SqliteDb): MarketSymbol[] { return (db.prepare('SELECT payload_json FROM market_monitor_symbols ORDER BY symbol').all() as { payload_json: string }[]).map(x => JSON.parse(x.payload_json)); }
export function getMarketClusters(db: SqliteDb, symbol: string): LevelCluster[] {
  const row = db.prepare('SELECT clusters_json FROM market_monitor_symbols WHERE symbol=?').get(symbol) as { clusters_json: string } | undefined;
  return row ? JSON.parse(row.clusters_json) : [];
}
export function saveMarketSymbol(db: SqliteDb, row: MarketSymbol, clusters?: LevelCluster[]) {
  db.prepare(`INSERT INTO market_monitor_symbols(symbol,payload_json,clusters_json) VALUES(?,?,?)
    ON CONFLICT(symbol) DO UPDATE SET payload_json=excluded.payload_json,clusters_json=CASE WHEN ?=1 THEN excluded.clusters_json ELSE market_monitor_symbols.clusters_json END,updated_at=CURRENT_TIMESTAMP`)
    .run(row.symbol, JSON.stringify(row), JSON.stringify(clusters ?? []), Number(clusters !== undefined));
}
export function pruneMarketUniverse(db: SqliteDb, symbols: Set<string>) {
  // Only current display rows are removed. History and dedupe state are retained.
  for (const row of getMarketSymbols(db)) if (!symbols.has(row.symbol)) db.prepare('DELETE FROM market_monitor_symbols WHERE symbol=?').run(row.symbol);
}
const emptyStatus: MarketMonitorStatus = { workerStatus: 'OFFLINE', heartbeatAt: null, lastScan: null, nextScan: null, monitoring: 0, auto: 0, watchlist: 0, manual: 0, symbolsScanned: 0, requestsMade: 0, cycleDurationMs: 0, errors: 0, signalsDetected: 0, alertsSent: 0, error: null };
export function getMarketStatus(db: SqliteDb, now = Date.now()): MarketMonitorStatus {
  const row = db.prepare('SELECT payload_json FROM market_monitor_runtime WHERE id=1').get() as { payload_json: string };
  const status: MarketMonitorStatus = { ...emptyStatus, ...JSON.parse(row.payload_json) };
  if (!status.heartbeatAt || now - Date.parse(status.heartbeatAt) > 90_000) status.workerStatus = 'OFFLINE';
  else if (!getMarketSettings(db).enabled) status.workerStatus = 'DISABLED';
  return status;
}
export function saveMarketStatus(db: SqliteDb, status: MarketMonitorStatus) { db.prepare('UPDATE market_monitor_runtime SET payload_json=? WHERE id=1').run(JSON.stringify(status)); }
export function claimMarketLease(db: SqliteDb, owner: string, now = Date.now()) {
  return db.prepare('UPDATE market_monitor_runtime SET lease_owner=?,lease_until=? WHERE id=1 AND (lease_owner=? OR lease_until<?)').run(owner, now + 60_000, owner, now).changes > 0;
}
export function releaseMarketLease(db: SqliteDb, owner: string) { db.prepare('UPDATE market_monitor_runtime SET lease_until=0 WHERE id=1 AND lease_owner=?').run(owner); }
