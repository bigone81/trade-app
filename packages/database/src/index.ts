import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AccountPublic, AlertRecord, ExchangeId, ManualLevel, MarketKind, RiskReward } from '@trade/shared';

export type SqliteDb = DatabaseSync;

const schema = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS exchange_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT 'linear',
  name TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'prod',
  enabled INTEGER NOT NULL DEFAULT 1,
  credential_source TEXT NOT NULL DEFAULT 'env' CHECK(credential_source IN ('env')),
  api_key_ref TEXT,
  api_secret_ref TEXT,
  legacy_slot INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_exchange_accounts_legacy_slot ON exchange_accounts(exchange, legacy_slot) WHERE legacy_slot IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exchange_accounts_enabled ON exchange_accounts(enabled, exchange);

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
  exchange TEXT NOT NULL DEFAULT 'bybit',
  exit_price REAL,
  pnl REAL,
  fees REAL,
  setup TEXT,
  tags_json TEXT,
  execution_quality TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_journal_symbol ON journal_orders(symbol);
CREATE INDEX IF NOT EXISTS idx_journal_account ON journal_orders(account_id);

CREATE TABLE IF NOT EXISTS journal_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_order_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other' CHECK(kind IN ('before','entry','management','exit','other')),
  path TEXT NOT NULL UNIQUE,
  original_name TEXT,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(journal_order_id) REFERENCES journal_orders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_journal_images_order ON journal_images(journal_order_id, created_at);

CREATE TABLE IF NOT EXISTS journal_execution_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exec_id TEXT NOT NULL UNIQUE,
  journal_order_id INTEGER NOT NULL,
  exec_price REAL NOT NULL,
  exec_qty REAL NOT NULL,
  exec_fee REAL NOT NULL DEFAULT 0,
  occurred_at TEXT,
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(journal_order_id) REFERENCES journal_orders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_journal_execution_order ON journal_execution_events(journal_order_id, occurred_at);

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

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL CHECK(category IN ('market','trading','system')),
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  exchange TEXT NOT NULL DEFAULT 'bybit',
  account_id INTEGER,
  account_name TEXT,
  symbol TEXT,
  action_url TEXT,
  payload_json TEXT,
  dedupe_key TEXT UNIQUE,
  telegram_status TEXT NOT NULL DEFAULT 'not_requested',
  telegram_error TEXT,
  telegram_sent_at TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  settings_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
  const columns = new Set((db.prepare('PRAGMA table_info(journal_orders)').all() as any[]).map((row:any) => String(row.name)));
  const addColumn = (name:string, definition:string) => { if (!columns.has(name)) db.exec(`ALTER TABLE journal_orders ADD COLUMN ${name} ${definition}`); };
  addColumn('exchange', "TEXT NOT NULL DEFAULT 'bybit'");
  addColumn('exit_price', 'REAL');
  addColumn('pnl', 'REAL');
  addColumn('fees', 'REAL');
  addColumn('setup', 'TEXT');
  addColumn('tags_json', 'TEXT');
  addColumn('execution_quality', 'TEXT');
  addColumn('exchange_order_id', 'TEXT');
  addColumn('order_link_id', 'TEXT');
  addColumn('reduce_only', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('risk_percent', 'REAL');
  addColumn('risk_amount', 'REAL');
  addColumn('updated_at', 'TEXT');
  db.exec("UPDATE journal_orders SET updated_at=COALESCE(updated_at,created_at,CURRENT_TIMESTAMP) WHERE updated_at IS NULL");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_exchange_order ON journal_orders(exchange,account_id,exchange_order_id) WHERE exchange_order_id IS NOT NULL AND exchange_order_id<>''");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_order_link ON journal_orders(exchange,account_id,order_link_id) WHERE order_link_id IS NOT NULL AND order_link_id<>''");
  seedLegacyExchangeAccounts(db);
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

