import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AlertRecord, ManualLevel, RiskReward } from '@trade/shared';

export type SqliteDb = DatabaseSync;

const schema = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS manual_levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  price REAL NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_manual_levels_symbol ON manual_levels(symbol);

CREATE TABLE IF NOT EXISTS risk_rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('long','short')),
  entry REAL NOT NULL,
  stop REAL NOT NULL,
  target REAL NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_risk_rewards_symbol_tf ON risk_rewards(symbol, timeframe);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  price REAL NOT NULL,
  condition TEXT NOT NULL DEFAULT 'touch' CHECK(condition IN ('cross_up','cross_down','touch')),
  pre_alert_percent REAL,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_id INTEGER,
  telegram_enabled INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  trigger_once INTEGER NOT NULL DEFAULT 1,
  last_price REAL,
  pre_alerted_at TEXT,
  triggered_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_alerts_active_symbol ON alerts(active, symbol);

CREATE TABLE IF NOT EXISTS journal_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_key TEXT UNIQUE,
  legacy_account TEXT,
  account_id INTEGER,
  occurred_at TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT,
  order_type TEXT,
  trigger_price REAL,
  entry_price REAL,
  stop_loss REAL,
  take_profit REAL,
  quantity REAL,
  point_type INTEGER,
  price_level REAL,
  status INTEGER,
  rr REAL,
  style INTEGER,
  note TEXT,
  chart_path TEXT,
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_journal_symbol ON journal_orders(symbol);
CREATE INDEX IF NOT EXISTS idx_journal_account ON journal_orders(account_id);

CREATE TABLE IF NOT EXISTS system_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  severity TEXT NOT NULL DEFAULT 'info',
  event_type TEXT NOT NULL,
  account_id INTEGER,
  symbol TEXT,
  message TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_system_events_created ON system_events(created_at DESC);

CREATE TABLE IF NOT EXISTS worker_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

export function openDatabase(path = process.env.DATABASE_PATH || './data/trade.sqlite') {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(schema);
  return db;
}

const n = (v: unknown) => v === null || v === undefined ? null : Number(v);
const b = (v: unknown) => Boolean(Number(v));

export function listManualLevels(db: SqliteDb, symbol: string): ManualLevel[] {
  return db.prepare('SELECT * FROM manual_levels WHERE symbol=? ORDER BY price').all(symbol.toUpperCase()).map((r: any) => ({
    id: r.id, symbol: r.symbol, price: Number(r.price), label: r.label,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }));
}

export function createManualLevel(db: SqliteDb, input: {symbol:string; price:number; label?:string|null}): ManualLevel {
  const result = db.prepare('INSERT INTO manual_levels(symbol,price,label) VALUES(?,?,?)').run(input.symbol.toUpperCase(), input.price, input.label ?? null);
  return listManualLevels(db, input.symbol).find(x => x.id === Number(result.lastInsertRowid))!;
}

