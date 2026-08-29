import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readFileSync, copyFileSync, readdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';

const source=process.argv[2] || './legacy-data';
const dbPath=process.env.DATABASE_PATH || './data/trade.sqlite';
const chartsDir=process.env.CHARTS_DIR || './data/charts';
mkdirSync(dirname(dbPath),{recursive:true});mkdirSync(chartsDir,{recursive:true});
const db=new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS journal_orders (id INTEGER PRIMARY KEY AUTOINCREMENT,legacy_key TEXT UNIQUE,legacy_account TEXT,account_id INTEGER,occurred_at TEXT NOT NULL,symbol TEXT NOT NULL,side TEXT,order_type TEXT,trigger_price REAL,entry_price REAL,stop_loss REAL,take_profit REAL,quantity REAL,point_type INTEGER,price_level REAL,status INTEGER,rr REAL,style INTEGER,note TEXT,chart_path TEXT,raw_json TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT,symbol TEXT NOT NULL,price REAL NOT NULL,condition TEXT NOT NULL DEFAULT 'touch',pre_alert_percent REAL,source_type TEXT NOT NULL DEFAULT 'manual',source_id INTEGER,telegram_enabled INTEGER NOT NULL DEFAULT 1,active INTEGER NOT NULL DEFAULT 1,trigger_once INTEGER NOT NULL DEFAULT 1,last_price REAL,pre_alerted_at TEXT,triggered_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS manual_levels (id INTEGER PRIMARY KEY AUTOINCREMENT,symbol TEXT NOT NULL,price REAL NOT NULL,label TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS risk_rewards (id INTEGER PRIMARY KEY AUTOINCREMENT,symbol TEXT NOT NULL,timeframe TEXT NOT NULL,direction TEXT NOT NULL,entry REAL NOT NULL,stop REAL NOT NULL,target REAL NOT NULL,start_time INTEGER NOT NULL,end_time INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS system_events (id INTEGER PRIMARY KEY AUTOINCREMENT,severity TEXT NOT NULL DEFAULT 'info',event_type TEXT NOT NULL,account_id INTEGER,symbol TEXT,message TEXT NOT NULL,payload_json TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
const logs=existsSync(join(source,'logs'))?join(source,'logs'):source;
const notesPath=join(logs,'notes.json');const notes=existsSync(notesPath)?JSON.parse(readFileSync(notesPath,'utf8')):{};
const uploads=join(logs,'uploads');const images=existsSync(uploads)?readdirSync(uploads):[];
const insert=db.prepare(`INSERT OR IGNORE INTO journal_orders(legacy_key,legacy_account,account_id,occurred_at,symbol,side,order_type,trigger_price,entry_price,stop_loss,take_profit,quantity,point_type,price_level,status,rr,style,note,chart_path,raw_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
let imported=0,skipped=0,copied=0;
const orderFiles=readdirSync(logs).map(name=>({name,match:/^orders_account(\d+)\.json$/.exec(name)})).filter(x=>x.match).sort((a,b)=>Number(a.match[1])-Number(b.match[1]));
for(const file of orderFiles){
 const accountId=Number(file.match[1]);
 const p=join(logs,file.name);
 const rows=JSON.parse(readFileSync(p,'utf8'));for(const row of rows){
  const stamp=String(row.date||'').replace(' ','T').replaceAll(':','-');const key=`${stamp}_${row.Ticker}_${accountId}`;
  const image=images.find(name=>name.startsWith(key+'.')||name.startsWith(key+'_')||name.replace(/\.[^.]+$/,'')===key) || images.find(name=>name.startsWith(key));
  let chart=null;if(image){chart=basename(image);const dst=join(chartsDir,chart);if(!existsSync(dst)){copyFileSync(join(uploads,image),dst);copied++;}}
  const result=insert.run(key,row.account||`account${accountId}`,accountId,row.date,row.Ticker,row.Type,row.Order,Number(row.Trigger)||0,Number(row.Entry)||0,Number(row.SL)||0,Number(row.TP)||0,Number(row.Position)||0,Number(row.pointType)||0,Number(row.priceLevel)||0,Number(row.status)||0,Number(row.rR)||0,Number(row.style)||0,notes[key]??null,chart,JSON.stringify(row));
  result.changes?imported++:skipped++;
 }
}
const alertsCandidates=[join(source,'api','alerts.json'),join(source,'alerts.json')];const alertsPath=alertsCandidates.find(existsSync);
let alertCount=0;if(alertsPath){const old=JSON.parse(readFileSync(alertsPath,'utf8'));const add=db.prepare(`INSERT INTO alerts(symbol,price,condition,pre_alert_percent,source_type,telegram_enabled,active,trigger_once) SELECT ?,?,'touch',0.25,'manual',1,1,1 WHERE NOT EXISTS(SELECT 1 FROM alerts WHERE symbol=? AND price=?)`);if(Array.isArray(old)){for(const x of old){if(x?.symbol&&x?.price){alertCount+=Number(add.run(String(x.symbol).toUpperCase(),Number(x.price),String(x.symbol).toUpperCase(),Number(x.price)).changes)}}}else if(old&&typeof old==='object'){for(const [symbol,prices] of Object.entries(old)){if(Array.isArray(prices))for(const price of prices){alertCount+=Number(add.run(symbol.toUpperCase(),Number(price),symbol.toUpperCase(),Number(price)).changes)}}}}
console.log(JSON.stringify({source,dbPath,ordersImported:imported,ordersSkipped:skipped,chartsCopied:copied,alertsImported:alertCount},null,2));