export function listRiskRewards(db: SqliteDb, symbol:string, timeframe?:string): RiskReward[] {
  const rows = timeframe
    ? db.prepare('SELECT * FROM risk_rewards WHERE symbol=? AND timeframe=? ORDER BY id DESC').all(symbol.toUpperCase(), timeframe)
    : db.prepare('SELECT * FROM risk_rewards WHERE symbol=? ORDER BY id DESC').all(symbol.toUpperCase());
  return rows.map((r:any)=>({
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
export function updateAlertPrice(db:SqliteDb,id:number,price:number):AlertRecord|null{
  const current:any=db.prepare('SELECT * FROM alerts WHERE id=?').get(id);
  if(!current)return null;
  db.prepare(`UPDATE alerts SET price=?, last_price=NULL, pre_alerted_at=NULL, triggered_at=NULL WHERE id=?`).run(price,id);
  return listAlerts(db).find(x=>x.id===id)??null;
}
export function setAlertActive(db:SqliteDb,id:number,active:boolean){return db.prepare('UPDATE alerts SET active=? WHERE id=?').run(active?1:0,id).changes>0;}
export function deleteAlert(db:SqliteDb,id:number){return db.prepare('DELETE FROM alerts WHERE id=?').run(id).changes>0;}

export function appendSystemEvent(db:SqliteDb,event:{severity?:string;eventType:string;accountId?:number|null;symbol?:string|null;message:string;payload?:unknown}){
  db.prepare(`INSERT INTO system_events(severity,event_type,account_id,symbol,message,payload_json) VALUES(?,?,?,?,?,?)`)
    .run(event.severity??'info',event.eventType,event.accountId??null,event.symbol??null,event.message,event.payload===undefined?null:JSON.stringify(event.payload));
}

export type NotificationSettings = {
  language:'en'|'uk'|'ru';
  marketAlerts:boolean;
  marketPreAlerts:boolean;
  tradingAccepted:boolean;
  tradingFilled:boolean;
  tradingPartial:boolean;
  tradingCancelled:boolean;
  tradingRejected:boolean;
  systemOffline:boolean;
  systemReconnect:boolean;
  telegramMarket:boolean;
  telegramTrading:boolean;
  telegramSystem:boolean;
  systemOfflineSeconds:number;
};

export const defaultNotificationSettings:NotificationSettings={
  language:'en',
  marketAlerts:true,
  marketPreAlerts:true,
  tradingAccepted:true,
  tradingFilled:true,
  tradingPartial:true,
  tradingCancelled:true,
  tradingRejected:true,
  systemOffline:true,
  systemReconnect:false,
  telegramMarket:true,
  telegramTrading:true,
  telegramSystem:true,
  systemOfflineSeconds:60,
};

export function getNotificationSettings(db:SqliteDb):NotificationSettings{
  const row:any=db.prepare('SELECT settings_json FROM notification_settings WHERE id=1').get();
  if(!row){
    db.prepare('INSERT INTO notification_settings(id,settings_json) VALUES(1,?)').run(JSON.stringify(defaultNotificationSettings));
    return {...defaultNotificationSettings};
  }
  try{return {...defaultNotificationSettings,...JSON.parse(String(row.settings_json||'{}'))};}
  catch{return {...defaultNotificationSettings};}
}

export function updateNotificationSettings(db:SqliteDb,patch:Partial<NotificationSettings>):NotificationSettings{
  const current=getNotificationSettings(db);
  const next={...current,...patch};
  next.language=['en','uk','ru'].includes(String(next.language))?next.language:'en';
  next.systemOfflineSeconds=Math.max(10,Math.min(600,Math.round(Number(next.systemOfflineSeconds)||60)));
  db.prepare(`INSERT INTO notification_settings(id,settings_json,updated_at) VALUES(1,?,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=CURRENT_TIMESTAMP`).run(JSON.stringify(next));
  return next;
}

export type NotificationRecord={
  id:number;category:'market'|'trading'|'system';eventType:string;severity:string;title:string;message:string;exchange:string;
  accountId:number|null;accountName:string|null;symbol:string|null;actionUrl:string|null;payload:unknown;telegramStatus:string;telegramError:string|null;
  telegramSentAt:string|null;readAt:string|null;createdAt:string;
};

const mapNotification=(r:any):NotificationRecord=>({
  id:Number(r.id),category:r.category,eventType:r.event_type,severity:r.severity,title:r.title,message:r.message,exchange:r.exchange,
  accountId:n(r.account_id),accountName:r.account_name,symbol:r.symbol,actionUrl:r.action_url,payload:r.payload_json?(()=>{try{return JSON.parse(r.payload_json)}catch{return r.payload_json}})():null,
  telegramStatus:r.telegram_status,telegramError:r.telegram_error,telegramSentAt:r.telegram_sent_at,readAt:r.read_at,createdAt:r.created_at,
});

export function createNotification(db:SqliteDb,input:{
  category:NotificationRecord['category'];eventType:string;severity?:string;title:string;message:string;exchange?:string;accountId?:number|null;accountName?:string|null;
  symbol?:string|null;actionUrl?:string|null;payload?:unknown;dedupeKey?:string|null;
}):NotificationRecord|null{
  const result=db.prepare(`INSERT OR IGNORE INTO notifications(category,event_type,severity,title,message,exchange,account_id,account_name,symbol,action_url,payload_json,dedupe_key)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.category,input.eventType,input.severity??'info',input.title,input.message,input.exchange??'bybit',input.accountId??null,input.accountName??null,input.symbol?.toUpperCase()??null,input.actionUrl??null,input.payload===undefined?null:JSON.stringify(input.payload),input.dedupeKey??null);
  if(result.changes)return mapNotification(db.prepare('SELECT * FROM notifications WHERE id=?').get(Number(result.lastInsertRowid)));
  if(input.dedupeKey){const row=db.prepare('SELECT * FROM notifications WHERE dedupe_key=?').get(input.dedupeKey);return row?mapNotification(row):null;}
  return null;
}

export function listNotifications(db:SqliteDb,input:{limit?:number;unreadOnly?:boolean}={}):NotificationRecord[]{
  const limit=Math.max(1,Math.min(200,input.limit??40));
  const rows=input.unreadOnly
    ? db.prepare('SELECT * FROM notifications WHERE read_at IS NULL ORDER BY id DESC LIMIT ?').all(limit)
    : db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT ?').all(limit);
  return (rows as any[]).map(mapNotification);
}

export function countUnreadNotifications(db:SqliteDb){const row:any=db.prepare('SELECT COUNT(*) count FROM notifications WHERE read_at IS NULL').get();return Number(row?.count)||0;}
export function markNotificationRead(db:SqliteDb,id:number){return db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE id=?').run(id).changes>0;}
export function markAllNotificationsRead(db:SqliteDb){return db.prepare('UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE read_at IS NULL').run().changes;}
export function markNotificationTelegram(db:SqliteDb,id:number,status:'sent'|'error'|'not_configured',error?:string|null){
  db.prepare(`UPDATE notifications SET telegram_status=?,telegram_error=?,telegram_sent_at=CASE WHEN ?='sent' THEN CURRENT_TIMESTAMP ELSE telegram_sent_at END WHERE id=?`)
    .run(status,error??null,status,id);
}

export function listJournal(db:SqliteDb, filters:{accountId?:number;symbol?:string;limit?:number}={}){
  const c:string[]=[];const p:any[]=[];
  if(filters.accountId){c.push('account_id=?');p.push(filters.accountId);}
  if(filters.symbol){c.push('symbol=?');p.push(filters.symbol.toUpperCase());}
  const where=c.length?`WHERE ${c.join(' AND ')}`:'';
  p.push(Math.min(filters.limit??200,1000));
  return db.prepare(`SELECT journal_orders.*, (SELECT COUNT(*) FROM journal_images WHERE journal_order_id=journal_orders.id) AS image_count FROM journal_orders ${where} ORDER BY occurred_at DESC LIMIT ?`).all(...p);
}

export type JournalPageFilters = {
  accountId?:number;
  symbol?:string;
  side?:string;
  style?:number;
  status?:number;
  pointType?:number;
  dateFrom?:string;
  dateTo?:string;
  page?:number;
  pageSize?:number;
  sort?:'newest'|'oldest'|'best_r'|'worst_r'|'highest_pnl';
};

export function listJournalPage(db:SqliteDb, filters:JournalPageFilters={}){
  const clauses:string[]=[];
  const params:any[]=[];
  if(filters.accountId){clauses.push('account_id=?');params.push(filters.accountId);}
  if(filters.symbol?.trim()){clauses.push('UPPER(symbol) LIKE ?');params.push(`%${filters.symbol.trim().toUpperCase()}%`);}
  if(filters.side){clauses.push('side=?');params.push(filters.side);}
  if(typeof filters.style==='number'){clauses.push('COALESCE(style,0)=?');params.push(filters.style);}
  if(typeof filters.status==='number'){clauses.push('COALESCE(status,0)=?');params.push(filters.status);}
  if(typeof filters.pointType==='number'){clauses.push('point_type=?');params.push(filters.pointType);}
  if(filters.dateFrom){clauses.push('date(occurred_at)>=date(?)');params.push(filters.dateFrom);}
  if(filters.dateTo){clauses.push('date(occurred_at)<=date(?)');params.push(filters.dateTo);}
  const where=clauses.length?`WHERE ${clauses.join(' AND ')}`:'';
  const page=Math.max(1,Math.floor(filters.page??1));
  const pageSize=Math.max(25,Math.min(200,Math.floor(filters.pageSize??50)));
  const sortSql={newest:'occurred_at DESC, id DESC',oldest:'occurred_at ASC, id ASC',best_r:'COALESCE(rr,0) DESC, occurred_at DESC',worst_r:'COALESCE(rr,0) ASC, occurred_at DESC',highest_pnl:'COALESCE(pnl,0) DESC, occurred_at DESC'}[filters.sort??'newest'];
  const countRow:any=db.prepare(`SELECT COUNT(*) AS count FROM journal_orders ${where}`).get(...params);
  const total=Number(countRow?.count)||0;
  const totalPages=Math.max(1,Math.ceil(total/pageSize));
  const safePage=Math.min(page,totalPages);
  const offset=(safePage-1)*pageSize;
  const rows=db.prepare(`SELECT journal_orders.*, (SELECT COUNT(*) FROM journal_images WHERE journal_order_id=journal_orders.id) AS image_count FROM journal_orders ${where} ORDER BY ${sortSql} LIMIT ? OFFSET ?`).all(...params,pageSize,offset);
  const analysisRows=db.prepare(`SELECT account_id,legacy_account,side,style,point_type,setup,rr FROM journal_orders ${where}`).all(...params) as any[];
  const scored=analysisRows.map(r=>Number(r.rr)).filter(Number.isFinite);
  const wins=scored.filter(v=>v>0),losses=scored.filter(v=>v<0);
  const grossWin=wins.reduce((a,b)=>a+b,0),grossLoss=Math.abs(losses.reduce((a,b)=>a+b,0));
  const net=scored.reduce((a,b)=>a+b,0),decided=wins.length+losses.length;
  const summary={trades:total,winrate:decided?wins.length/decided*100:0,net,avg:scored.length?net/scored.length:0,pf:grossLoss?grossWin/grossLoss:(grossWin?null:0),avgWin:wins.length?grossWin/wins.length:0,avgLoss:losses.length?losses.reduce((a,b)=>a+b,0)/losses.length:0};
  const breakdown=(label:(r:any)=>string)=>{const map=new Map<string,{name:string;trades:number;wins:number;losses:number;net:number}>();for(const r of analysisRows){const name=label(r)||'—';const x=map.get(name)||{name,trades:0,wins:0,losses:0,net:0};x.trades++;const rr=Number(r.rr)||0;x.net+=rr;if(rr>0)x.wins++;if(rr<0)x.losses++;map.set(name,x);}return[...map.values()].sort((a,b)=>b.trades-a.trades);};
  const styleNames:Record<number,string>={0:'—',1:'Breakout',2:'LP',3:'Rebound'};
  const pointNames:Record<number,string>={10:'Stop Limit · ATR',11:'Stop Limit · Technical',20:'Limit · ATR',21:'Limit · Technical',30:'Market · ATR',31:'Market · Technical'};
  const breakdowns={style:breakdown(r=>styleNames[Number(r.style||0)]||`Style ${r.style}`),account:breakdown(r=>r.legacy_account||`Account ${r.account_id||'—'}`),side:breakdown(r=>r.side||'—'),point:breakdown(r=>pointNames[Number(r.point_type||0)]||String(r.point_type||'—')),setup:breakdown(r=>r.setup||'Unclassified')};
  return {rows,total,page:safePage,pageSize,totalPages,summary,breakdowns};
}

export type JournalImage = {
  id:number; journal_order_id:number; kind:'before'|'entry'|'management'|'exit'|'other'; path:string; original_name:string|null; mime:string; size_bytes:number; created_at:string;
};

export function listJournalImages(db:SqliteDb,journalOrderId:number):JournalImage[]{
  return db.prepare('SELECT * FROM journal_images WHERE journal_order_id=? ORDER BY created_at,id').all(journalOrderId) as JournalImage[];
}

export function createJournalImage(db:SqliteDb,input:{journalOrderId:number;kind:JournalImage['kind'];path:string;originalName?:string|null;mime:string;sizeBytes:number}):JournalImage|null{
  const order=db.prepare('SELECT id FROM journal_orders WHERE id=?').get(input.journalOrderId);
  if(!order)return null;
  const result=db.prepare('INSERT INTO journal_images(journal_order_id,kind,path,original_name,mime,size_bytes) VALUES(?,?,?,?,?,?)')
    .run(input.journalOrderId,input.kind,input.path,input.originalName??null,input.mime,input.sizeBytes);
  return db.prepare('SELECT * FROM journal_images WHERE id=?').get(Number(result.lastInsertRowid)) as JournalImage;
}

export function getJournalImage(db:SqliteDb,id:number):JournalImage|null{
  return (db.prepare('SELECT * FROM journal_images WHERE id=?').get(id) as JournalImage|undefined)??null;
}

export function deleteJournalImage(db:SqliteDb,id:number){return db.prepare('DELETE FROM journal_images WHERE id=?').run(id).changes>0;}


export type JournalSubmittedOrderInput = {
  accountId:number;
  accountName:string;
  symbol:string;
  side:string;
  orderType:string;
  triggerPrice?:number|null;
  entryPrice?:number|null;
  stopLoss?:number|null;
  takeProfit?:number|null;
  quantity?:number|null;
  pointType?:number|null;
  priceLevel?:number|null;
  rr?:number|null;
  riskPercent?:number|null;
  riskAmount?:number|null;
  exchangeOrderId?:string|null;
  orderLinkId?:string|null;
  reduceOnly?:boolean;
  occurredAt?:string;
  raw?:unknown;
};

function findJournalByBybitOrder(db:SqliteDb,accountId:number,orderId?:string|null,orderLinkId?:string|null):any|null{
  if(orderLinkId){
    const row=db.prepare("SELECT * FROM journal_orders WHERE exchange='bybit' AND account_id=? AND order_link_id=? ORDER BY id DESC LIMIT 1").get(accountId,orderLinkId) as any;
    if(row)return row;
  }
  if(orderId){
    const row=db.prepare("SELECT * FROM journal_orders WHERE exchange='bybit' AND account_id=? AND exchange_order_id=? ORDER BY id DESC LIMIT 1").get(accountId,orderId) as any;
    if(row)return row;
  }
  return null;
}

export function upsertJournalSubmittedOrder(db:SqliteDb,input:JournalSubmittedOrderInput){
  const existing=findJournalByBybitOrder(db,input.accountId,input.exchangeOrderId,input.orderLinkId);
  const occurredAt=input.occurredAt||new Date().toISOString();
  if(existing){
    db.prepare(`UPDATE journal_orders SET
      legacy_account=?,symbol=?,side=?,order_type=?,trigger_price=?,
      entry_price=CASE WHEN entry_price IS NULL OR entry_price=0 THEN ? ELSE entry_price END,
      stop_loss=?,take_profit=?,quantity=CASE WHEN quantity IS NULL OR quantity=0 THEN ? ELSE quantity END,
      point_type=COALESCE(?,point_type),price_level=COALESCE(?,price_level),
      risk_percent=COALESCE(?,risk_percent),risk_amount=COALESCE(?,risk_amount),
      exchange_order_id=COALESCE(NULLIF(?,''),exchange_order_id),order_link_id=COALESCE(NULLIF(?,''),order_link_id),
      reduce_only=?,raw_json=COALESCE(?,raw_json),updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(input.accountName,input.symbol.toUpperCase(),input.side,input.orderType,input.triggerPrice??null,input.entryPrice??null,input.stopLoss??null,input.takeProfit??null,input.quantity??null,input.pointType??null,input.priceLevel??null,input.riskPercent??null,input.riskAmount??null,input.exchangeOrderId??'',input.orderLinkId??'',input.reduceOnly?1:0,input.raw===undefined?null:JSON.stringify(input.raw),existing.id);
    return db.prepare('SELECT * FROM journal_orders WHERE id=?').get(existing.id);
  }
  const result=db.prepare(`INSERT INTO journal_orders(
    legacy_account,account_id,occurred_at,symbol,side,order_type,trigger_price,entry_price,stop_loss,take_profit,quantity,
    point_type,price_level,status,rr,style,raw_json,exchange,exchange_order_id,order_link_id,reduce_only,risk_percent,risk_amount
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,0,?,'bybit',?,?,?,?,?)`)
    .run(input.accountName,input.accountId,occurredAt,input.symbol.toUpperCase(),input.side,input.orderType,input.triggerPrice??null,input.entryPrice??null,input.stopLoss??null,input.takeProfit??null,input.quantity??null,input.pointType??null,input.priceLevel??null,0,input.raw===undefined?null:JSON.stringify(input.raw),input.exchangeOrderId??null,input.orderLinkId??null,input.reduceOnly?1:0,input.riskPercent??null,input.riskAmount??null);
  return db.prepare('SELECT * FROM journal_orders WHERE id=?').get(Number(result.lastInsertRowid));
}

const bybitJournalStatus=(status:string)=>status==='Filled'?1:['Cancelled','Rejected','Deactivated','PartiallyFilledCanceled'].includes(status)?2:0;

export function syncJournalBybitOrder(db:SqliteDb,input:{accountId:number;accountName:string;order:any}){
  const o=input.order||{};
  const orderId=String(o.orderId||'');
  const orderLinkId=String(o.orderLinkId||'');
  let row=findJournalByBybitOrder(db,input.accountId,orderId,orderLinkId);
  if(!row && orderLinkId.startsWith('tradev2-')){
    row=upsertJournalSubmittedOrder(db,{accountId:input.accountId,accountName:input.accountName,symbol:String(o.symbol||''),side:String(o.side||''),orderType:String(o.orderType||'Order'),triggerPrice:Number(o.triggerPrice)||null,entryPrice:Number(o.price)||Number(o.avgPrice)||null,stopLoss:Number(o.stopLoss)||null,takeProfit:Number(o.takeProfit)||null,quantity:Number(o.qty)||null,exchangeOrderId:orderId||null,orderLinkId,reduceOnly:Boolean(o.reduceOnly),occurredAt:o.createdTime?new Date(Number(o.createdTime)).toISOString():undefined,raw:o});
  }
  if(!row)return null;
  const avg=Number(o.avgPrice)||0;
  const qty=Number(o.cumExecQty)||Number(o.qty)||0;
  db.prepare(`UPDATE journal_orders SET
    status=?,entry_price=CASE WHEN ?>0 THEN ? ELSE entry_price END,
    quantity=CASE WHEN ?>0 THEN ? ELSE quantity END,
    trigger_price=CASE WHEN ?>0 THEN ? ELSE trigger_price END,
    stop_loss=CASE WHEN ?>0 THEN ? ELSE stop_loss END,
    take_profit=CASE WHEN ?>0 THEN ? ELSE take_profit END,
    exchange_order_id=COALESCE(NULLIF(?,''),exchange_order_id),order_link_id=COALESCE(NULLIF(?,''),order_link_id),
    reduce_only=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(bybitJournalStatus(String(o.orderStatus||'')),avg,avg,qty,qty,Number(o.triggerPrice)||0,Number(o.triggerPrice)||0,Number(o.stopLoss)||0,Number(o.stopLoss)||0,Number(o.takeProfit)||0,Number(o.takeProfit)||0,orderId,orderLinkId,Boolean(o.reduceOnly)?1:0,row.id);
  return db.prepare('SELECT * FROM journal_orders WHERE id=?').get(row.id);
}

export function recordJournalBybitExecution(db:SqliteDb,input:{accountId:number;accountName:string;execution:any}){
  const x=input.execution||{};
  const execId=String(x.execId||'');
  if(!execId)return null;
  const orderId=String(x.orderId||'');
  const orderLinkId=String(x.orderLinkId||'');
  let row=findJournalByBybitOrder(db,input.accountId,orderId,orderLinkId);
  if(!row && orderLinkId.startsWith('tradev2-')){
    row=upsertJournalSubmittedOrder(db,{accountId:input.accountId,accountName:input.accountName,symbol:String(x.symbol||''),side:String(x.side||''),orderType:'Execution',entryPrice:Number(x.execPrice)||null,quantity:Number(x.execQty)||null,exchangeOrderId:orderId||null,orderLinkId,occurredAt:x.execTime?new Date(Number(x.execTime)).toISOString():undefined,raw:x});
  }
  if(!row)return null;
  const inserted=db.prepare(`INSERT OR IGNORE INTO journal_execution_events(exec_id,journal_order_id,exec_price,exec_qty,exec_fee,occurred_at,raw_json) VALUES(?,?,?,?,?,?,?)`)
    .run(execId,row.id,Number(x.execPrice)||0,Number(x.execQty)||0,Math.abs(Number(x.execFee)||0),x.execTime?new Date(Number(x.execTime)).toISOString():null,JSON.stringify(x));
  if(!inserted.changes)return row;
  const agg:any=db.prepare(`SELECT SUM(exec_qty) qty,CASE WHEN SUM(exec_qty)>0 THEN SUM(exec_price*exec_qty)/SUM(exec_qty) ELSE 0 END avg_price,SUM(exec_fee) fees FROM journal_execution_events WHERE journal_order_id=?`).get(row.id);
  db.prepare(`UPDATE journal_orders SET entry_price=CASE WHEN ?>0 THEN ? ELSE entry_price END,quantity=CASE WHEN ?>0 THEN ? ELSE quantity END,fees=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(Number(agg?.avg_price)||0,Number(agg?.avg_price)||0,Number(agg?.qty)||0,Number(agg?.qty)||0,Number(agg?.fees)||0,row.id);
  return db.prepare('SELECT * FROM journal_orders WHERE id=?').get(row.id);
}

export function updateJournalOrder(db:SqliteDb,id:number,input:{rr?:number;style?:number;status?:number;note?:string|null;setup?:string|null;tags?:string[];executionQuality?:string|null;exitPrice?:number|null;pnl?:number|null;fees?:number|null}){
  const current:any=db.prepare('SELECT * FROM journal_orders WHERE id=?').get(id);
  if(!current)return null;
  const tagsJson=input.tags===undefined?current.tags_json:JSON.stringify(input.tags);
  db.prepare(`UPDATE journal_orders SET rr=?,style=?,status=?,note=?,setup=?,tags_json=?,execution_quality=?,exit_price=?,pnl=?,fees=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(input.rr??current.rr,input.style??current.style,input.status??current.status,input.note===undefined?current.note:input.note,input.setup===undefined?current.setup:input.setup,tagsJson,input.executionQuality===undefined?current.execution_quality:input.executionQuality,input.exitPrice===undefined?current.exit_price:input.exitPrice,input.pnl===undefined?current.pnl:input.pnl,input.fees===undefined?current.fees:input.fees,id);
  return db.prepare('SELECT * FROM journal_orders WHERE id=?').get(id);
}


export type ExchangeAccountRecord = AccountPublic & {
  environment:string;
  credentialSource:'env';
  apiKeyRef:string|null;
  apiSecretRef:string|null;
  legacySlot:number|null;
  createdAt:string;
  updatedAt:string;
};

const mapExchangeAccount=(r:any,env:NodeJS.ProcessEnv=process.env):ExchangeAccountRecord=>{
  const keyRef=r.api_key_ref?String(r.api_key_ref):null;
  const secretRef=r.api_secret_ref?String(r.api_secret_ref):null;
  const configured=Boolean(keyRef&&secretRef&&env[keyRef]&&env[secretRef]);
  return {
    id:Number(r.id),exchange:String(r.exchange) as ExchangeId,market:String(r.market) as MarketKind,name:String(r.name),
    demo:String(r.environment)==='demo',configured,enabled:Boolean(Number(r.enabled)),environment:String(r.environment||'prod'),
    credentialSource:'env',apiKeyRef:keyRef,apiSecretRef:secretRef,legacySlot:r.legacy_slot===null?null:Number(r.legacy_slot),createdAt:String(r.created_at),updatedAt:String(r.updated_at),
  };
};

export function seedLegacyExchangeAccounts(db:SqliteDb,env:NodeJS.ProcessEnv=process.env){
  const slots=new Set<number>();
  for(const key of Object.keys(env)){
    const match=/^BYBIT_ACCOUNT(\d+)_(?:NAME|KEY|SECRET|DEMO)$/.exec(key);
    if(match)slots.add(Number(match[1]));
  }
  for(const slot of [...slots].sort((a,b)=>a-b)){
    const prefix=`BYBIT_ACCOUNT${slot}_`;
    const keyRef=`${prefix}KEY`,secretRef=`${prefix}SECRET`;
    const hasAny=[`${prefix}NAME`,keyRef,secretRef,`${prefix}DEMO`].some(k=>env[k]!==undefined&&env[k]!=='');
    if(!hasAny)continue;
    const name=env[`${prefix}NAME`]||`Account ${slot}`;
    const demo=['1','true','yes','on'].includes(String(env[`${prefix}DEMO`]||'').toLowerCase());
    const values=[name,demo?'demo':'prod',keyRef,secretRef,slot] as const;
    // First try to preserve the old slot as the row id. INSERT OR IGNORE makes app+worker startup race-safe.
    db.prepare(`INSERT OR IGNORE INTO exchange_accounts(id,exchange,market,name,environment,enabled,credential_source,api_key_ref,api_secret_ref,legacy_slot)
      VALUES(?,'bybit','linear',?,?,1,'env',?,?,?)`).run(slot,...values);
    // If that id was already occupied by another account, create a normal autoincrement row for this legacy slot.
    db.prepare(`INSERT OR IGNORE INTO exchange_accounts(exchange,market,name,environment,enabled,credential_source,api_key_ref,api_secret_ref,legacy_slot)
      VALUES('bybit','linear',?,?,1,'env',?,?,?)`).run(...values);
    db.prepare(`UPDATE exchange_accounts SET name=?,market='linear',environment=?,enabled=1,credential_source='env',api_key_ref=?,api_secret_ref=?,updated_at=CURRENT_TIMESTAMP
      WHERE exchange='bybit' AND legacy_slot=?`).run(...values);
  }
}

export function listExchangeAccounts(db:SqliteDb,input:{exchange?:string;enabledOnly?:boolean}={},env:NodeJS.ProcessEnv=process.env):ExchangeAccountRecord[]{
  const clauses:string[]=[];const params:any[]=[];
  if(input.exchange){clauses.push('exchange=?');params.push(input.exchange);}
  if(input.enabledOnly){clauses.push('enabled=1');}
  const where=clauses.length?`WHERE ${clauses.join(' AND ')}`:'';
  return (db.prepare(`SELECT * FROM exchange_accounts ${where} ORDER BY id`).all(...params) as any[]).map(r=>mapExchangeAccount(r,env));
}

export function getExchangeAccount(db:SqliteDb,id:number,env:NodeJS.ProcessEnv=process.env):ExchangeAccountRecord|null{
  const row=db.prepare('SELECT * FROM exchange_accounts WHERE id=?').get(id) as any;
  return row?mapExchangeAccount(row,env):null;
}

export function resolveExchangeAccountRuntime(db:SqliteDb,id:number,env:NodeJS.ProcessEnv=process.env){
  const account=getExchangeAccount(db,id,env);
  if(!account)throw new Error(`Unknown exchange account ${id}`);
  const apiKey=account.apiKeyRef?String(env[account.apiKeyRef]||''):'';
  const apiSecret=account.apiSecretRef?String(env[account.apiSecretRef]||''):'';
  return {...account,apiKey,apiSecret};
}