export function updateManualLevel(db: SqliteDb, id:number, input:{price?:number; label?:string|null}): ManualLevel | null {
  const current:any = db.prepare('SELECT * FROM manual_levels WHERE id=?').get(id);
  if (!current) return null;
  db.prepare('UPDATE manual_levels SET price=?, label=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(input.price ?? current.price, input.label === undefined ? current.label : input.label, id);
  const row:any = db.prepare('SELECT * FROM manual_levels WHERE id=?').get(id);
  return { id:row.id, symbol:row.symbol, price:Number(row.price), label:row.label, createdAt:row.created_at, updatedAt:row.updated_at };
}

export function deleteManualLevel(db: SqliteDb, id:number) {
  return db.prepare('DELETE FROM manual_levels WHERE id=?').run(id).changes > 0;
}

export function listRiskRewards(db: SqliteDb, symbol:string, timeframe:string): RiskReward[] {
  return db.prepare('SELECT * FROM risk_rewards WHERE symbol=? AND timeframe=? ORDER BY id DESC').all(symbol.toUpperCase(), timeframe).map((r:any)=>({
    id:r.id, symbol:r.symbol, timeframe:r.timeframe, direction:r.direction,
    entry:Number(r.entry), stop:Number(r.stop), target:Number(r.target), startTime:Number(r.start_time), endTime:Number(r.end_time),
    createdAt:r.created_at, updatedAt:r.updated_at,
  }));
}

export function createRiskReward(db: SqliteDb, input:Omit<RiskReward,'id'|'createdAt'|'updatedAt'>): RiskReward {
  const result=db.prepare(`INSERT INTO risk_rewards(symbol,timeframe,direction,entry,stop,target,start_time,end_time) VALUES(?,?,?,?,?,?,?,?)`)
    .run(input.symbol.toUpperCase(), input.timeframe, input.direction, input.entry, input.stop, input.target, input.startTime, input.endTime);
  return listRiskRewards(db,input.symbol,input.timeframe).find(x=>x.id===Number(result.lastInsertRowid))!;
}

export function updateRiskReward(db: SqliteDb,id:number,input:Partial<Pick<RiskReward,'entry'|'stop'|'target'|'startTime'|'endTime'|'direction'>>):RiskReward|null{
  const r:any=db.prepare('SELECT * FROM risk_rewards WHERE id=?').get(id); if(!r)return null;
  db.prepare(`UPDATE risk_rewards SET direction=?,entry=?,stop=?,target=?,start_time=?,end_time=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(input.direction??r.direction,input.entry??r.entry,input.stop??r.stop,input.target??r.target,input.startTime??r.start_time,input.endTime??r.end_time,id);
  const x:any=db.prepare('SELECT * FROM risk_rewards WHERE id=?').get(id);
  return {id:x.id,symbol:x.symbol,timeframe:x.timeframe,direction:x.direction,entry:Number(x.entry),stop:Number(x.stop),target:Number(x.target),startTime:Number(x.start_time),endTime:Number(x.end_time),createdAt:x.created_at,updatedAt:x.updated_at};
}

export function deleteRiskReward(db:SqliteDb,id:number){return db.prepare('DELETE FROM risk_rewards WHERE id=?').run(id).changes>0;}

export function listAlerts(db:SqliteDb, symbol?:string, activeOnly=false):AlertRecord[]{
  const clauses:string[]=[]; const params:any[]=[];
  if(symbol){clauses.push('symbol=?');params.push(symbol.toUpperCase());}
  if(activeOnly) clauses.push('active=1');
  const where=clauses.length?`WHERE ${clauses.join(' AND ')}`:'';
  return db.prepare(`SELECT * FROM alerts ${where} ORDER BY created_at DESC`).all(...params).map((r:any)=>({
    id:r.id,symbol:r.symbol,price:Number(r.price),condition:r.condition,preAlertPercent:n(r.pre_alert_percent),sourceType:r.source_type,sourceId:n(r.source_id),
    telegramEnabled:b(r.telegram_enabled),active:b(r.active),triggerOnce:b(r.trigger_once),lastPrice:n(r.last_price),preAlertedAt:r.pre_alerted_at,triggeredAt:r.triggered_at,createdAt:r.created_at,
  })) as AlertRecord[];
}

export function createAlert(db:SqliteDb,input:{symbol:string;price:number;condition?:AlertRecord['condition'];preAlertPercent?:number|null;sourceType?:AlertRecord['sourceType'];sourceId?:number|null;telegramEnabled?:boolean;triggerOnce?:boolean}):AlertRecord{
  const result=db.prepare(`INSERT INTO alerts(symbol,price,condition,pre_alert_percent,source_type,source_id,telegram_enabled,trigger_once) VALUES(?,?,?,?,?,?,?,?)`)
    .run(input.symbol.toUpperCase(),input.price,input.condition??'touch',input.preAlertPercent??null,input.sourceType??'manual',input.sourceId??null,input.telegramEnabled===false?0:1,input.triggerOnce===false?0:1);
  return listAlerts(db).find(x=>x.id===Number(result.lastInsertRowid))!;
}
export function setAlertActive(db:SqliteDb,id:number,active:boolean){return db.prepare('UPDATE alerts SET active=? WHERE id=?').run(active?1:0,id).changes>0;}
export function deleteAlert(db:SqliteDb,id:number){return db.prepare('DELETE FROM alerts WHERE id=?').run(id).changes>0;}

export function appendSystemEvent(db:SqliteDb,event:{severity?:string;eventType:string;accountId?:number|null;symbol?:string|null;message:string;payload?:unknown}){
  db.prepare(`INSERT INTO system_events(severity,event_type,account_id,symbol,message,payload_json) VALUES(?,?,?,?,?,?)`)
    .run(event.severity??'info',event.eventType,event.accountId??null,event.symbol??null,event.message,event.payload===undefined?null:JSON.stringify(event.payload));
}

export function listJournal(db:SqliteDb, filters:{accountId?:number;symbol?:string;limit?:number}={}){
  const c:string[]=[];const p:any[]=[];
  if(filters.accountId){c.push('account_id=?');p.push(filters.accountId);}
  if(filters.symbol){c.push('symbol=?');p.push(filters.symbol.toUpperCase());}
  const where=c.length?`WHERE ${c.join(' AND ')}`:'';
  p.push(Math.min(filters.limit??200,1000));
  return db.prepare(`SELECT * FROM journal_orders ${where} ORDER BY occurred_at DESC LIMIT ?`).all(...p);
}
