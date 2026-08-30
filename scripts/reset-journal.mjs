import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

const dbPath = process.env.DATABASE_PATH || './data/trade.sqlite';
const chartsDir = process.env.CHARTS_DIR || './data/charts';

mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);

db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const before = {
  trades: Number(db.prepare('SELECT COUNT(*) AS n FROM journal_orders').get().n),
  images: Number(db.prepare('SELECT COUNT(*) AS n FROM journal_images').get().n),
  executions: Number(db.prepare('SELECT COUNT(*) AS n FROM journal_execution_events').get().n),
};

try {
  db.exec('BEGIN IMMEDIATE;');
  db.exec('DELETE FROM journal_execution_events;');
  db.exec('DELETE FROM journal_images;');
  db.exec('DELETE FROM journal_orders;');
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('journal_orders','journal_images','journal_execution_events');");
  db.exec('COMMIT;');
} catch (error) {
  try { db.exec('ROLLBACK;'); } catch {}
  throw error;
}

db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
db.exec('VACUUM;');
db.close();

// The charts directory contains legacy and current journal screenshots.
// User requested a complete screenshot reset, so remove it entirely and recreate it empty.
rmSync(chartsDir, { recursive: true, force: true });
mkdirSync(chartsDir, { recursive: true });

console.log(JSON.stringify({
  ok: true,
  deleted: before,
  chartsDir,
  message: 'Journal trades, execution links and all chart screenshots were removed.'
}, null, 2));
